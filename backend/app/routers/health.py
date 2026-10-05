from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..redis_client import get_redis
from ..services import state_service as state

router = APIRouter(tags=["health"])
logger = structlog.get_logger()


@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    mysql_status = "disconnected"
    redis_status = "disconnected"
    active_rooms = 0
    active_players = 0

    try:
        await db.execute(text("SELECT 1"))
        mysql_status = "connected"
    except Exception as e:
        logger.error("health_mysql_fail", error=str(e))

    try:
        redis = await get_redis()
        await redis.ping()
        redis_status = "connected"

        # Count rooms still in LOBBY / IN_PROGRESS and their players. Players live
        # under session:{id}:players (state_service), not room:{code}:players, and
        # a finished room's key lingers for its TTL, so status must be checked.
        # SCAN, not KEYS, so a busy Redis isn't blocked.
        async for key in redis.scan_iter(match="room:*"):
            room = await state.get_room_state(redis, key.removeprefix("room:"))
            if not room or room.get("status") not in ("LOBBY", "IN_PROGRESS"):
                continue
            active_rooms += 1
            active_players += await state.get_player_count(redis, room["session_id"])
    except Exception as e:
        logger.error("health_redis_fail", error=str(e))

    overall = (
        "healthy"
        if mysql_status == "connected" and redis_status == "connected"
        else "degraded"
    )

    return {
        "status": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {
            "mysql": mysql_status,
            "redis": redis_status,
        },
        "activeRooms": active_rooms,
        "activePlayers": active_players,
    }
