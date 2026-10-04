"""Host management API: /api/host/*  (docs/design-t4-host.md, step 5)

Every route requires an authenticated non-guest user, then authorizes by
course: ADMIN, or HOST of the course that owns the resource. Business logic
lives in services/ and is shared with the admin router.
"""

from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..common.dependencies import require_user
from ..common.exceptions import NotFoundError
from ..database import get_db
from ..models.course import CourseRoster
from ..models.game import Game, Question
from ..models.session import GameSession, SessionScore
from ..models.user import User
from ..redis_client import get_redis
from ..schemas.admin import (
    GameResponse,
    QuestionCreate,
    QuestionReorder,
    QuestionResponse,
    QuestionUpdate,
    RosterEntryResponse,
    RosterImportPayload,
    RosterUploadResult,
)
from ..schemas.game import (
    HostGameCreate,
    HostGameUpdate,
    HostRosterActivePatch,
    HostSessionItem,
)
from ..services import question_service
from ..services.export_service import build_session_csv
from ..services.game_service import (
    assert_host_can_manage_game,
    assert_host_can_use_course,
    assert_host_can_view_session,
)
from ..services.report_service import build_session_report
from ..services.roster_service import process_roster_rows

router = APIRouter(prefix="/host", tags=["host"])
logger = structlog.get_logger()

