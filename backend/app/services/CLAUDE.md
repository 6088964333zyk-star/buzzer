# backend/app/services/

## Purpose
Business logic shared by the REST routers and the WebSocket gateway: auth tokens, room
lifecycle and access checks, scoring, live state in Redis, roster CSV parsing, and score
exports/reports. Routers stay thin and call into here.

## Contents
- `__init__.py` — empty.
- `auth_service.py` — bcrypt password hashing; RS256 JWT creation/decoding (`access` 2 h,
  `refresh` 7 days, `temp` 15 min for OAuth onboarding); user lookup; netid
  get-or-create; guest-user creation; local username/password authentication.
- `bootstrap.py` — on startup, waits for the schema to exist, then creates the first ADMIN
  from `ADMIN_USERNAME`/`ADMIN_PASSWORD` if none exists.
- `game_service.py` — the game core. Access helpers (ADMIN always passes):
  `assert_host_can_use_course` (needs a `UserCourseAccess` HOST row),
  `assert_host_can_manage_game` / `assert_host_can_use_game` (HOST of the game's course;
  course-less legacy games are admin-only), `assert_host_can_view_session` (HOST of the
  session's course). `create_room` runs the checks, refuses a course-owned game outside its
  course (admin included), enforces `MAX_ROOMS`, and writes the `GameSession` row and the
  Redis room key; `start_game` / `complete_game` / `abandon_game` status transitions;
  `authorise_player` (who may join a room); `calculate_score` (per-type scoring) and
  `record_answer` (writes `SessionScore`, updates Redis score/answered/distribution);
  leaderboard and per-question summaries for host and player screens.
- `state_service.py` — every Redis key and its helpers: `room:{code}` (status, ids, and the
  gateway's game cursor: `question_phase`, `question_locked`, `question_index`,
  `question_ids`, `host_sid`, `timer_remaining_seconds`), `session:{id}:players`,
  `…:player:{uid}`, `…:question` (current question id, start time, limit, number/total —
  *not* the phase), `…:answered:{qid}`, `…:dist:{qid}` (answer distribution);
  `delete_room_state` cleanup and `expire_session_state` (shorten all session keys' TTL). `restore_from_mysql` exists but is **dead code**: nothing
  calls it, and it only returns a dict without writing to Redis.
- `map_pin.py` — helpers for the `map_pin` type (T7): `is_unit_point` (the one point
  check used by the schema, gateway and scoring; rejects bools/NaN/out of range),
  `score_map_pin` (linear falloff between `fullRadius` and `zeroRadius`, distance in
  map-width units with y divided by `aspectRatio`, 2-decimal rounding), `map_pin_cell`
  (`"cx:cy"` distribution key on a 200×100 grid) and `reveal`.
- `numeric.py` — helpers for the `numeric` type (T7, `docs/design-t7-numeric.md`):
  `is_finite_number` (rejects bools, NaN/Inf and ints too big for a float), `validate`
  (schema checks with exact messages), `effective_tolerances` (applies absolute/percent),
  `score_numeric` (linear falloff, epsilon at the boundaries, 2-decimal rounding), `bucket`
  (`zero_low`/`partial_low`/`full`/`partial_high`/`zero_high` distribution keys), `reveal`,
  and `format_number`/`with_unit` for the HTML report.
- `question_service.py` — question create/update/delete/reorder shared by `routers/admin.py`
  and `routers/host.py`. Update merges onto the stored row and re-validates with
  `QuestionCreate` (422). Deleting, or changing the `type` of, an answered question → 409.
  All edits → 409 while the game has a session IN_PROGRESS whose Redis room key still exists.
- `roster_service.py` — parses a Canvas gradebook CSV (`Student`, `SIS Login ID` columns) or
  JSON rows into `CourseRoster` upserts. More than `MAX_ROWS` (1000) data rows → 422 before
  any write.
- `export_service.py` — `build_session_csv` (Player, Q1…Qn, Total — the host/admin score
  download) and `build_canvas_csv` (Canvas gradebook import format, admin only).
- `report_service.py` — `build_session_report`: standalone HTML report with per-question bar
  charts / word clouds and a score histogram. Aggregate only — no player names.

## How it fits in
MySQL is the record of truth (`models/`); Redis holds fast, per-room live state that the
WebSocket gateway reads and writes on every event. `record_answer` writes both. Routers call
the access helpers and room/export functions; `websocket/gateway.py` drives the rest of the
game lifecycle through `game_service` and `state_service`.

## Gotchas
- **Scoring is per type in `calculate_score`.** COMPLETENESS always awards `points_value` if
  any answer was sent. multiple_choice bounds-checks the selected index against
  `answer_points`, not against the options list. fill_in_the_blank lowercases and collapses
  whitespace, then accepts within `editDistance`. multi_select sums the selected options'
  points and floors at 0. `is_correct` differs by type: `==` `points_value` for
  multiple_choice/true_false, `>=` for fill_in_the_blank, `>=` and `points_value > 0` for
  multi_select, always true for COMPLETENESS.
- **Answer logic is copied in several places, and the copies have drifted.** A new type (T7)
  must be added to: `calculate_score`; the distribution keys in `record_answer`; both
  summary functions (`get_player_question_summary`, `get_host_question_summary`);
  `websocket/gateway.py` `_answer_reveal` and the `submit_answer` payload check; and in
  `report_service.py` its own `_answer_reveal`, `_extract_answer_key` and type badge. The
  report copies already lack a multi_select branch. `map_pin` and `numeric` (T7) are wired
  into all of them; their reveals always include the answer, so their branches run **before**
  the COMPLETENESS early return in each `_answer_reveal` and summary. The report draws
  neither as bars: each gets a one-line text summary instead.
- `calculate_score` assumes a well-formed payload: a non-integer `selectedIndex` or a
  non-string `text` raises, and the gateway doesn't catch it — the player gets no reply.
- **Roster upload is a full replace (kept deliberately in T4).** Any active netid missing from
  the upload is deactivated, so uploading "just the new students" deactivates the whole
  class. The host UI shows a preview before confirming. Oversize uploads are rejected whole.
- **Redis key lifetimes.** `room:{code}` has `ROOM_TTL` (90 min, refreshed on activity) and
  the gateway's `ws_rate:{ip}` its own short TTL. Every `session:{id}:*` key gets
  `SESSION_TTL` (24 h) when it is created; later updates keep the existing TTL
  (`keepttl` / `EXPIRE NX`) rather than extending it. `complete_game` shortens them all to
  `ROOM_TTL` (`expire_session_state`), so results and reconnects keep working until the room
  key goes. `abandon_game` and the host's session DELETE still delete everything at once;
  `admin.delete_game` leaves Redis alone, and the 24 h TTL cleans up after it. A single
  session that stays live for more than 24 h would lose its player set; nothing refreshes it.
  Redis runs with `maxmemory 512mb` and `allkeys-lru` (`docker-compose.yml`), so under memory
  pressure it evicts *any* key, live rooms included. The TTLs keep it well below that limit.
- **Exports read the game's current questions,** not a snapshot from when the session was
  played. Editing or reordering questions afterwards changes old sessions' CSV and HTML
  reports. Answered questions can't be deleted or change type (`question_service`).
- `build_session_csv` only lists players with at least one `SessionScore`; a player who joined
  but never answered is missing. Unanswered cells are an int `0`; answered-but-wrong cells
  are the stored float `0.0`.
- Guests skip the course check entirely in `authorise_player`: a room code plus an email is
  enough to join any live room.
- If `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` are missing or not valid base64, `auth_service`
  silently generates ephemeral keys (with a warning log), so every restart logs everyone out.
