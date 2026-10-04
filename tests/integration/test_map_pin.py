"""
Integration tests for the map_pin question type (docs/design-t7-map-question.md,
Step 12). Uses the host-API fixtures from test_host_api.py.
"""

from __future__ import annotations

import csv
import io
import json

import httpx
import pytest

from .conftest import create_guest_tokens
from .engine.socket_client import TestSocketClient
from .test_host_api import World

_T = 10.0

MAP_QUESTION = {
    "type": "map_pin",
    "grading_type": "ACCURACY",
    "prompt": "Where is the Camp Nou?",
    "config": {"aspectRatio": 2},
    "answer_data": {"target": {"x": 0.5, "y": 0.5}, "fullRadius": 0.02, "zeroRadius": 0.12},
    "points_value": 10,
    "time_limit_seconds": 60,
}


@pytest.fixture(scope="module")
def world(docker_stack, base_url, admin_token):
    w = World(base_url, admin_token)
    yield w
    w.cleanup()


def _create(world: World, game: int, body: dict) -> httpx.Response:
    return httpx.post(
        world.url(f"/host/games/{game}/questions"), json=body, headers=world.host_a["h"]
    )


def test_map_question_validation_on_create_and_update(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    r = _create(world, game, MAP_QUESTION)
    assert r.status_code == 201, r.text
    qid = r.json()["id"]

    bad_radii = {**MAP_QUESTION, "answer_data": {**MAP_QUESTION["answer_data"], "fullRadius": 0.2}}
    assert _create(world, game, bad_radii).status_code == 422
    bad_target = {**MAP_QUESTION, "answer_data": {**MAP_QUESTION["answer_data"], "target": {"x": 2, "y": 0}}}
    assert _create(world, game, bad_target).status_code == 422
    no_target = {**MAP_QUESTION, "grading_type": "COMPLETENESS", "answer_data": {}}
    assert _create(world, game, no_target).status_code == 422

    before = world.questions(game)
    r = httpx.put(
        world.url(f"/host/games/{game}/questions/{qid}"),
        json={"answer_data": {**MAP_QUESTION["answer_data"], "zeroRadius": 0.01}},
        headers=world.host_a["h"],
    )
    assert r.status_code == 422
    assert world.questions(game) == before


async def test_scoring_reveal_and_bad_payloads_over_socket(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    assert _create(world, game, MAP_QUESTION).status_code == 201

    r = world.room(world.host_a["h"], world.course_a, game)
    room_code, session_id = r.json()["room_code"], r.json()["session_id"]
    tokens = create_guest_tokens(world.base, room_code, 4)
    host = TestSocketClient(world.base, world.host_a["token"], "host")
    players = [TestSocketClient(world.base, t, f"p{i}") for i, t in enumerate(tokens)]
    clients = [host, *players]
    try:
        for c in clients:
            await c.connect()
        await host.emit("join_room", {"room_code": room_code, "role": "HOST"})
        for p in players:
            await p.emit("join_room", {"room_code": room_code, "role": "PLAYER"})
        for c in clients:
            await c.wait_for("sync_state", _T)
        await host.emit("host_advance", {})
        q = await players[0].wait_for("new_question", _T)
        assert "target" not in json.dumps(q), "answer must not leak to players"
        for p in players[1:]:
            await p.wait_for("new_question", _T)

        async def answer(p, point):
            await p.emit(
                "submit_answer",
                {"question_id": q["questionId"], "answer_data": {"point": point}, "answer_time_ms": 900},
            )

        # on target, midway (d = 0.07), far, and a malformed payload
        await answer(players[0], {"x": 0.5, "y": 0.5})
        await answer(players[1], {"x": 0.57, "y": 0.5})
        await answer(players[2], {"x": 0.9, "y": 0.1})
        await answer(players[3], {"x": True, "y": 0})

        acks = [await p.wait_for("answer_received", _T) for p in players[:3]]
        assert acks[0]["pointsAwarded"] == 10 and acks[0]["isCorrect"] is True
        assert acks[1]["pointsAwarded"] == pytest.approx(5, abs=0.01)
        assert acks[2]["pointsAwarded"] == 0
        err = await players[3].wait_for("error", _T)
        assert "map_pin" in json.dumps(err)
        await answer(players[3], {"x": 2, "y": 0.5})
        assert "map_pin" in json.dumps(await players[3].wait_for("error", _T))

        await host.emit("host_advance", {})
        results = await host.wait_for("question_results", _T)
        dist = results.get("answerDist") or results.get("answer_dist") or results.get("distribution")
        dumped = json.dumps(results)
        for key in ("100:50", "114:50", "180:10"):
            assert key in dumped, (key, dist)
        assert '"type": "map_pin"' in dumped and '"fullRadius": 0.02' in dumped

        await host.emit("host_advance", {})
        await host.wait_for("game_over", _T)
    finally:
        for c in clients:
            await c.disconnect()

    # The malformed guess never produced a score row.
    rows = list(csv.reader(io.StringIO(
        httpx.get(world.url(f"/host/sessions/{session_id}/export"), headers=world.host_a["h"]).text
    )))
    assert len(rows) == 1 + 3
    assert sorted(float(r[-1]) for r in rows[1:]) == [0.0, 5.0, 10.0]


def test_import_export_round_trip(world: World):
    bundle = {
        "format": "buzzer/game",
        "version": 1,
        "game": {"title": f"Map round trip {world.tag}"},
        "questions": [MAP_QUESTION],
    }
    r = httpx.post(
        world.url("/admin/games/import"),
        headers=world.admin,
        files={"file": ("g.json", json.dumps(bundle), "application/json")},
    )
    assert r.status_code == 201, r.text
    game_id = r.json()["game_id"]
    world.game_ids.append(game_id)
    exported = httpx.get(world.url(f"/admin/games/{game_id}/export"), headers=world.admin).json()
    q = exported["questions"][0]
    assert q["type"] == "map_pin"
    assert q["config"] == MAP_QUESTION["config"]
    assert q["answer_data"] == MAP_QUESTION["answer_data"]
