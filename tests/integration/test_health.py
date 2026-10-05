"""
Integration test for /api/health room and player counts. Before this fix the
endpoint read room:{code}:players (a key nothing writes), so activePlayers was
always 0, and it counted finished rooms as active.
"""

from __future__ import annotations

import httpx
import pytest

from .test_host_api import World, _finish, _start_session

_T = 10.0


@pytest.fixture(scope="module")
def world(docker_stack, base_url, admin_token):
    w = World(base_url, admin_token)
    yield w
    w.cleanup()


def _counts(world: World) -> tuple[int, int]:
    body = httpx.get(world.url("/health"), timeout=_T).json()
    return body["activeRooms"], body["activePlayers"]


async def test_counts_follow_a_room_through_its_game(world: World):
    h = world.host_a["h"]
    game = world.host_game(h, world.course_a)
    world.add_question(h, game)
    rooms_before, players_before = _counts(world)

    # One room, one joined player, game in progress.
    _, host, player = await _start_session(world, game, world.course_a, answer=False)
    assert _counts(world) == (rooms_before + 1, players_before + 1)

    # Finished: the room key lingers in Redis, but it is no longer active.
    await _finish(host, player, n_questions=1)
    assert _counts(world) == (rooms_before, players_before)
