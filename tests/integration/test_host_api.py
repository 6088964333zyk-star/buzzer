"""
Integration tests for the T4 host API (/api/host/*) and the course rules it
relies on. See docs/design-t4-host.md, step 7.

Every test asserts behavior (what changed or didn't, who can see what), not
just status codes. Live sessions are driven over real Socket.IO connections.
"""

from __future__ import annotations

import csv
import io
import json
import subprocess
import uuid

import httpx
import pytest

from .conftest import create_guest_tokens
from .engine.socket_client import TestSocketClient

_T = 10.0
_PASSWORD = "Passw0rd!x"

MC_QUESTION = {
    "type": "multiple_choice",
    "grading_type": "ACCURACY",
    "prompt": "2 + 2 = ?",
    "config": {"options": ["3", "4", "5"]},
    "answer_data": {"answer_points": [0, 1, 0]},
    "points_value": 1,
    "time_limit_seconds": 60,
}


# ---------------------------------------------------------------------------
# World: two courses, a host of A, a second host of A, and a player of A
# ---------------------------------------------------------------------------


class World:
    def __init__(self, base_url: str, admin_token: str):
        self.base = base_url
        self.admin = {"Authorization": f"Bearer {admin_token}"}
        self.tag = uuid.uuid4().hex[:6]
        self.user_ids: list[str] = []
        self.game_ids: list[int] = []
        self.course_a = self._course("A")
        self.course_b = self._course("B")
        self.host_a = self._user("hosta", self.course_a, "HOST")
        self.host_a2 = self._user("hosta2", self.course_a, "HOST")
        self.player_a = self._user("playera", self.course_a, "PLAYER")

    def url(self, path: str) -> str:
        return f"{self.base}/api{path}"

    def _course(self, name: str) -> int:
        r = httpx.post(
            self.url("/admin/courses"),
            json={"name": f"Host Test {name} {self.tag}", "semester": "Test"},
            headers=self.admin,
            timeout=_T,
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def _user(self, name: str, course_id: int, role: str) -> dict:
        username = f"{name}_{self.tag}"
        r = httpx.post(
            self.url("/admin/users"),
            json={"username": username, "display_name": name, "password": _PASSWORD},
            headers=self.admin,
            timeout=_T,
        )
        assert r.status_code == 201, r.text
        user_id = r.json()["id"]
        self.user_ids.append(user_id)
        r = httpx.post(
            self.url(f"/admin/users/{user_id}/course-access"),
            json={"course_id": course_id, "role": role},
            headers=self.admin,
            timeout=_T,
        )
        assert r.status_code == 204, r.text
        r = httpx.post(
            self.url("/auth/login"),
            json={"username": username, "password": _PASSWORD},
            timeout=_T,
        )
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        return {"id": user_id, "token": token, "h": {"Authorization": f"Bearer {token}"}}

    def admin_game(self, course_id: int) -> int:
        body = {"title": f"Admin game {self.tag}", "course_id": course_id}
        r = httpx.post(self.url("/admin/games"), json=body, headers=self.admin, timeout=_T)
        assert r.status_code == 201, r.text
        self.game_ids.append(r.json()["id"])
        return r.json()["id"]

    def legacy_game(self) -> int:
        """A course-less game, as migration 004 leaves pre-T4 rows (design D1).

        The API can no longer create one, so clear course_id with the mysql
        client inside the stack's container (like test_session_ttl's redis-cli).
        """
        game_id = self.admin_game(self.course_a)
        subprocess.run(
            [
                "docker", "compose", "exec", "-T", "mysql", "sh", "-c",
                'mysql -uapp_user -p"$MYSQL_PASSWORD" buzzer '
                f'-e "UPDATE games SET course_id = NULL WHERE id = {game_id}"',
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        r = httpx.get(self.url(f"/admin/games/{game_id}"), headers=self.admin, timeout=_T)
        assert r.json()["course_id"] is None, r.text
        return game_id

    def host_game(self, headers: dict, course_id: int) -> int:
        r = httpx.post(
            self.url(f"/host/courses/{course_id}/games"),
            json={"title": f"Host game {self.tag}"},
            headers=headers,
            timeout=_T,
        )
        assert r.status_code == 201, r.text
        self.game_ids.append(r.json()["id"])
        return r.json()["id"]

    def add_question(self, headers: dict, game_id: int, prefix: str = "/host") -> int:
        r = httpx.post(
            self.url(f"{prefix}/games/{game_id}/questions"),
            json=MC_QUESTION,
            headers=headers,
            timeout=_T,
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def questions(self, game_id: int) -> list[dict]:
        r = httpx.get(
            self.url(f"/admin/games/{game_id}/questions"), headers=self.admin, timeout=_T
        )
        assert r.status_code == 200, r.text
        return r.json()

    def room(self, headers: dict, course_id: int, game_id: int) -> httpx.Response:
        return httpx.post(
            self.url("/game/rooms"),
            json={"course_id": course_id, "game_id": game_id},
            headers=headers,
            timeout=_T,
        )

    def cleanup(self):
        # Deleting games cascades their sessions and scores; courses have no
        # DELETE endpoint and are left as inert records (as in conftest).
        for gid in self.game_ids:
            httpx.delete(self.url(f"/admin/games/{gid}"), headers=self.admin, timeout=_T)
        for uid in self.user_ids:
            httpx.delete(self.url(f"/admin/users/{uid}"), headers=self.admin, timeout=_T)


@pytest.fixture(scope="module")
def world(docker_stack, base_url, admin_token):
    w = World(base_url, admin_token)
    yield w
    w.cleanup()


async def _start_session(world: World, game_id: int, course_id: int, answer: bool):
    """Create a room as the session creator (host_a), start it, and optionally
    have one guest answer the first question. Returns (session_id, host, player)
    with the game left IN_PROGRESS on its first question."""
    r = world.room(world.host_a["h"], course_id, game_id)
    assert r.status_code == 201, r.text
    room_code, session_id = r.json()["room_code"], r.json()["session_id"]
    (guest_token,) = create_guest_tokens(world.base, room_code, 1)

    host = TestSocketClient(world.base, world.host_a["token"], "host")
    player = TestSocketClient(world.base, guest_token, "player")
    await host.connect()
    await player.connect()
    await host.emit("join_room", {"room_code": room_code, "role": "HOST"})
    await player.emit("join_room", {"room_code": room_code, "role": "PLAYER"})
    await host.wait_for("sync_state", _T)
    await player.wait_for("sync_state", _T)
    await host.emit("host_advance", {})
    question = await player.wait_for("new_question", _T)
    if answer:
        await player.emit(
            "submit_answer",
            {
                "question_id": question["questionId"],
                "answer_data": {"selectedIndex": 1},
                "answer_time_ms": 500,
            },
        )
        ack = await player.wait_for("answer_received", _T)
        assert ack.get("pointsAwarded") == 1, ack
    return session_id, host, player


async def _finish(host: TestSocketClient, player: TestSocketClient, n_questions: int):
    for _ in range(n_questions):
        await host.emit("host_advance", {})  # close question -> results
        await host.wait_for("question_results", _T)
        await host.emit("host_advance", {})  # next question or game over
    await host.wait_for("game_over", _T)
    await host.disconnect()
    await player.disconnect()


# ---------------------------------------------------------------------------
# 1. Access matrix
# ---------------------------------------------------------------------------


def test_host_can_manage_own_course_but_not_others(world: World):
    own_game = world.host_game(world.host_a["h"], world.course_a)
    other_game = world.admin_game(world.course_b)
    legacy_game = world.legacy_game()
    h = world.host_a["h"]

    titles = [
        g["id"]
        for g in httpx.get(world.url(f"/host/courses/{world.course_a}/games"), headers=h).json()
    ]
    assert own_game in titles and other_game not in titles

    for path in (
        f"/host/courses/{world.course_b}/games",
        f"/host/courses/{world.course_b}/roster",
        f"/host/courses/{world.course_b}/sessions",
        f"/host/games/{other_game}",
        f"/host/games/{other_game}/questions",
        f"/host/games/{legacy_game}",
    ):
        assert httpx.get(world.url(path), headers=h).status_code == 403, path

    # Writes into another course are refused and leave nothing behind.
    r = httpx.post(world.url(f"/host/games/{other_game}/questions"), json=MC_QUESTION, headers=h)
    assert r.status_code == 403
    assert world.questions(other_game) == []


def test_players_and_guests_cannot_use_host_api(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    for path in (
        f"/host/courses/{world.course_a}/games",
        f"/host/courses/{world.course_a}/roster",
        f"/host/courses/{world.course_a}/sessions",
        f"/host/games/{game}/questions",
    ):
        assert httpx.get(world.url(path), headers=world.player_a["h"]).status_code == 403
        assert httpx.get(world.url(path), headers=world.admin).status_code == 200
        assert httpx.get(world.url(path)).status_code == 401


def test_host_cannot_change_a_games_course(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    r = httpx.put(
        world.url(f"/host/games/{game}"),
        json={"course_id": world.course_b},
        headers=world.host_a["h"],
    )
    assert r.status_code == 422
    assert httpx.get(world.url(f"/host/games/{game}"), headers=world.admin).json()[
        "course_id"
    ] == world.course_a


# ---------------------------------------------------------------------------
# 2. Course-specific games and the room rule (D1)
# ---------------------------------------------------------------------------


def test_room_rule_for_course_owned_and_legacy_games(world: World):
    owned = world.host_game(world.host_a["h"], world.course_a)
    world.add_question(world.host_a["h"], owned)
    legacy = world.legacy_game()
    world.add_question(world.admin, legacy, prefix="/admin")

    # Course-owned game: only in its own course, admin included.
    assert world.room(world.host_a["h"], world.course_b, owned).status_code == 403
    assert world.room(world.admin, world.course_b, owned).status_code == 403
    assert world.room(world.host_a["h"], world.course_a, owned).status_code == 201

    # Legacy (course-less) game: admin only, any course (pre-T4 behavior).
    assert world.room(world.host_a["h"], world.course_a, legacy).status_code == 403
    assert world.room(world.admin, world.course_b, legacy).status_code == 201


def test_admin_can_assign_course_once(world: World):
    game = world.legacy_game()
    url = world.url(f"/admin/games/{game}")
    assert httpx.put(url, json={"title": "renamed"}, headers=world.admin).json()["course_id"] is None
    assert httpx.put(url, json={"course_id": world.course_a}, headers=world.admin).status_code == 200
    r = httpx.put(url, json={"course_id": world.course_b}, headers=world.admin)
    assert r.status_code == 409
    assert httpx.get(url, headers=world.admin).json()["course_id"] == world.course_a


def test_admin_game_creation_requires_a_course(world: World):
    def titles() -> list[str]:
        r = httpx.get(world.url("/admin/games"), headers=world.admin, timeout=_T)
        return [g["title"] for g in r.json()]

    title = f"No course {world.tag}"
    for body in ({"title": title}, {"title": title, "course_id": None}):
        r = httpx.post(world.url("/admin/games"), json=body, headers=world.admin, timeout=_T)
        assert r.status_code == 422, r.text
    r = httpx.post(
        world.url("/admin/games"),
        json={"title": title, "course_id": 999_999_999},
        headers=world.admin,
        timeout=_T,
    )
    assert r.status_code == 404, r.text
    assert title not in titles()


def test_import_attaches_the_chosen_course(world: World):
    title = f"Import {world.tag}"
    bundle = {
        "format": "buzzer/game",
        "version": 1,
        # A course_id inside the file is ignored; the form field wins.
        "game": {"title": title, "course_id": world.course_b},
        "questions": [MC_QUESTION],
    }

    def post(data: dict) -> httpx.Response:
        return httpx.post(
            world.url("/admin/games/import"),
            headers=world.admin,
            files={"file": ("g.json", json.dumps(bundle), "application/json")},
            data=data,
            timeout=_T,
        )

    assert post({}).status_code == 422
    assert post({"course_id": 999_999_999}).status_code == 404
    r = httpx.get(world.url("/admin/games"), headers=world.admin, timeout=_T)
    assert title not in [g["title"] for g in r.json()]

    r = post({"course_id": world.course_a})
    assert r.status_code == 201, r.text
    game_id = r.json()["game_id"]
    world.game_ids.append(game_id)
    game = httpx.get(world.url(f"/admin/games/{game_id}"), headers=world.admin, timeout=_T)
    assert game.json()["course_id"] == world.course_a
    # The course's host can manage it straight away.
    assert len(world.questions(game_id)) == 1
    h = world.host_a["h"]
    assert httpx.get(world.url(f"/host/games/{game_id}"), headers=h, timeout=_T).status_code == 200


# ---------------------------------------------------------------------------
# 3-5. Question editing rules (D7, D5, D8)
# ---------------------------------------------------------------------------


def test_inconsistent_update_is_rejected_and_nothing_changes(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    qid = world.add_question(world.host_a["h"], game)
    before = world.questions(game)

    r = httpx.put(
        world.url(f"/host/games/{game}/questions/{qid}"),
        json={"config": {"options": ["only", "two"]}},
        headers=world.host_a["h"],
    )
    assert r.status_code == 422
    assert "answer_points" in r.json()["message"]
    assert world.questions(game) == before

    # A consistent update still works.
    r = httpx.put(
        world.url(f"/host/games/{game}/questions/{qid}"),
        json={"prompt": "Two plus two?"},
        headers=world.host_a["h"],
    )
    assert r.status_code == 200 and r.json()["prompt"] == "Two plus two?"


async def test_answered_questions_keep_their_history(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    answered = world.add_question(world.host_a["h"], game)
    session_id, host, player = await _start_session(world, game, world.course_a, answer=True)
    await _finish(host, player, n_questions=1)

    h = world.host_a["h"]
    q_url = world.url(f"/host/games/{game}/questions/{answered}")
    r = httpx.delete(q_url, headers=h)
    assert r.status_code == 409 and "1 session" in r.json()["message"]
    r = httpx.put(q_url, json={"type": "true_false"}, headers=h)
    assert r.status_code == 409
    assert httpx.put(q_url, json={"prompt": "Edited later"}, headers=h).status_code == 200

    # The score is still there.
    rows = list(csv.reader(io.StringIO(
        httpx.get(world.url(f"/host/sessions/{session_id}/export"), headers=h).text
    )))
    assert rows[0] == ["Player", "Q1", "Total"]
    assert len(rows) == 2 and float(rows[1][-1]) == 1.0

    # A never-answered question deletes normally.
    fresh = world.add_question(h, game)
    assert httpx.delete(world.url(f"/host/games/{game}/questions/{fresh}"), headers=h).status_code == 204
    assert fresh not in [q["id"] for q in world.questions(game)]


async def test_no_question_edits_while_a_session_is_in_progress(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    qid = world.add_question(world.host_a["h"], game)
    h = world.host_a["h"]

    # LOBBY does not block edits.
    assert world.room(h, world.course_a, game).status_code == 201
    assert httpx.put(
        world.url(f"/host/games/{game}/questions/{qid}"), json={"prompt": "lobby edit"}, headers=h
    ).status_code == 200

    _, host, player = await _start_session(world, game, world.course_a, answer=False)
    try:
        before = world.questions(game)
        base = world.url(f"/host/games/{game}/questions")
        assert httpx.post(base, json=MC_QUESTION, headers=h).status_code == 409
        assert httpx.put(f"{base}/{qid}", json={"prompt": "x"}, headers=h).status_code == 409
        assert httpx.delete(f"{base}/{qid}", headers=h).status_code == 409
        assert httpx.post(f"{base}/reorder", json={"order": [qid]}, headers=h).status_code == 409
        assert world.questions(game) == before
    finally:
        await _finish(host, player, n_questions=1)

    # Once the game is over, edits work again.
    assert httpx.put(
        world.url(f"/host/games/{game}/questions/{qid}"), json={"prompt": "after"}, headers=h
    ).status_code == 200


# ---------------------------------------------------------------------------
# 6. Roster full replace (D4)
# ---------------------------------------------------------------------------


def _row(netid: str) -> dict:
    return {"netid": netid, "full_name": netid.upper(), "email": f"{netid}@example.edu"}


def test_roster_upload_adds_updates_and_deactivates(world: World):
    h = world.host_a["h"]
    url = world.url(f"/host/courses/{world.course_b}/roster/import")
    assert httpx.post(url, json={"rows": [_row("a")]}, headers=h).status_code == 403

    url = world.url(f"/host/courses/{world.course_a}/roster/import")
    roster_url = world.url(f"/host/courses/{world.course_a}/roster")

    def active():
        return {e["netid"]: e["is_active"] for e in httpx.get(roster_url, headers=h).json()}

    r = httpx.post(url, json={"rows": [_row("ann"), _row("bob")]}, headers=h).json()
    assert (r["imported"], r["updated"], r["deactivated"]) == (2, 0, 0)
    r = httpx.post(url, json={"rows": [_row("bob"), _row(" Cat ")]}, headers=h).json()
    assert (r["imported"], r["updated"], r["deactivated"]) == (1, 1, 1)
    assert active() == {"ann": False, "bob": True, "cat": True}
    r = httpx.post(url, json={"rows": [_row("ann")]}, headers=h).json()
    assert (r["imported"], r["updated"], r["deactivated"]) == (0, 1, 2)
    assert active() == {"ann": True, "bob": False, "cat": False}

    before = active()
    rows = [_row(f"u{i}") for i in range(1001)]
    r = httpx.post(url, json={"rows": rows}, headers=h)
    assert r.status_code == 422
    assert active() == before

    # Single-entry toggle, scoped to the course.
    entry = next(e for e in httpx.get(roster_url, headers=h).json() if e["netid"] == "bob")
    patch_url = world.url(f"/host/courses/{world.course_a}/roster/{entry['id']}")
    assert httpx.patch(patch_url, json={"is_active": True}, headers=h).json()["is_active"] is True
    wrong_course = world.url(f"/host/courses/{world.course_b}/roster/{entry['id']}")
    assert httpx.patch(wrong_course, json={"is_active": False}, headers=h).status_code == 403


# ---------------------------------------------------------------------------
# 7. Session results visible to any HOST of the course (D3)
# ---------------------------------------------------------------------------


async def test_any_course_host_can_download_results_but_not_delete(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    world.add_question(world.host_a["h"], game)
    session_id, host, player = await _start_session(world, game, world.course_a, answer=True)
    await _finish(host, player, n_questions=1)

    co_host = world.host_a2["h"]  # HOST of course A, but did not run the session
    listed = httpx.get(world.url(f"/host/courses/{world.course_a}/sessions"), headers=co_host).json()
    item = next(s for s in listed if s["session_id"] == session_id)
    assert item["status"] == "COMPLETED" and item["player_count"] == 1

    r = httpx.get(world.url(f"/host/sessions/{session_id}/export"), headers=co_host)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    assert list(csv.reader(io.StringIO(r.text)))[1][-1] == "1.0"

    r = httpx.get(world.url(f"/host/sessions/{session_id}/report"), headers=co_host)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert "2 + 2 = ?" in r.text

    # A player of the same course can't see it.
    assert httpx.get(world.url(f"/host/sessions/{session_id}/export"), headers=world.player_a["h"]).status_code == 403

    # Deleting stays creator-or-admin.
    assert httpx.delete(world.url(f"/game/sessions/{session_id}"), headers=co_host).status_code == 403
    assert any(
        s["session_id"] == session_id
        for s in httpx.get(world.url(f"/host/courses/{world.course_a}/sessions"), headers=co_host).json()
    )
