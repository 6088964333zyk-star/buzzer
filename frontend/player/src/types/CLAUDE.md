# frontend/player/src/types/

## Purpose
TypeScript shapes for the Socket.io payloads a player receives, plus the player's phase enum.

## Contents
- `game.ts` — `SyncStatePayload`, `PlayerJoinedPayload`, `QuestionPayload`,
  `AnswerResultPayload`, `PlayerResultsPayload`, `PlayerGameOverPayload`,
  `QuestionSummaryItem` (includes the player's own `playerAnswer`), the `PlayerAnswerReveal`
  union, and `PlayerPhase` (`'lobby' | 'question' | 'feedback' | 'results' | 'gameover'`).

## How it fits in
Imported by `../pages/game/*`. Hand-written mirrors of what `backend/app/websocket/gateway.py`
sends to a player's `user:{id}` room or the whole room. Nothing checks them against the server.

## Gotchas
- **Separate from the host's `types/game.ts`** and narrower: `QuestionPayload` here omits
  `gradingType` and `editDistance` even though the server sends both, and `SyncStatePayload`
  omits `currentQuestion` / `hasAnswered` / `yourScore`. Add the field before using it.
- The question `type` union appears in `QuestionPayload` and `QuestionSummaryItem`, and
  `PlayerAnswerReveal` has one variant per type; `playerAnswer` lists every answer-data key.
  A new question type (T7) must update all four.
- `config` is typed as only `{ options?; maxLength? }`.
- `PlayerAnswerReveal` has no empty-object variant, but the server sends `{}` for a type it
  doesn't recognize — code narrowing on `.type` should tolerate that.
