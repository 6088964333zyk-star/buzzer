# backend/app/models/

## Purpose
SQLAlchemy 2.0 ORM table definitions (MySQL) — the persistent half of Buzzer's state. Live
in-game state (current question, who has answered, running scores) lives in Redis instead;
see `services/state_service.py`.

## Contents
- `__init__.py` — imports every model in FK-dependency order so `Base.metadata` is complete
  for Alembic autogenerate. Add new models here or migrations won't see them.
- `user.py` — `User`: UUID string PK; login by `netid` (OAuth) or `username`+`password_hash`
  (local). Global `role` is `ADMIN` | `USER` | `GUEST`.
- `course.py` — `Course`; `CourseRoster` (netid/name/email/`is_active`, unique per
  course+netid); `UserCourseAccess` (user↔course with per-course role `HOST` | `PLAYER`).
- `game.py` — `Game` (with nullable `course_id`, set once — see Gotchas); `Question` (`type`, `grading_type`, `prompt`, JSON `config` and
  `answer_data`, `time_limit_seconds`, float `points_value`, `order_index`);
  `UserGameAccess` (user↔game, no role).
- `image.py` — `QuestionImage` (T8): random 32-hex `id`, `game_id` (FK, `ON DELETE CASCADE`),
  `filename`, detected `mime`, `data` (MEDIUMBLOB, **deferred** — load it explicitly),
  `size_bytes`, displayed `width`/`height`, `sha256` (the ETag), microsecond timestamps.
- `session.py` — `GameSession` (one played room: 6-char `room_code`, `game_id`, `course_id`,
  host, status `LOBBY`/`IN_PROGRESS`/`COMPLETED`/`ABANDONED`); `SessionScore` (one row per
  player per answered question: points, correctness, time, raw `answer_data`).

## How it fits in
Routers and services query these directly with async SQLAlchemy. Request/response shapes are
**not** the models — those are Pydantic classes in `schemas/`. Schema changes need an Alembic
migration (`backend/app/migrations/versions/`, run `alembic revision --autogenerate` from
`backend/`).

## Gotchas
- **Games belong to a course (T4, migration 004).** `Game.course_id` is a nullable FK. NULL
  marks a legacy game, admin-only until assigned. 004 backfilled games whose sessions were
  all in one course. It is set once: admin may assign it while NULL, never change it.
  `UserGameAccess` still exists but no longer grants host access.
- **Two separate role systems.** `User.role` is global (ADMIN/USER/GUEST);
  `UserCourseAccess.role` is per course (HOST/PLAYER). "Host" is never a global role.
- **Not everything cascades.** `SessionScore.user_id` and `SessionScore.question_id` have no
  `ondelete`, and `GameSession.game_id`/`course_id` don't either. Deleting a user, question,
  game, or course that has score/session rows fails at the DB unless the code deletes
  dependents first. `delete_game` and `delete_user` in `routers/admin.py` do this by hand.
  Answered questions are protected in `services/question_service.delete`, which returns 409
  (before T4 the delete returned a misleading 204 and was rolled back). Any new delete path must clean up its
  dependents — and the matching Redis keys (T5 warns about exactly this).
- `Question.type` is a plain `String(50)`, not a DB enum. New question types (T7) need no
  migration for this column; the allowed list is enforced in `schemas/admin.py`.
- `Question.config` / `answer_data` are free-form JSON; their per-type shape is only enforced
  by the Pydantic validator on create (see `schemas/CLAUDE.md`).
- `points_value` and `points_awarded` are floats (migration 003 changed them from int).
- **`QuestionImage` has no ORM relationship from `Game`** on purpose: the DB cascade deletes a
  game's images, and a relationship without `passive_deletes` would try to null `game_id`
  first. Query images by `game_id`. Questions reference images only by id inside `config`
  (no FK), so `services/image_service` guards deletes (409 while in use).
