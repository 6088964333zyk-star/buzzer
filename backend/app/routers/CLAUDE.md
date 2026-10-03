# backend/app/routers/

## Purpose
FastAPI REST endpoints, all mounted under `/api` in `main.py`. Real-time game traffic does
**not** go through here — that's Socket.IO in `websocket/`.

## Contents
- `__init__.py` — empty.
- `health.py` — `GET /api/health`: pings MySQL and Redis, reports room/player counts (see
  Gotchas — the counts are wrong).
- `auth.py` — `/api/auth/*`. `login` (username+password → access token + httpOnly refresh
  cookie; dev-only `netid` login returns a temp token), `oauth2-callback` (meant to sit
  behind the production Traefik OAuth proxy), `exchange-temp` (temp → access token), `guest`
  (creates a GUEST user for a live room code), `refresh`, `logout`. Login is rate-limited.
- `game.py` — `/api/game/*`, the **host-facing** API (any USER or ADMIN):
  `my-courses` (ADMIN: all; USER: courses where they are HOST), `my-games` (ADMIN: all; USER:
  via `UserGameAccess`), `my-active-sessions`, `DELETE sessions/{id}`, `POST rooms` (delegates
  access checks to `game_service.create_room`), public `rooms/{code}/ping`, `rooms/{code}`
  (reconnect metadata), post-game guest listing/merge, and **`sessions/{id}/export` (CSV of
  scores — already host-accessible)**.
- `admin.py` — `/api/admin/*`, **every route is `require_admin`**: course list/create/get/
  update (**no course delete**); roster CSV upload, JSON row import, per-entry patch (no
  roster-entry delete — deactivate instead); game CRUD; question CRUD + reorder; game JSON
  export/import; local user CRUD; grant/revoke course access (HOST/PLAYER) and game access;
  guest merge; session list, Canvas/raw CSV export, and HTML `report`.

## How it fits in
Thin layer: validate with `schemas/`, authorize with `common/dependencies.py` plus inline
checks, then query `models/` directly or call `services/` for anything non-trivial (room
creation, scoring, roster CSV parsing, exports/reports). The DB session from `get_db` commits
automatically when the request finishes and rolls back on error, so most handlers never call
`commit()` themselves.

## Gotchas
- **Everything T4 asks the host to do already exists — but only in `admin.py`, behind
  `require_admin`:** roster upload/patch, game and question CRUD/reorder, HTML session report.
  T4 means exposing host-safe versions with a per-course HOST check, not new business logic.
  The one exception: host CSV export already exists at `game.py` `sessions/{id}/export`.
- **Host checks in `game.py` are "you hosted this session"** (`session.host_user_id ==
  user.id`), not "you are HOST of this course". A second HOST of the same course cannot
  export or delete a session the first one ran. T4's design must pick one rule on purpose.
- Course-level HOST checks today: `my-courses`, `game_service.create_room` (via the reusable
  `assert_host_can_use_course` / `assert_host_can_use_game`), and `authorise_player` (a
  course HOST may also join as a player). New host routes should call those helpers rather
  than re-implementing the query.
- **Host `merge-guest` is too broad:** it moves *all* of the guest's scores from every session
  and deletes the guest, without checking the guest played in this session — so the host of
  any session can merge/delete any guest. The admin version differs too: it promotes the guest
  when the netid has no account instead of returning 404.
- **`oauth2-callback` trusts the `X-Auth-Request-User` header with no other check.** It is
  only safe behind the OAuth proxy; anywhere the backend is reachable directly (e.g.
  `localhost:8000`), a forged header logs in as any netid.
- **`/api/health` counts are wrong:** it reads `room:{code}:players`, but the real key is
  `session:{id}:players`, so players are always 0; the room count includes COMPLETED rooms.
- `update_question` writes fields straight through with no structural validation, and
  `delete_question` does not remove `SessionScore` rows first — see `schemas/CLAUDE.md` and
  `models/CLAUDE.md`.
- `merge-guest` (host version) also takes an untyped `body: dict` and reports missing fields
  as 409 Conflict rather than 422.
- **Prompts are sanitized with `bleach`** on create, update and import, allowing only
  `b`/`i`/`br`/`u` — an `<img>` in a prompt is silently stripped (relevant to T8). `config`
  is not sanitized. The existing file-upload pattern to copy is `upload_roster`
  (`UploadFile`); there is no static-file or image serving yet.
- Error handling is mixed: most routes raise `BuzzerError` subclasses, but `import_game` raises
  `HTTPException` directly, so its error JSON has a different shape (`detail` vs `message`).
