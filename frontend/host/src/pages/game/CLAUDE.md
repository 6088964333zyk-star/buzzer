# frontend/host/src/pages/game/

## Purpose
The live-game screens shown on the classroom display while a room is running. One layout owns
the Socket.io connection; four child pages render whichever phase the server says the game is in.

## Contents
- `GameLayout.tsx` — Route element for `/game/:code/*`. Opens the socket (JWT in `auth`), emits
  `join_room` as `HOST`, subscribes to every server event, holds all game state, and navigates
  between child routes on `sync_state` / `new_question` / `question_results` / `game_over`.
  Exposes state plus `emitAdvance` / `emitLockQuestion` through `GameContext` (`useGame()`).
  Also renders the persistent QR code + room-code panel in the bottom-right corner.
- `LobbyPage.tsx` — Large QR code, room code, live player count, auto-advance toggle, and the
  Start button (`host_advance`; disabled until at least one player joins).
- `QuestionPage.tsx` — Question number/type/grading label, `TimerBar`, the prompt, answered
  count, Lock/Unlock (`host_lock_question`) and Show Results (`host_advance`). Auto-advances
  1.5 s after `answer_phase_ended` when auto-advance is on.
- `ResultsPage.tsx` — Per-question results: bar chart (MC, TF, multi-select, completeness) or
  word cloud (fill-in-the-blank, colored with a local Levenshtein against accepted answers).
  Next / Show Final Results button; 10 s countdown when auto-advance is on.
- `GameOverPage.tsx` — Anonymous score histogram (buckets from `maxPossibleScore`) and one
  summary card per question (distribution, correct %, average answer time). "New Game" button.

## How it fits in
Child routes of `GameLayout` in `src/App.tsx`. The pages never talk to the socket directly —
they read `useGame()` and call its emit functions. Event names and payload shapes mirror
`backend/app/websocket/events.py` and `gateway.py`; the TypeScript shapes live in `../../types/game.ts`.
Entered from `../HomePage.tsx` after `POST /api/game/rooms`.

## Gotchas
- **The server drives navigation.** Pages don't decide the phase; `GameLayout` navigates when
  events arrive. Adding a phase means a new event handler there, not just a new page.
- **Question-type logic is spread across files.** `QuestionPage` (`typeLabel`, FITB edit-distance
  label), `ResultsPage` (`buildBars`, `isFitb` → word cloud), and `GameOverPage` (`typeLabel`,
  per-type card rendering) each switch on `type` / `answerReveal.type`. A new question type
  (T7) must be added to all three or it renders as a blank chart / raw type string.
- **The host never shows answer options while a question is open** — only the prompt. Options
  first appear as bar labels on `ResultsPage`. The prompt is also hidden while locked.
- **No session id in context.** `GameLayout` fetches `/api/game/rooms/:code` but keeps only
  `game_title`; the `session_id` in that response is dropped. Host-side downloads (T4) need it.
- **GameOverPage has no export buttons** today; CSV export exists only in the backend
  (`GET /api/game/sessions/{id}/export`) and the HTML report is admin-only.
- `sync_state` handles `LOBBY` and `IN_PROGRESS` only. Reconnecting after `COMPLETED` leaves the
  host on the default lobby phase with no game-over data (the server doesn't resend it).
- `answer_phase_ended` is ignored unless its `questionId` matches the current question
  (guards against stale timer tasks on the server).
- Join URL is built as `${origin}/player/join?code=…`, which only resolves behind nginx
  (`localhost:8080`), not under the Vite dev server ports.
- Auto-advance state lives only in `GameLayout` memory; a page reload turns it off.
- Colors are hardcoded Tailwind palette classes (`slate-*`, `indigo-*`, `green-*`, …) — T9 target.
