"""
Integration tests for the rejoin_room socket event's role inference.

Before this fix, rejoin_room made any ADMIN the host, so an admin who had
joined a room as a player was silently promoted to host on reconnect.
"""

from __future__ import annotations

import httpx
import pytest

from .engine.socket_client import TestSocketClient
from .test_host_api import World, _finish, _start_session

_T = 10.0


@pytest.fixture(scope="module")
def world(docker_stack, base_url, admin_token):
    w = World(base_url, admin_token)
    yield w
    w.cleanup()


def _admin_token(world: World) -> str:
    return world.admin["Authorization"].removeprefix("Bearer ")


async def _rejoin(world: World, token: str, room_code: str, event: str) -> dict:
    client = TestSocketClient(world.base, token, "rejoin")
    await client.connect()
    try:
        await client.emit("rejoin_room", {"room_code": room_code})
        return await client.wait_for(event, _T)
    finally:
        await client.disconnect()


async def test_admin_player_stays_a_player_on_rejoin(world: World):
    h = world.host_a["h"]
    game = world.host_game(h, world.course_a)
    world.add_question(h, game)
    room_code = world.room(h, world.course_a, game).json()["room_code"]

    admin = TestSocketClient(world.base, _admin_token(world), "admin-player")
    await admin.connect()
    await admin.emit("join_room", {"room_code": room_code, "role": "PLAYER"})
    assert (await admin.wait_for("sync_state", _T))["role"] == "PLAYER"
    await admin.disconnect()

    synced = await _rejoin(world, _admin_token(world), room_code, "sync_state")
    assert synced["role"] == "PLAYER"


async def test_admin_who_is_not_playing_can_still_take_over(world: World):
    h = world.host_a["h"]
    game = world.host_game(h, world.course_a)
    world.add_question(h, game)
    room_code = world.room(h, world.course_a, game).json()["room_code"]

    synced = await _rejoin(world, _admin_token(world), room_code, "sync_state")
    assert synced["role"] == "HOST"


async def test_rejoin_cannot_add_a_new_player_to_a_finished_game(world: World):
    h = world.host_a["h"]
    game = world.host_game(h, world.course_a)
    world.add_question(h, game)
    session_id, host, player = await _start_session(world, game, world.course_a, answer=False)
    await _finish(host, player, n_questions=1)
    sessions = httpx.get(
        world.url(f"/host/courses/{world.course_a}/sessions"), headers=h, timeout=_T
    ).json()
    room_code = next(s["room_code"] for s in sessions if s["session_id"] == session_id)

    # player_a (a course PLAYER) never joined that game, which is COMPLETED now.
    err = await _rejoin(world, world.player_a["token"], room_code, "error")
    assert "not accepting players" in err.get("message", "")
