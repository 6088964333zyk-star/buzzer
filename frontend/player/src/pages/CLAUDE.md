# frontend/player/src/pages/

## Purpose
All player routes on the phone: entering a room code, choosing how to identify yourself, and (in
`game/`) playing the game.

## Contents
- `JoinPage.tsx` — Room-code entry (prefilled from `?code=` when arriving via the host's QR code).
  Checks the room with the public `GET /api/game/rooms/:code/ping`, then goes to `/name/:code`.
- `NamePage.tsx` — Pick identity for a room: **guest** (display name + email →
  `POST /api/auth/guest`, remembered in `localStorage.playerName` / `playerEmail`) or **local
  account** (`POST /api/auth/login`). If a valid token already exists, offers to continue with it.
  Then → `/game/:code/lobby`.
- `LoginPage.tsx` — Not a login form. Landing page for the OAuth2 redirect: exchanges the
  `#oauth2_data=` temp token at `POST /api/auth/exchange-temp`, then returns to `/name/:code`
  (room code kept in `sessionStorage.joinRoomCode`). Anything else redirects to `/join`.
- `game/` — The in-game screens: `GameLayout` (socket + state + routing) and Lobby, Question,
  Feedback, Results, GameOver. See `game/CLAUDE.md`.

## How it fits in
Routed in `../App.tsx` (`*` → `/join`). Pre-game pages call REST via `../lib/api.ts`; once a
token exists, `game/GameLayout.tsx` opens the socket. The flow is
Join → Name → game/Lobby → Question ⇄ Feedback → Results → … → GameOver.

## Gotchas
- **Guests can join any room.** The server accepts guest tokens without checking the course
  roster; roster checks apply only to logged-in users. Relevant to T4's course-scoped games.
- The `/game/:code` routes have no route guard; `GameLayout` checks token expiry itself and
  sends the player back to `/name/:code`.
- A stored token is shared by every room the player joins from that browser. Using the host's
  device as a player reuses the host's login.
- OAuth2 works only behind the production Traefik proxy.
