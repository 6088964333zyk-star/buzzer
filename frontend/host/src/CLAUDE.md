# frontend/host/src/

## Purpose
The host app: a React + Vite + Tailwind single-page app for the large classroom display. The host
signs in, starts a room for a course and game, and drives the game while players answer on phones.

## Contents
- `main.tsx` — Mounts `<App />` in `StrictMode`.
- `App.tsx` — Routes (`BrowserRouter` with `basename` = Vite `BASE_URL`): `/login`, `/home`, and
  `/game/:code/{lobby,question,results,gameover}`; `RequireAuth` only checks a token exists.
- `index.css` — Tailwind directives and a hardcoded dark body background/text color.
- `pages/` — Login, Home (course/game pick, create/resume room), and `game/` (live screens). See `pages/CLAUDE.md`.
- `components/` — `ui/` primitives: `Button`, `Card`, `Input`, `TimerBar`. See `components/CLAUDE.md`.
- `lib/` — `api.ts` REST client (`get`/`post`/`delete` only) and `cn`. See `lib/CLAUDE.md`.
- `types/` — Hand-written Socket.io payload shapes. See `types/CLAUDE.md`.

## How it fits in
One of three separate frontends (host, player, admin) that share no code. Built with
`base: '/host/'` and served by nginx at `localhost:8080/host/`; in dev, Vite on port 5173 proxies
`/api` and `/socket.io` to the backend on 8000. REST calls go to `/api/game/*` and `/api/auth/*`;
the live game is Socket.io, owned entirely by `pages/game/GameLayout.tsx`, which emits
`join_room` / `host_advance` / `host_lock_question` and follows the server's phase events.

## Gotchas
- **Server-driven game.** The backend decides the phase; the host only asks to advance or lock.
- **T4 lands here** and the app is missing most of what it needs: no roster, game editor,
  session history, or downloads; `api.ts` lacks `put`/`patch`/multipart/download (the admin
  app's `lib/api.ts` has them); `GameLayout` drops the `session_id`.
- **Adding a question type (T7)** touches `types/game.ts` and the Question, Results, and GameOver pages.
- The host shows the prompt but not the options during a question; options appear only on results.
- `ui/` components are copies of admin's (identical) and player's (different); nothing is shared.
- **Theming (T9):** the dark palette is hardcoded in `index.css`, `tailwind.config.ts` has no
  color tokens, and palette classes appear throughout `components/` and `pages/`.
- The player join URL/QR code assumes the nginx path `/player/`, so it only works on `localhost:8080`.
