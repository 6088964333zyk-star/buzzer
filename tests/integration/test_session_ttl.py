"""
Integration test: Redis session:{id}:* keys must expire. Before this fix they
were written with no TTL, so every finished game and every abandoned lobby left
its players, questions, answered sets and distributions in Redis for good.

Reads TTLs with redis-cli inside the stack's redis container (Redis is not
published on a host port).
"""

from __future__ import annotations

import subprocess

import pytest

from .test_host_api import World, _finish, _start_session

ROOM_TTL = 90 * 60
SESSION_TTL = 24 * 60 * 60


def _redis(*args: str) -> list[str]:
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "redis", "redis-cli", *args],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [line for line in out.splitlines() if line]


def _session_ttls(session_id: str) -> dict[str, int]:
    keys = _redis("--scan", "--pattern", f"session:{session_id}:*")
    return {k: int(_redis("TTL", k)[0]) for k in keys}


@pytest.fixture(scope="module")
def world(docker_stack, base_url, admin_token):
    w = World(base_url, admin_token)
    yield w
    w.cleanup()


async def test_session_keys_expire_and_shrink_at_game_over(world: World):
    h = world.host_a["h"]
    game = world.host_game(h, world.course_a)
    world.add_question(h, game)

    # In progress, one answer in: players, player, question, answered, dist.
    session_id, host, player = await _start_session(
        world, game, world.course_a, answer=True
    )
    ttls = _session_ttls(session_id)
    kinds = {k.split(":")[2] for k in ttls}
    assert {"players", "player", "question", "answered", "dist"} <= kinds, ttls
    assert all(0 < t <= SESSION_TTL for t in ttls.values()), ttls

    # Game over: everything now lives only as long as the room key.
    await _finish(host, player, n_questions=1)
    ttls = _session_ttls(session_id)
    assert ttls, "state should linger for reconnects, not vanish at once"
    assert all(0 < t <= ROOM_TTL for t in ttls.values()), ttls
