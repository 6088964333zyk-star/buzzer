"""
Unit tests for question_service.assert_no_live_session (design D8).

The Redis half of the rule can't be driven from the integration suite (Redis
isn't exposed to the host), so it is tested here with fakes.

Run with:
    PYTHONPATH=backend pytest tests/unit/test_question_service.py
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.common.exceptions import ConflictError
from app.services import question_service


def _db_with_in_progress_rooms(room_codes: list[str]) -> MagicMock:
    result = MagicMock()
    result.scalars.return_value.all.return_value = room_codes
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


async def test_in_progress_session_with_live_room_blocks_edits():
    db = _db_with_in_progress_rooms(["ABC123"])
    with patch.object(
        question_service.state,
        "get_room_state",
        AsyncMock(return_value={"status": "IN_PROGRESS"}),
    ):
        with pytest.raises(ConflictError):
            await question_service.assert_no_live_session(db, MagicMock(), game_id=1)


async def test_in_progress_session_whose_room_expired_does_not_block():
    # e.g. a backend restart lost the abandon task; the room key has since expired
    db = _db_with_in_progress_rooms(["ABC123"])
    get_room_state = AsyncMock(return_value=None)
    with patch.object(question_service.state, "get_room_state", get_room_state):
        await question_service.assert_no_live_session(db, MagicMock(), game_id=1)
    get_room_state.assert_awaited_once()


async def test_no_in_progress_sessions_does_not_touch_redis():
    db = _db_with_in_progress_rooms([])
    get_room_state = AsyncMock()
    with patch.object(question_service.state, "get_room_state", get_room_state):
        await question_service.assert_no_live_session(db, MagicMock(), game_id=1)
    get_room_state.assert_not_awaited()