HostUser = Annotated[User, Depends(require_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


# ---------------------------------------------------------------------------
# Games
# ---------------------------------------------------------------------------


@router.get("/courses/{course_id}/games", response_model=list[GameResponse])
async def list_course_games(course_id: int, user: HostUser, db: DB) -> list[Game]:
    await assert_host_can_use_course(db, user, course_id)
    result = await db.execute(
        select(Game).where(Game.course_id == course_id).order_by(Game.title)
    )
    return result.scalars().all()


@router.post("/courses/{course_id}/games", response_model=GameResponse, status_code=201)
async def create_course_game(
    course_id: int, body: HostGameCreate, user: HostUser, db: DB
) -> Game:
    await assert_host_can_use_course(db, user, course_id)
    game = Game(
        title=body.title,
        description=body.description,
        max_players=body.max_players,
        course_id=course_id,
    )
    db.add(game)
    await db.flush()
    await db.refresh(game)
    logger.info("host_game_created", game_id=game.id, course_id=course_id)
    return game


@router.get("/games/{game_id}", response_model=GameResponse)
async def get_game(game_id: int, user: HostUser, db: DB) -> Game:
    return await assert_host_can_manage_game(db, user, game_id)


@router.put("/games/{game_id}", response_model=GameResponse)
async def update_game(
    game_id: int, body: HostGameUpdate, user: HostUser, db: DB
) -> Game:
    game = await assert_host_can_manage_game(db, user, game_id)
    if body.title is not None:
        game.title = body.title
    if body.description is not None:
        game.description = body.description
    if body.max_players is not None:
        game.max_players = body.max_players
    return game


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------


@router.get("/games/{game_id}/questions", response_model=list[QuestionResponse])
async def list_questions(game_id: int, user: HostUser, db: DB) -> list[Question]:
    await assert_host_can_manage_game(db, user, game_id)
    result = await db.execute(
        select(Question)
        .where(Question.game_id == game_id)
        .order_by(Question.order_index)
    )
    return result.scalars().all()


@router.post(
    "/games/{game_id}/questions", response_model=QuestionResponse, status_code=201
)
async def create_question(
    game_id: int,
    body: QuestionCreate,
    user: HostUser,
    db: DB,
    redis=Depends(get_redis),
) -> Question:
    game = await assert_host_can_manage_game(db, user, game_id)
    return await question_service.create(db, redis, game, body)


@router.put("/games/{game_id}/questions/{question_id}", response_model=QuestionResponse)
async def update_question(
    game_id: int,
    question_id: int,
    body: QuestionUpdate,
    user: HostUser,
    db: DB,
    redis=Depends(get_redis),
) -> Question:
    game = await assert_host_can_manage_game(db, user, game_id)
    return await question_service.update(db, redis, game, question_id, body)


@router.delete("/games/{game_id}/questions/{question_id}", status_code=204)
async def delete_question(
    game_id: int,
    question_id: int,
    user: HostUser,
    db: DB,
    redis=Depends(get_redis),
) -> None:
    game = await assert_host_can_manage_game(db, user, game_id)
    await question_service.delete(db, redis, game, question_id)


@router.post("/games/{game_id}/questions/reorder", status_code=204)
async def reorder_questions(
    game_id: int,
    body: QuestionReorder,
    user: HostUser,
    db: DB,
    redis=Depends(get_redis),
) -> None:
    game = await assert_host_can_manage_game(db, user, game_id)
    await question_service.reorder(db, redis, game, body.order)


# ---------------------------------------------------------------------------
# Roster
# ---------------------------------------------------------------------------


@router.get("/courses/{course_id}/roster", response_model=list[RosterEntryResponse])
async def get_roster(course_id: int, user: HostUser, db: DB) -> list[CourseRoster]:
    await assert_host_can_use_course(db, user, course_id)
    result = await db.execute(
        select(CourseRoster)
        .where(CourseRoster.course_id == course_id)
        .order_by(CourseRoster.full_name)
    )
    return result.scalars().all()


@router.post("/courses/{course_id}/roster/import", response_model=RosterUploadResult)
async def import_roster(
    course_id: int, payload: RosterImportPayload, user: HostUser, db: DB
) -> RosterUploadResult:
    """Full replace: upsert listed rows, deactivate active netids not listed (D4)."""
    await assert_host_can_use_course(db, user, course_id)
    rows = [
        {"netid": r.netid, "full_name": r.full_name, "email": r.email}
        for r in payload.rows
    ]
    return await process_roster_rows(db, course_id, rows)


@router.patch(
    "/courses/{course_id}/roster/{roster_id}", response_model=RosterEntryResponse
)
async def set_roster_entry_active(
    course_id: int,
    roster_id: int,
    body: HostRosterActivePatch,
    user: HostUser,
    db: DB,
) -> CourseRoster:
    await assert_host_can_use_course(db, user, course_id)
    result = await db.execute(
        select(CourseRoster).where(
            CourseRoster.id == roster_id, CourseRoster.course_id == course_id
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise NotFoundError(f"Roster entry {roster_id} not found in course {course_id}")
    entry.is_active = body.is_active
    return entry


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


@router.get("/courses/{course_id}/sessions", response_model=list[HostSessionItem])
async def list_course_sessions(course_id: int, user: HostUser, db: DB) -> list[dict]:
    await assert_host_can_use_course(db, user, course_id)
    player_counts = (
        select(
            SessionScore.session_id,
            func.count(SessionScore.user_id.distinct()).label("players"),
        )
        .group_by(SessionScore.session_id)
        .subquery()
    )
    result = await db.execute(
        select(GameSession, Game.title, player_counts.c.players)
        .join(Game, Game.id == GameSession.game_id)
        .outerjoin(player_counts, player_counts.c.session_id == GameSession.id)
        .where(GameSession.course_id == course_id)
        .order_by(GameSession.created_at.desc())
    )
    return [
        {
            "session_id": s.id,
            "room_code": s.room_code,
            "status": s.status,
            "game_id": s.game_id,
            "game_title": title,
            "created_at": s.created_at,
            "completed_at": s.completed_at,
            "player_count": players or 0,
        }
        for s, title, players in result.all()
    ]


@router.get("/sessions/{session_id}/export")
async def export_session_csv(
    session_id: str, user: HostUser, db: DB
) -> StreamingResponse:
    await assert_host_can_view_session(db, user, session_id)
    filename, content = await build_session_csv(db, session_id)
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sessions/{session_id}/report")
async def export_session_report(session_id: str, user: HostUser, db: DB) -> Response:
    await assert_host_can_view_session(db, user, session_id)
    filename, content = await build_session_report(db, session_id)
    return Response(
        content=content,
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
