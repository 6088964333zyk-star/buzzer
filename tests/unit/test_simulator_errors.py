"""scripts/simulate_players.py must report the gateway's `error` events.

The gateway answers a refused join or answer with `error` instead of the
expected event; the simulator used to queue it and never read it.
"""

import asyncio
import dataclasses
import importlib.util
import sys
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[2] / "scripts" / "simulate_players.py"
_spec = importlib.util.spec_from_file_location("simulate_players", _PATH)
sim = importlib.util.module_from_spec(_spec)
sys.modules["simulate_players"] = sim  # @dataclass looks the module up
_spec.loader.exec_module(sim)


def _player() -> "sim.SimPlayer":
    profile = dataclasses.replace(
        next(iter(sim.PROFILES.values())),
        min_delay=0,
        max_delay=0,
        skip_prob=0,
        join_delay_min=0,
        join_delay_max=0,
    )
    return sim.SimPlayer(1, "Sim 1", "tok", "http://x", profile, [], None)


async def test_wait_or_error_returns_the_event():
    p = _player()
    await p._queues["sync_state"].put({"ok": 1})
    assert await p._wait_or_error("sync_state", timeout=1) == {"ok": 1}


async def test_wait_or_error_raises_the_server_message():
    p = _player()
    await p._queues["error"].put({"message": "Room not found"})
    with pytest.raises(sim.ServerError, match="Room not found"):
        await p._wait_or_error("sync_state", timeout=1)


async def test_wait_or_error_times_out():
    p = _player()
    with pytest.raises(asyncio.TimeoutError):
        await p._wait_or_error("sync_state", timeout=0.05)


async def test_refused_join_is_printed(capsys):
    p = _player()

    async def emit(event, data=None):
        await p._queues["error"].put({"message": "Not allowed in this room"})

    p.sio.emit = emit
    await asyncio.wait_for(p.run("ABCDE1"), timeout=2)
    assert "join refused: Not allowed in this room" in capsys.readouterr().out


async def test_rejected_answer_is_printed(capsys):
    p = _player()

    async def emit(event, data=None):
        await p._queues["error"].put({"message": "Question is locked"})

    p.sio.emit = emit
    q = {"type": "true_false", "questionId": 7, "questionNumber": 1}
    await p._handle_question(q)
    assert "rejected: Question is locked" in capsys.readouterr().out


async def test_stale_error_is_not_blamed_on_the_next_answer(capsys):
    p = _player()
    await p._queues["error"].put({"message": "old error"})

    async def emit(event, data=None):
        await p._queues["answer_received"].put({"pointsAwarded": 5, "isCorrect": True})

    p.sio.emit = emit
    await p._handle_question(
        {"type": "true_false", "questionId": 7, "questionNumber": 1}
    )
    out = capsys.readouterr().out
    assert "old error" not in out and "5 pts" in out
