# frontend/host/src/pages/

## Purpose
All host routes: signing in, choosing a course and game to start a room, managing a course's
games, roster and sessions (in `manage/`), and (in `game/`) running the live game on the
classroom display.

## Contents
- `LoginPage.tsx` — Username/password → `POST /api/auth/login`, stores `token`, goes to `/home`.
  Also completes the OAuth2 flow: reads `#oauth2_data=` from the URL hash and exchanges the temp
  token at `POST /api/auth/exchange-temp`.
- `HomePage.tsx` — Loads `/game/my-courses`, `/game/my-games`, `/game/my-active-sessions`.
  Lists active sessions (resume or delete), lets the host pick course + game and create a room
  (`POST /game/rooms`) → `/game/:code/lobby`. Once a course is picked, offers "Manage this
  course" → `/manage/:courseId/games`. Logout.
- `manage/` — T4 per-course management: games and their questions, roster CSV upload,
  session list with CSV/HTML downloads. See `manage/CLAUDE.md`.
- `game/` — The live-game screens: `GameLayout` (socket + state + routing) and Lobby, Question,
  Results, GameOver pages. See `game/CLAUDE.md`.

## How it fits in
Routed in `../App.tsx`; `/home`, `/manage/:courseId/*` and `/game/:code/*` are wrapped in `RequireAuth`, which only checks
that a token exists. HTTP goes through `../lib/api.ts`; real-time traffic only through `game/GameLayout.tsx`.

## Gotchas
- **Games belong to a course (T4).** `HomePage` lists only games whose `course_id` matches the
  picked course; course-less legacy games (`course_id` null) are returned only to admins, who may
  start them in any course. The server enforces the same rule when a room is created.
- `HomePage` auto-selects when there is exactly one course or game.
- A failed initial load shows one generic "Are you still logged in?" error; nothing redirects to login.
- OAuth2 login only works behind the production Traefik proxy; locally, use username/password.
- See `game/CLAUDE.md` for the per-question-type logic spread across the game pages.
