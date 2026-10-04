# frontend/player/src/

## Purpose
The player app: a mobile-first React + Vite + Tailwind single-page app. A player enters a room
code, joins as a guest or with an account, and answers questions on their phone.

## Contents
- `main.tsx` — Mounts `<App />` in `StrictMode`.
- `App.tsx` — Routes: `/join`, `/login` (OAuth2 landing), `/name/:code`, and
  `/game/:code/{lobby,question,feedback,results,gameover}`; everything else → `/join`. No route guard.
- `index.css` — Tailwind directives, hardcoded dark background/text, tap-highlight disabled.
- `pages/` — Join → Name (guest or login) → `game/` screens. See `pages/CLAUDE.md`.
- `components/` — Touch-sized `ui/` primitives: `Button`, `Card`, `Input`, `TimerBar`. See `components/CLAUDE.md`.
- `lib/` — `api.ts` (`get`/`post` only), `cn`, `isTokenExpired`. See `lib/CLAUDE.md`.
- `types/` — Hand-written Socket.io payload shapes (narrower than the host's). See `types/CLAUDE.md`.

## How it fits in
One of three separate frontends sharing no code. Built with `base: '/player/'` and served by nginx
at `localhost:8080/player/` (the host's QR code points there); dev server on 5174 proxies to the
backend. REST is used only before the game (room ping, guest/login tokens). In the game,
`pages/game/GameLayout.tsx` owns the socket; the only thing a player sends is `submit_answer`.

## Gotchas
- **The phone never shows the question prompt while answering** — only the answer controls. The
  prompt is on the host screen. Plan T8 images accordingly (prompt images → host, option images → phone).
- **Adding a question type (T7)** touches `types/game.ts` (four spots) and the Question, Results,
  and GameOver pages; the answer shape sent must match the backend's scoring code.
- Guests can join any room — the course roster only restricts logged-in users.
- Reconnecting mid-game waits for the server's next push rather than navigating immediately.
- Known display bugs: multi-select "your answer" is blank on `ResultsPage`, and partial credit
  shows as "correct".
- **Theming (T9):** hardcoded dark palette in `index.css` and throughout; the answer buttons use a
  fixed 8-color palette (`OPTION_COLORS`) that needs to work in both themes and stay thumb-friendly.
