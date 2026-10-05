# backend/app/websocket/

## Purpose
The real-time game loop over Socket.IO (python-socketio, ASGI, path `/socket.io`): hosts and
players join a room, the host advances through questions, players submit answers, and
everyone receives live updates. `docs/realtime.md` traces one answer end to end.

## Contents
- `__init__.py` — empty.
- `events.py` — event-name constants. Client→server: `join_room`, `rejoin_room`,
  `host_advance`, `host_lock_question`, `submit_answer`. The comments there about who
  receives what are out of date; what the gateway actually does: to `{code}` (everyone):
  `new_question`, `question_locked/unlocked`, `host_disconnected`, `game_abandoned`. To the
  host room plus each player's `user:{id}` room (personalised): `question_results`,
  `game_over`. Host room only: `player_joined/left`, `answer_status`, `answer_phase_ended`.
  To one socket: `answer_received`, `sync_state`, `error`.
- `middleware.py` — `authenticate_socket`: validates the JWT passed in the Socket.IO `auth`
  dict (accepts `access` and `temp` tokens), returns the `User`.
- `gateway.py` — the `sio` server and every handler:
  - `connect` (rate limit + JWT) / `disconnect` (if the host drops while IN_PROGRESS:
    locks the question, saves the remaining time, starts a 5-minute abandon countdown; a
    host dropping in LOBBY triggers nothing).
  - `join_room` — HOST only if `user.id == session.host_user_id` or ADMIN; PLAYER via
    `game_service.authorise_player`. `rejoin_room` restores a dropped client with `sync_state`.
  - `host_advance` — the state machine, driven by `question_phase` in the Redis room key:
    lobby (`None`) → start game → `QUESTION` → (advance) `RESULTS` → next `QUESTION` …
    → `COMPLETED` + `game_over`.
  - `submit_answer` — validates phase/lock/question id, dedupes, then
    `game_service.record_answer`; replies `answer_received` to the player and `answer_status`
    to the host; when everyone has answered, emits `answer_phase_ended` early.
  - `host_lock_question` — host closes/reopens submissions.
  - Per-question timer task: at the time limit, emits `answer_phase_ended` to the host, then
    auto-locks the question 0.5 s later.

## How it fits in
Mounted next to the FastAPI app in `main.py`. Stateless between events except for small
per-process dicts (`_sid_ctx`, `_timer_tasks`, `_abandon_tasks`); all game state lives in Redis
via `services/state_service.py`, and answers are persisted to MySQL via `services/game_service.py`.
Socket.IO rooms: `{code}` (everyone), `{code}:host` (host-only events), `user:{id}`
(personalised payloads).

## Gotchas
- **A rejected answer gets an `error` event, not `answer_received`.** Late answers
  (question locked, phase moved on, wrong question id) are refused with "Question is locked"
  / "No active question" / "Question ID does not match…". A client that only waits for
  `answer_received` will just time out. (`scripts/simulate_players.py` queues `error` but
  never prints it.) Exceptions: a duplicate submission gets `answer_received` with
  `alreadyAnswered: true`; a socket not registered as PLAYER gets no reply at all; a
  malformed payload that makes `calculate_score` raise also gets no reply (no try/except).
- **The advancing host decides when a question ends.** `host_advance` during `QUESTION`
  closes it immediately, so players who haven't submitted yet lose that question.
- **`new_question` sends the whole `config` to every player** (`_question_payload`), plus
  `gradingType`, and `editDistance` for fill-in-the-blank. Never put answer information in
  `config` — for T7/T8 types (e.g. a canvas target region), the answer key belongs in
  `answer_data`.
- **Per-type answer validation lives here too:** `submit_answer` structurally checks
  `multi_select` (`selectedIndices`), `map_pin` (`point`, via `map_pin.is_unit_point`) and
  `numeric` (`value`, via `numeric.is_finite_number`). These run before `record_answer`, so a
  rejected payload doesn't use up the player's answer. A new question type needs its own payload check here,
  in addition to scoring in `game_service.calculate_score` and the reveal in `_answer_reveal`
  — which is copied in `services/report_service.py` and `game_service`, and the copies have
  already drifted (see `services/CLAUDE.md` for the full list).
- **HOST means "the user who created this session" (or ADMIN)** in `join_room`, not any
  HOST of the course, matching the REST rule in `routers/game.py`. `rejoin_room` infers the
  role: the creator is the host, and an ADMIN is the host only if they aren't a player in the
  session (an admin who joined as a player stays a player). When it has to re-add a player
  missing from Redis, it applies `join_room`'s LOBBY/IN_PROGRESS check.
- The in-memory dicts are per process. In development there is no Redis pub/sub manager
  (it drops connections under idle load), so run a single backend worker locally.
- Many diagnostic warnings (e.g. `submit_answer_no_active_question`) are logged only when
  stress-test mode is on, so in normal dev logs a rejected answer leaves no trace server-side.
