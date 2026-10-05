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
- `game.py` — `/api/game/*`, the live-game API for hosts (any USER or ADMIN):
  `my-courses` (ADMIN: all; USER: courses where they are HOST), `my-games` (ADMIN: all; USER:
  games of courses they HOST), `my-active-sessions`, `DELETE sessions/{id}`, `POST rooms` (delegates
  access checks to `game_service.create_room`), public `rooms/{code}/ping`, `rooms/{code}`
  (reconnect metadata), post-game guest listing/merge, and `sessions/{id}/export` (CSV; any
  HOST of the session's course).
- `host.py` — `/api/host/*` (T4), course-scoped management for hosts. Every route is
  `require_user` plus a course check via the `game_service` access helpers: games of a course
  (list/create/get/update metadata — never the course), questions (via
  `services/question_service`), roster (list, full-replace JSON import, active toggle),
  sessions of a course, per-session CSV and HTML report downloads, and the game's images
  (T8: list/upload per game, replace/delete per image, authorized by the image's game).
- `admin.py` — `/api/admin/*`, **every route is `require_admin`**: course list/create/get/
  update (**no course delete**), and `courses/{id}/access` (who has HOST/PLAYER on a course,
  hosts first); roster CSV upload, JSON row import, per-entry patch (no
  roster-entry delete — deactivate instead); game CRUD; question CRUD + reorder; game JSON
  export/import (version 2 embeds images as base64; 1 still imports); the same four image
  routes as host (T8); local user CRUD; grant/revoke course access (HOST/PLAYER) and game access;
  guest merge; session list, Canvas/raw CSV export, and HTML `report`.
- `images.py` — public `GET /api/images/{id}` (T8): the bytes, no auth, `ETag` = sha256,
  `Cache-Control: no-cache`, 304 on a matching `If-None-Match`.

## How it fits in
Thin layer: validate with `schemas/`, authorize with `common/dependencies.py` plus inline
checks, then query `models/` directly or call `services/` for anything non-trivial (room
creation, scoring, roster CSV parsing, exports/reports). The DB session from `get_db` commits
automatically when the request finishes and rolls back on error, so most handlers never call
`commit()` themselves.

## Gotchas
- **Two session rules, on purpose (T4 D3):** viewing/downloading results is allowed for any
  HOST of the session's course; *deleting* a session (`game.py`) stays creator-or-ADMIN.
- Admin and host question routes share `services/question_service`; behavior changes there
  (409/422 rules) apply to both.
- Course-level HOST checks live in the `game_service.assert_host_can_*` helpers, called by
  every `host.py` route, `create_room` and the CSV export; `my-courses`/`my-games` filter by
  the same HOST rows, and `authorise_player` lets a course HOST join as a player. New host
  routes must call a helper rather than re-implementing the query.
- **Host `merge-guest` is too broad:** it moves *all* of the guest's scores from every session
  and deletes the guest, without checking the guest played in this session — so the host of
  any session can merge/delete any guest. The admin version differs too: it promotes the guest
  when the netid has no account instead of returning 404.
- **`oauth2-callback` trusts the `X-Auth-Request-User` header with no other check.** It is
  only safe behind the OAuth proxy; anywhere the backend is reachable directly (e.g.
  `localhost:8000`), a forged header logs in as any netid.
- **`/api/health` counts are wrong:** it reads `room:{code}:players`, but the real key is
  `session:{id}:players`, so players are always 0; the room count includes COMPLETED rooms.
- `merge-guest` (host version) also takes an untyped `body: dict` and reports missing fields
  as 409 Conflict rather than 422.
- **Prompts are sanitized with `bleach`** on create, update and import, allowing only
  `b`/`i`/`br`/`u` — an `<img>` in a prompt is silently stripped. Images (T8) go through
  `config` image ids instead. `config` is not sanitized.
- **Image uploads need nginx's `client_max_body_size 12m`** (`nginx/nginx.dev.conf`); the
  default 1 MB would reject a 2 MB image before it reaches FastAPI.
- Error handling is mixed: most routes raise `BuzzerError` subclasses, but `import_game` raises
  `HTTPException` directly, so its error JSON has a different shape (`detail` vs `message`).
