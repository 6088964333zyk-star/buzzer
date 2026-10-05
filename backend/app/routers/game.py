from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..common.dependencies import get_current_user, require_user
from ..common.exceptions import NotFoundError
from ..config import settings
from ..database import get_db
from ..models.course import Course, UserCourseAccess
from ..models.game import Game, Question
from ..models.session import GameSession
from ..models.user import User
from ..redis_client import get_redis
from ..schemas.game import (
    ActiveSessionItem,
    MyCourseItem,
    HostMergeGuest,
    MyGameItem,
    RoomCreateRequest,
    RoomCreateResponse,
    RoomInfoResponse,
)
from ..services import game_service
from ..services import state_service as state

router = APIRouter(prefix="/game", tags=["game"])
logger = structlog.get_logger()


# ---------------------------------------------------------------------------
# Host resource discovery
# ---------------------------------------------------------------------------


@router.get("/my-courses", response_model=list[MyCourseItem])
async def my_courses(
    user: Annotated[User, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
    """
    Returns courses the authenticated user can host.
    ADMIN sees all courses; USER sees courses with HOST role in user_course_access.
    """
    if user.role == "ADMIN":
        result = await db.execute(
            select(Course).order_by(Course.semester.desc(), Course.name)
        )
        return [
            {"id": c.id, "name": c.name, "semester": c.semester, "role": "HOST"}
            for c in result.scalars().all()
        ]

    result = await db.execute(
        select(Course, UserCourseAccess)
        .join(UserCourseAccess, UserCourseAccess.course_id == Course.id)
        .where(
            UserCourseAccess.user_id == user.id,
            UserCourseAccess.role == "HOST",
        )
        .order_by(Course.semester.desc(), Course.name)
    )
    return [
        {"id": c.id, "name": c.name, "semester": c.semester, "role": uca.role}
        for c, uca in result.all()
    ]


@router.get("/my-games", response_model=list[MyGameItem])
async def my_games(
    user: Annotated[User, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[Game]:
    """
    Returns games the authenticated user can run.
    ADMIN sees all games; USER sees games owned by courses where they are HOST.
    """
    if user.role == "ADMIN":
        result = await db.execute(select(Game).order_by(Game.title))
        return result.scalars().all()

    result = await db.execute(
        select(Game)
        .join(UserCourseAccess, UserCourseAccess.course_id == Game.course_id)
        .where(
            UserCourseAccess.user_id == user.id,
            UserCourseAccess.role == "HOST",
        )
        .order_by(Game.title)
    )
    return result.scalars().all()


@router.get("/my-active-sessions", response_model=list[ActiveSessionItem])
async def my_active_sessions(
    user: Annotated[User, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
    """Returns LOBBY/IN_PROGRESS sessions hosted by the current user."""
    result = await db.execute(
        select(GameSession)
        .where(
            GameSession.host_user_id == user.id,
            GameSession.status.in_(["LOBBY", "IN_PROGRESS"]),
        )
        .order_by(GameSession.created_at.desc())
    )
    sessions = result.scalars().all()

    rows = []
    for s in sessions:
        game = await db.get(Game, s.game_id)
        course = await db.get(Course, s.course_id)
        rows.append(
            {
                "session_id": s.id,
                "room_code": s.room_code,
                "status": s.status,
                "game_title": game.title if game else "Unknown",
                "course_name": course.name if course else "Unknown",
                "course_semester": course.semester if course else "",
            }
        )
    return rows


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    user: Annotated[User, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
) -> None:
    """Permanently delete a session and all associated scores. Host or admin only."""
    session = await db.get(GameSession, session_id)
    if not session:
        raise NotFoundError(f"Session {session_id} not found")

    if user.role != "ADMIN" and session.host_user_id != user.id:
        from ..common.exceptions import ForbiddenError

        raise ForbiddenError("Only the session host can delete this session")

    # Wipe Redis state (room key, player keys, question key, answered sets, dist hashes)
    await state.delete_room_state(redis, session.room_code, session_id)

    # Delete from MySQL — cascade="all, delete-orphan" removes session_scores automatically
    await db.delete(session)
    await db.commit()

    logger.info("session_deleted", session_id=session_id, deleted_by=user.id)


# ---------------------------------------------------------------------------
# Room management
# ---------------------------------------------------------------------------


@router.post("/rooms", response_model=RoomCreateResponse, status_code=201)
async def create_room(
    body: RoomCreateRequest,
    user: Annotated[User, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
) -> dict:
    session = await game_service.create_room(
        db=db,
        redis=redis,
        host=user,
        game_id=body.game_id,
        course_id=body.course_id,
        max_rooms=settings.MAX_ROOMS,
    )
    return {"room_code": session.room_code, "session_id": session.id}


@router.get("/rooms/{room_code}/ping")
async def ping_room(
    room_code: str,
    redis=Depends(get_redis),
) -> dict:
    """Public endpoint — no auth required. Confirms a room is joinable."""
    from ..services.state_service import get_room_state
    from ..common.exceptions import NotFoundError as _NF, ConflictError as _CE

    state = await get_room_state(redis, room_code.upper())
    if not state:
        raise _NF(f"Room '{room_code}' not found")
    if state.get("status") not in ("LOBBY", "IN_PROGRESS"):
        raise _CE("This game has already ended")
    return {"status": state.get("status")}


@router.get("/rooms/{room_code}", response_model=RoomInfoResponse)
async def get_room(
    room_code: str,
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
) -> dict:
    """Get session metadata for reconnection. Any authenticated user can call this."""
    session, _ = await game_service.get_session_by_code(db, redis, room_code.upper())

    # Fetch related records for the response
    game = await db.get(Game, session.game_id)
    course = await db.get(Course, session.course_id)

    q_count_result = await db.execute(
        select(Question).where(Question.game_id == session.game_id)
    )
    question_count = len(q_count_result.scalars().all())

    return {
        "session_id": session.id,
        "room_code": session.room_code,
        "status": session.status,
        "game_title": game.title if game else "Unknown",
        "course_id": session.course_id,
        "course_name": course.name if course else "Unknown",
        "course_semester": course.semester if course else "",
        "question_count": question_count,
    }


# ---------------------------------------------------------------------------
# Post-game guest reconciliation (host-facing)
# ---------------------------------------------------------------------------


@router.get("/sessions/{session_id}/guests")
async def list_session_guests(
    session_id: str,
    user: Annotated[User, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
    """List unmerged guest players from a completed session."""
    from ..models.session import SessionScore
    from ..models.user import User as UserModel

    session = await db.get(GameSession, session_id)
    if not session:
        raise NotFoundError(f"Session {session_id} not found")

    # Only the session host or an admin can see this
    if user.role != "ADMIN" and session.host_user_id != user.id:
        from ..common.exceptions import ForbiddenError

        raise ForbiddenError("Only the session host can view guest players")

    result = await db.execute(
        select(UserModel)
        .join(SessionScore, SessionScore.user_id == UserModel.id)
        .where(
            SessionScore.session_id == session_id,
            UserModel.role == "GUEST",
        )
        .distinct()
    )
    guests = result.scalars().all()
    return [
        {
            "id": g.id,
            "display_name": g.display_name,
            "email": g.email,
        }
        for g in guests
    ]


@router.post("/sessions/{session_id}/merge-guest", status_code=204)
async def merge_guest_for_session(
    session_id: str,
    body: HostMergeGuest,
    user: Annotated[User, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Host-initiated guest merge, scoped to this session.

    The guest must have played in this session and nowhere else, and (unless
    the caller is ADMIN) the target account must belong to the session's
    course: an active roster entry for its netid, or a course access grant.
    Before this check any session host could merge, and delete, any guest in
    the system into any account.
    """
    from ..common.exceptions import ConflictError, ForbiddenError
    from ..models.course import CourseRoster
    from ..models.session import SessionScore
    from ..models.user import User as UserModel

    session = await db.get(GameSession, session_id)
    if not session:
        raise NotFoundError(f"Session {session_id} not found")
    if user.role != "ADMIN" and session.host_user_id != user.id:
        raise ForbiddenError("Only the session host can merge guest players")

    guest = await db.get(UserModel, body.guest_user_id)
    if not guest or guest.role != "GUEST":
        raise NotFoundError(f"Guest user {body.guest_user_id} not found")

    scores = (
        (await db.execute(select(SessionScore).where(SessionScore.user_id == guest.id)))
        .scalars()
        .all()
    )
    if not any(s.session_id == session_id for s in scores):
        raise NotFoundError(f"Guest {guest.id} did not play in this session")
    if any(s.session_id != session_id for s in scores):
        raise ConflictError(
            "This guest also has scores in other sessions; ask an admin"
        )

    netid = body.target_netid.strip().lower()
    real_user = (
        await db.execute(select(UserModel).where(UserModel.netid == netid))
    ).scalar_one_or_none()
    if not real_user:
        raise NotFoundError(f"No user with netid '{netid}' found")

    if user.role != "ADMIN":
        on_roster = (
            await db.execute(
                select(CourseRoster.id).where(
                    CourseRoster.course_id == session.course_id,
                    CourseRoster.netid == netid,
                    CourseRoster.is_active == True,  # noqa: E712
                )
            )
        ).first()
        has_access = (
            await db.execute(
                select(UserCourseAccess.user_id).where(
                    UserCourseAccess.course_id == session.course_id,
                    UserCourseAccess.user_id == real_user.id,
                )
            )
        ).first()
        if not on_roster and not has_access:
            raise ForbiddenError(f"'{netid}' is not in this session's course")

    # SessionScore has no unique key, so merging into someone who also played
    # this session would silently count their answers twice.
    already_played = (
        await db.execute(
            select(SessionScore.id).where(
                SessionScore.session_id == session_id,
                SessionScore.user_id == real_user.id,
            )
        )
    ).first()
    if already_played:
        raise ConflictError(f"'{netid}' already has scores in this session")

    for score in scores:
        score.user_id = real_user.id
    await db.delete(guest)
    logger.info(
        "guest_merged_by_host",
        guest_id=guest.id,
        real_user_id=real_user.id,
        session_id=session_id,
    )


# ---------------------------------------------------------------------------
# Session score export
# ---------------------------------------------------------------------------


@router.get("/sessions/{session_id}/export")
async def export_session_scores(
    session_id: str,
    user: Annotated[User, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    """Download session scores as a CSV. Any HOST of the session's course, or admin."""
    await game_service.assert_host_can_view_session(db, user, session_id)

    from ..services.export_service import build_session_csv

    filename, content = await build_session_csv(db, session_id)

    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
