"""
Integration tests for the host's post-game guest merge
(POST /api/game/sessions/{id}/merge-guest).

Before this fix any session host could merge any guest in the system (all of
its scores, from every session) into any account and delete the guest.
"""

from __future__ import annotations

import csv
import io

import httpx
import pytest

from .test_host_api import World, _finish, _start_session

_T = 10.0


@pytest.fixture(scope="module")
def world(docker_stack, base_url, admin_token):
    w = World(base_url, admin_token)
    yield w
    w.cleanup()


def _netid_user(world: World, netid: str) -> None:
    """Create a NetID account through the dev-only netid login."""
    r = httpx.post(world.url("/auth/login"), json={"netid": netid}, timeout=_T)
    assert r.status_code == 200, r.text


def _merge(world: World, session_id: str, body: dict, headers: dict) -> httpx.Response:
    return httpx.post(
        world.url(f"/game/sessions/{session_id}/merge-guest"),
        json=body,
        headers=headers,
        timeout=_T,
    )


def _guests(world: World, session_id: str) -> list[str]:
    r = httpx.get(
        world.url(f"/game/sessions/{session_id}/guests"), headers=world.host_a["h"], timeout=_T
    )
    assert r.status_code == 200, r.text
    return [g["id"] for g in r.json()]


async def test_merge_is_scoped_to_the_session_and_its_course(world: World):
    h = world.host_a["h"]
    game = world.host_game(h, world.course_a)
    world.add_question(h, game)
    session_id, host, player = await _start_session(world, game, world.course_a, answer=True)
    await _finish(host, player, n_questions=1)
    (guest_id,) = _guests(world, session_id)

    student, outsider = f"stu{world.tag}", f"out{world.tag}"
    _netid_user(world, student)
    _netid_user(world, outsider)
    r = httpx.post(
        world.url(f"/host/courses/{world.course_a}/roster/import"),
        json={"rows": [{"netid": student, "full_name": "Stu", "email": f"{student}@example.edu"}]},
        headers=h,
        timeout=_T,
    )
    assert r.status_code == 200, r.text

    # Malformed body: 422 (was 409 for a missing field).
    assert _merge(world, session_id, {"guest_user_id": guest_id}, h).status_code == 422

    # Another host of the same course didn't run this session.
    body = {"guest_user_id": guest_id, "target_netid": student}
    assert _merge(world, session_id, body, world.host_a2["h"]).status_code == 403

    # A guest from this session can't be merged via a different session.
    other = world.room(h, world.course_a, game).json()["session_id"]
    r = _merge(world, other, body, h)
    assert r.status_code == 404 and "did not play in this session" in r.json()["message"]

    # The target must belong to the session's course.
    r = _merge(world, session_id, {"guest_user_id": guest_id, "target_netid": outsider}, h)
    assert r.status_code == 403 and "not in this session's course" in r.json()["message"]
    assert _guests(world, session_id) == [guest_id]  # nothing changed

    # A course student works: the guest is gone and the score moved.
    assert _merge(world, session_id, body, h).status_code == 204
    assert _guests(world, session_id) == []
    rows = list(csv.reader(io.StringIO(
        httpx.get(world.url(f"/host/sessions/{session_id}/export"), headers=h, timeout=_T).text
    )))
    assert len(rows) == 2 and float(rows[1][-1]) == 1.0
