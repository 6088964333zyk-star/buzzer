# frontend/host/src/pages/

## Purpose
All host routes: signing in, choosing a course and game to start a room, and (in `game/`) running
the live game on the classroom display.

## Contents
- `LoginPage.tsx` — Username/password → `POST /api/auth/login`, stores `token`, goes to `/home`.
  Also completes the OAuth2 flow: reads `#oauth2_data=` from the URL hash and exchanges the temp
  token at `POST /api/auth/exchange-temp`.
- `HomePage.tsx` — Loads `/game/my-courses`, `/game/my-games`, `/game/my-active-sessions`.
  Lists active sessions (resume or delete), lets the host pick course + game and create a room
  (`POST /game/rooms`) → `/game/:code/lobby`. Logout.
- `game/` — The live-game screens: `GameLayout` (socket + state + routing) and Lobby, Question,
  Results, GameOver pages. See `game/CLAUDE.md`.

## How it fits in
Routed in `../App.tsx`; `/home` and `/game/:code/*` are wrapped in `RequireAuth`, which only checks
that a token exists. HTTP goes through `../lib/api.ts`; real-time traffic only through `game/GameLayout.tsx`.

## Gotchas
- **This is where T4's new host features will land.** Today the host app has only these two
  pages plus the game screens — no roster, game editor, or session history/downloads. Those exist
  only in the admin app, behind admin-only endpoints.
- `HomePage` picks course and game independently; any game the host has access to can be started
  in any course they host. Course-specific games (T4) will change this.
- `HomePage` auto-selects when there is exactly one course or game.
- A failed initial load shows one generic "Are you still logged in?" error; nothing redirects to login.
- OAuth2 login only works behind the production Traefik proxy; locally, use username/password.
- See `game/CLAUDE.md` for the per-question-type logic spread across the game pages.
