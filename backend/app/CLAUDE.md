# backend/app/

## Purpose
The Buzzer backend: one Python ASGI process serving a REST API (FastAPI, under `/api`) and a
real-time Socket.IO server (`/socket.io`). MySQL is the system of record; Redis holds the live
state of rooms in progress.

## Contents
- `main.py` — builds the FastAPI app: logging, CORS, slowapi rate limiting, error handlers,
  the four routers under `/api`, and the startup hook that bootstraps the first admin. The
  Socket.IO server wraps FastAPI as the outer ASGI app (`asgi_app`), so `/socket.io/*` goes
  to the gateway and everything else falls through to FastAPI.
- `config.py` — pydantic `Settings` from env/`.env`: `APP_ENV`, `DATABASE_URL`, `REDIS_URL`,
  JWT keys, `CORS_ORIGINS`, `MAX_ROOMS`, `FRONTEND_URL`, bootstrap admin credentials,
  `STRESS_TEST_KEY`; helpers `is_development`, `is_stress_test_mode`.
- `database.py` — async SQLAlchemy engine/session and `get_db` (commits when the request
  finishes, rolls back on error). SQL echo is on in development.
- `redis_client.py` — shared async Redis client (`get_redis`).
- `models/` — ORM tables: users, courses (+ roster, per-course HOST/PLAYER access), games
  (+ questions, per-user game access), game sessions and per-answer scores.
- `schemas/` — Pydantic request/response shapes, including the only per-type validation of
  question `config`/`answer_data` (`QuestionCreate`).
- `common/` — auth dependencies (`require_admin`, `require_user`), error types → JSON,
  structlog setup, rate limiter.
- `routers/` — REST endpoints: `auth`, `game` (live-game host API), `host` (course-scoped
  host management, T4), `admin` (admin-only CRUD, import/export, reports), `health`.
- `services/` — business logic: tokens, course/game access checks, room lifecycle, scoring,
  Redis state, roster CSV parsing, CSV/HTML exports.
- `websocket/` — Socket.IO gateway: join/rejoin, host-driven question state machine, answer
  submission, timers, host-disconnect handling.
- `migrations/` — Alembic migrations (001 initial schema, 002 `answer_data` on scores,
  003 float points, 004 `games.course_id` + backfill). Run `alembic` from `backend/`.

## How it fits in
Request flow: router → (`schemas/` validation, `common/` auth) → `services/` → `models/`
(MySQL). Game flow: host and players connect to `websocket/`, which reads and writes Redis
through `services/state_service.py` and persists each answer through
`services/game_service.record_answer`. The three frontends (`frontend/{host,player,admin}`)
call the REST API for setup and use Socket.IO for play.

## Gotchas (cross-cutting — details in each child CLAUDE.md)
- **Roles are two-level.** Global `User.role` (ADMIN/USER/GUEST) and per-course
  `UserCourseAccess.role` (HOST/PLAYER). "Is HOST of this course" is checked by the
  `services/game_service.assert_host_can_*` helpers, used by room creation and every
  `/api/host` route.
- **Games belong to a course (T4).** A course-owned game runs and is managed only within its
  course; legacy course-less games are admin-only. `docs/design-t4-host.md` has the rules.
- **Question types:** the four originals plus `map_pin` (T7, Canvas map tap; design in
  `docs/design-t7-map-question.md`, helpers in `services/map_pin.py`) and `numeric` (T7,
  numeric estimate with partial credit; `docs/design-t7-numeric.md`, `services/numeric.py`).
- **Adding a question type (T7) touches many places**, because per-type answer logic is
  copied rather than shared — and the copies have drifted (the HTML report already can't
  render multi_select): the type regex twice and the validator in `schemas/admin.py`;
  `calculate_score`, `record_answer`'s distribution keys and both summaries in
  `services/game_service.py`; `_answer_reveal`, `_extract_answer_key` and the badge in
  `services/report_service.py`; the payload check and `_answer_reveal` in
  `websocket/gateway.py`. Question `config` is sent to players, so answer keys must stay in
  `answer_data`.
- **Images (T8) have no foothold yet:** no upload or image serving, and prompts are
  `bleach`-sanitized down to `b`/`i`/`br`/`u`, so `<img>` tags are stripped.
- **Redis `session:*` keys expire:** 24 h from creation, shortened to the room's 90 min at
  game over — see `services/`. Question update/delete integrity is handled by
  `services/question_service` (T4).
- **Known access-control soft spots** (see `routers/` and `websocket/`): host `merge-guest`
  can touch any guest; `oauth2-callback` trusts a header; `rejoin_room` promotes any ADMIN to
  host.
- Rate limits are disabled in development, and many rejection paths only log in
  stress-test mode, so local runs hide some failures.
