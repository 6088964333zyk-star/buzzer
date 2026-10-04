"""
Integration tests for the numeric question type (docs/design-t7-numeric.md,
section 5). Uses the host-API fixtures from test_host_api.py, like test_map_pin.py.
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

NUMERIC_QUESTION = {
    "type": "numeric",
    "grading_type": "ACCURACY",
    "prompt": "Estimate the correlation coefficient",
    "config": {},
    "answer_data": {
        "answer": 0.62,
        "toleranceMode": "absolute",
        "fullTolerance": 0.05,
        "zeroTolerance": 0.15,
    },
    "points_value": 10,
    "time_limit_seconds": 60,
}

PERCENT_QUESTION = {
    **NUMERIC_QUESTION,
    "prompt": "Speed of sound in air?",
    "config": {"unit": "m/s"},
    "answer_data": {
        "answer": 343,
        "toleranceMode": "percent",
        "fullTolerance": 5,
        "zeroTolerance": 20,
    },
}


@pytest.fixture(scope="module")
def world(docker_stack, base_url, admin_token):
    w = World(base_url, admin_token)
    yield w
    w.cleanup()


def _create(world: World, game: int, body: dict) -> httpx.Response:
    return httpx.post(
        world.url(f"/host/games/{game}/questions"),
        json=body,
        headers=world.host_a["h"],
        timeout=_T,
    )


def _with_answer_data(**changes) -> dict:
    return {
        **NUMERIC_QUESTION,
        "answer_data": {**NUMERIC_QUESTION["answer_data"], **changes},
    }


# ---------------------------------------------------------------------------
# 1. Validation on create and update
# ---------------------------------------------------------------------------


def test_numeric_validation_on_create_and_update(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    r = _create(world, game, NUMERIC_QUESTION)
    assert r.status_code == 201, r.text
    qid = r.json()["id"]
    assert _create(world, game, PERCENT_QUESTION).status_code == 201

    bad = [
        _with_answer_data(fullTolerance=0.2),  # full >= zero
        _with_answer_data(answer=0, toleranceMode="percent"),
        _with_answer_data(answer=True),
        {**NUMERIC_QUESTION, "config": {"unit": "x" * 21}},
    ]
    for body in bad:
        r = _create(world, game, body)
        assert r.status_code == 422, (body, r.text)
        # Request validation: the message is inside the 422's detail array.
        assert "numeric" in json.dumps(r.json()["detail"])

    before = world.questions(game)
    r = httpx.put(
        world.url(f"/host/games/{game}/questions/{qid}"),
        json={"answer_data": _with_answer_data(zeroTolerance=0.01)["answer_data"]},
        headers=world.host_a["h"],
        timeout=_T,
    )
    assert r.status_code == 422
    assert world.questions(game) == before


# ---------------------------------------------------------------------------
# 2 + 3. Scoring, buckets and bad payloads over Socket.IO
# ---------------------------------------------------------------------------


async def test_scoring_buckets_and_bad_payloads_over_socket(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    assert _create(world, game, NUMERIC_QUESTION).status_code == 201

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
        dumped_q = json.dumps(q)
        assert "toleranceMode" not in dumped_q and '"answer"' not in dumped_q, (
            "answer must not leak to players"
        )
        for p in players[1:]:
            await p.wait_for("new_question", _T)

        async def answer(p, answer_data):
            await p.emit(
                "submit_answer",
                {
                    "question_id": q["questionId"],
                    "answer_data": answer_data,
                    "answer_time_ms": 900,
                },
            )

        # exact, midway (d = 0.10 between 0.05 and 0.15), beyond zero
        await answer(players[0], {"value": 0.62})
        await answer(players[1], {"value": 0.72})
        await answer(players[2], {"value": 0.95})
        acks = [await p.wait_for("answer_received", _T) for p in players[:3]]
        assert acks[0]["pointsAwarded"] == 10 and acks[0]["isCorrect"] is True
        assert acks[1]["pointsAwarded"] == pytest.approx(5, abs=0.01)
        assert acks[1]["isCorrect"] is False
        assert acks[2]["pointsAwarded"] == 0

        # Malformed payloads are rejected and don't use up the answer (N4).
        for bad in ({"value": "0.6"}, {"value": True}, {}):
            await answer(players[3], bad)
            err = await players[3].wait_for("error", _T)
            assert "numeric" in json.dumps(err), (bad, err)
        await answer(players[3], {"value": 0.6})
        ack = await players[3].wait_for("answer_received", _T)
        assert ack["pointsAwarded"] == 10

        await host.emit("host_advance", {})
        results = await host.wait_for("question_results", _T)
        dist = results["answerDistribution"]
        assert dist == {"full": 2, "partial_high": 1, "zero_high": 1}, dist
        reveal = results["answerReveal"]
        assert reveal["type"] == "numeric" and reveal["answer"] == 0.62
        assert reveal["toleranceMode"] == "absolute"

        await host.emit("host_advance", {})
        await host.wait_for("game_over", _T)
    finally:
        for c in clients:
            await c.disconnect()

    rows = list(
        csv.reader(
            io.StringIO(
                httpx.get(
                    world.url(f"/host/sessions/{session_id}/export"),
                    headers=world.host_a["h"],
                    timeout=_T,
                ).text
            )
        )
    )
    assert len(rows) == 1 + 4
    assert sorted(float(r[-1]) for r in rows[1:]) == [0.0, 5.0, 10.0, 10.0]

    report = httpx.get(
        world.url(f"/host/sessions/{session_id}/report"),
        headers=world.host_a["h"],
        timeout=_T,
    ).text
    assert "Answer 0.62 · 4 guesses · 2 within full credit" in report
    assert "0 under / 2 over" in report
    assert "zero_high" not in report  # bucket keys are never drawn as bars


# ---------------------------------------------------------------------------
# 4. Import / export round trip
# ---------------------------------------------------------------------------


def test_import_export_round_trip(world: World):
    bundle = {
        "format": "buzzer/game",
        "version": 1,
        "game": {"title": f"Numeric round trip {world.tag}"},
        "questions": [NUMERIC_QUESTION, PERCENT_QUESTION],
    }
    r = httpx.post(
        world.url("/admin/games/import"),
        headers=world.admin,
        files={"file": ("g.json", json.dumps(bundle), "application/json")},
        timeout=_T,
    )
    assert r.status_code == 201, r.text
    game_id = r.json()["game_id"]
    world.game_ids.append(game_id)
    exported = httpx.get(
        world.url(f"/admin/games/{game_id}/export"), headers=world.admin, timeout=_T
    ).json()
    for original, q in zip(
        (NUMERIC_QUESTION, PERCENT_QUESTION), exported["questions"], strict=True
    ):
        assert q["type"] == "numeric"
        assert q["config"] == original["config"]
        assert q["answer_data"] == original["answer_data"]
