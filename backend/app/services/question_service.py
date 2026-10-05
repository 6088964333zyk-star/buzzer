"""Question create/update/delete/reorder shared by the admin and host routers.

Callers authorize first and pass the already-loaded ``Game``. Rules from
docs/design-t4-host.md:
  D5 — answered questions can't be deleted or change type (409).
  D7 — an update is merged onto the stored question and re-validated with the
       same ``QuestionCreate`` rules as create (422 on failure).
  D8 — no edits while the game has a live session (409).
And from docs/design-t8-images.md: referenced images must belong to the game
(422), map_pin aspectRatio is filled from its map image, and an answered
map_pin can't change its map (409).
"""

from __future__ import annotations

import bleach
from pydantic import ValidationError
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..common.exceptions import ConflictError, NotFoundError, UnprocessableError
from ..models.game import Game, Question
from ..models.session import GameSession, SessionScore
from ..schemas.admin import QuestionCreate, QuestionUpdate
from . import image_service
from . import state_service as state
from .image_refs import map_image_id

PROMPT_TAGS = ["b", "i", "br", "u"]

# Fields validated together by QuestionCreate; everything else on the row
# (id, game_id, order_index, created_at) is outside the merge.
_MERGE_FIELDS = (
    "type",
    "grading_type",
    "prompt",
    "config",
    "answer_data",
    "time_limit_seconds",
    "points_value",
)


def _clean_prompt(prompt: str) -> str:
    return bleach.clean(prompt, tags=PROMPT_TAGS, attributes={}, strip=True)


async def assert_no_live_session(db: AsyncSession, redis: Redis, game_id: int) -> None:
    """409 if a session of this game is IN_PROGRESS *and* its room is still in Redis.

    MySQL alone isn't enough: a backend restart loses the in-process abandon
    task and can leave a session IN_PROGRESS forever. The room key expires
    after 90 idle minutes, so such a game unlocks on its own (D8).
    """
    result = await db.execute(
        select(GameSession.room_code).where(
            GameSession.game_id == game_id,
            GameSession.status == "IN_PROGRESS",
        )
    )
    for room_code in result.scalars().all():
        if await state.get_room_state(redis, room_code) is not None:
            raise ConflictError("This game has a session in progress")


async def answered_session_count(db: AsyncSession, question_id: int) -> int:
    result = await db.execute(
        select(func.count(SessionScore.session_id.distinct())).where(
            SessionScore.question_id == question_id
        )
    )
    return result.scalar_one() or 0


async def _get_question(db: AsyncSession, game: Game, question_id: int) -> Question:
    result = await db.execute(
        select(Question).where(Question.id == question_id, Question.game_id == game.id)
    )
    question = result.scalar_one_or_none()
    if not question:
        raise NotFoundError(f"Question {question_id} not found in game {game.id}")
    return question


async def create(
    db: AsyncSession, redis: Redis, game: Game, body: QuestionCreate
) -> Question:
    await assert_no_live_session(db, redis, game.id)

    if body.order_index is None:
        result = await db.execute(
            select(Question.order_index)
            .where(Question.game_id == game.id)
            .order_by(Question.order_index.desc())
            .limit(1)
        )
        max_idx = result.scalar_one_or_none()
        order_index = (max_idx + 1) if max_idx is not None else 0
    else:
        order_index = body.order_index

    await image_service.assert_refs_in_game(db, game.id, body.type, body.config)
    config = await image_service.fill_map_aspect(db, body.type, body.config)

    question = Question(
        game_id=game.id,
        type=body.type,
        grading_type=body.grading_type,
        prompt=_clean_prompt(body.prompt),
        config=config,
        answer_data=body.answer_data,
        time_limit_seconds=body.time_limit_seconds,
        points_value=body.points_value,
        order_index=order_index,
    )
    db.add(question)
    await db.flush()
    await db.refresh(question)
    return question


async def update(
    db: AsyncSession,
    redis: Redis,
    game: Game,
    question_id: int,
    body: QuestionUpdate,
) -> Question:
    question = await _get_question(db, game, question_id)
    await assert_no_live_session(db, redis, game.id)

    if (
        body.type is not None
        and body.type != question.type
        and await answered_session_count(db, question.id) > 0
    ):
        raise ConflictError(
            "Cannot change the type of a question that has already been answered"
        )

    merged = {field: getattr(question, field) for field in _MERGE_FIELDS}
    for field in _MERGE_FIELDS:
        value = getattr(body, field)
        if value is not None:
            merged[field] = value
    try:
        validated = QuestionCreate(**merged)
    except ValidationError as exc:
        # Not a request-parsing error, so FastAPI wouldn't turn it into a 422.
        raise UnprocessableError(exc.errors()[0]["msg"]) from exc

    await image_service.assert_refs_in_game(
        db, game.id, validated.type, validated.config
    )
    if (
        map_image_id(validated.type, validated.config)
        != map_image_id(question.type, question.config)
        and question.type == "map_pin"
        and await answered_session_count(db, question.id)
    ):
        raise ConflictError(
            "Cannot change the map of a question that has already been answered"
        )
    validated.config = await image_service.fill_map_aspect(
        db, validated.type, validated.config
    )

    for field in _MERGE_FIELDS:
        setattr(question, field, getattr(validated, field))
    question.prompt = _clean_prompt(validated.prompt)
    if body.order_index is not None:
        question.order_index = body.order_index
    await db.flush()
    await db.refresh(question)
    return question


async def delete(db: AsyncSession, redis: Redis, game: Game, question_id: int) -> None:
    question = await _get_question(db, game, question_id)
    await assert_no_live_session(db, redis, game.id)

    sessions = await answered_session_count(db, question.id)
    if sessions:
        raise ConflictError(
            f"This question has been answered in {sessions} session(s); "
            "deleting it would change past results"
        )
    await db.delete(question)


async def reorder(db: AsyncSession, redis: Redis, game: Game, order: list[int]) -> None:
    await assert_no_live_session(db, redis, game.id)

    result = await db.execute(select(Question).where(Question.game_id == game.id))
    questions = {q.id: q for q in result.scalars().all()}
    if set(order) != set(questions.keys()):
        raise ConflictError(
            "order list must contain exactly the IDs of all questions in this game"
        )
    for idx, qid in enumerate(order):
        questions[qid].order_index = idx
