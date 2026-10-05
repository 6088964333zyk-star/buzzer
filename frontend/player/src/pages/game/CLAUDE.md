# frontend/player/src/pages/game/

## Purpose
The in-game screens on a player's phone. One layout owns the Socket.io connection; five child
pages render the phase the server has put this player in.

## Contents
- `GameLayout.tsx` — Route element for `/game/:code/*`. Checks the stored JWT (redirects to
  `/name/:code` if missing/expired), opens the socket, emits `join_room` as `PLAYER`, handles
  every server event, and navigates between child routes. Exposes state and `emitAnswer()`
  through `GameContext` (`useGame()`). Shows a "host disconnected" banner; disconnects the
  socket itself on `game_over`.
- `LobbyPage.tsx` — Room code, spinner, player count; text changes to "Waiting for next
  question…" when joining a game already in progress.
- `QuestionPage.tsx` — The answer UI, one branch per type: colored A/B/C… buttons
  (`multiple_choice` → `{selectedIndex}`), True/False buttons (`{selectedValue}`), text box
  (`fill_in_the_blank` → `{text}`, `config.maxLength`, default 100), toggle list + Submit
  (`multi_select` → `{selectedIndices}`), and for `numeric` (T7) a decimal-keypad text field
  with "±" / "×10ⁿ" buttons (iOS's keypad has no `-` or `e`) → `{value: number}`, parsed by
  `lib/numeric.parseNumber`. Measures `answerTimeMs` from page mount. Falls back to
  "Unsupported question type."
- `FeedbackPage.tsx` — "Answer locked in!" waiting screen after `answer_received`; deliberately
  shows no correctness.
- `ResultsPage.tsx` — After `question_results`: correct/incorrect (or participation), points for
  this question, running score, rank, and the player's own answer. The correct answer is shown
  only for fill-in-the-blank (`fitbAccepted`); MC/TF/multi-select show just correct/incorrect
  and points.
- `GameOverPage.tsx` — Final score and rank, plus a per-question review card (prompt, your
  answer, correct answer, points, time).

## How it fits in
Child routes of `GameLayout` in `src/App.tsx`, reached from `../NamePage.tsx` / `../LoginPage.tsx`
after the player has a token. Pages read `useGame()` only; the one outbound event is
`submit_answer` via `emitAnswer`. Payload shapes are in `../../types/game.ts` and mirror
`backend/app/websocket/gateway.py`.

## Gotchas
- **The player never sees the question prompt while answering.** The prompt is shown on the
  host's big screen; the phone shows only the answer controls (and option text). The prompt
  first appears on `GameOverPage`. T8 follows this: the prompt image (`config.imageId`) is
  never shown on the phone; option images are (`QuestionPage` switches MC and multi-select to
  a 2-column tile grid, image capped at 20vh, when any `config.optionImages` entry is set).
  `map_pin` uses `config.mapImageId` as its map on the question and results screens.
- **Question-type logic is spread across files.** `QuestionPage` (input UI + answer shape),
  `ResultsPage` (`describeAnswer`), and `GameOverPage` (`describePlayerAnswer`, reveal text)
  each switch on `type`. A new type (T7) needs all three, and its `answer_data` shape must match
  what the backend's `calculate_score` reads.
- `ResultsPage.describeAnswer` has no `multi_select` branch, so "your answer" is blank for that type.
- `ResultsPage` treats any `yourPoints > 0` as correct, so partial credit shows as correct —
  except `map_pin` and `numeric` (T7), which have their own branches. `numeric` computes
  "Spot on!" on the phone with `lib/numeric.isFullCredit`, because `question_results` carries
  no `isCorrect`.
- **Reconnecting mid-game doesn't navigate by itself.** On `sync_state` with `IN_PROGRESS` the
  layout only sets `gameStatus`; the player moves on only when the server pushes the late-join
  `new_question` or the next `question_results`. If they already answered, they wait.
- `lastAnswerData` lives in memory only; after a reload `ResultsPage` can't show "your answer".
- The client never emits `rejoin_room` (the server supports it); it always re-sends `join_room`.
- `answer_received` carries `isCorrect` / `pointsAwarded` immediately, before results — the UI
  hides it, but it's visible in devtools.
- Once `game_over` arrives, the socket is closed and later connect/errors are ignored.
- Colors are T9 tokens only (see `../../CLAUDE.md`); `OPTION_COLORS` maps to `option-N`/`on-option-N`.
  Page roots reserve `pt-16` for the fixed theme toggle.
