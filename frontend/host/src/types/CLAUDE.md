# frontend/host/src/types/

## Purpose
TypeScript shapes for the Socket.io payloads the host receives, plus the host's phase enum.

## Contents
- `game.ts` — `SyncStatePayload`, `PlayerJoinedPayload`, `PlayerLeftPayload`, `QuestionPayload`,
  `AnswerStatusPayload`, `AnswerPhaseEndedPayload`, `HostResultsPayload`, `HostGameOverPayload`,
  `HostQuestionSummaryItem`, the `AnswerReveal` discriminated union, `LeaderboardEntry`
  (unused), and `HostPhase` (`'lobby' | 'question' | 'results' | 'gameover'`).

## How it fits in
Imported by `../pages/game/*`. These are hand-written mirrors of what
`backend/app/websocket/gateway.py` emits — nothing generates or checks them against the server.

## Gotchas
- **Hand-maintained contract.** If the backend payload changes, update this file by hand; `tsc`
  won't notice a mismatch because payloads arrive untyped from `socket.on`.
- The question `type` is a closed string union in both `QuestionPayload` and
  `HostQuestionSummaryItem`, and `AnswerReveal` has one variant per type. A new question type
  (T7) must be added in all three places.
- `config` is the shared `QuestionConfig` (`options`, `maxLength`, T7's `aspectRatio`/`unit`,
  T8's `imageId`/`optionImages`/`mapImageId`) — new per-type config fields go there.
- `AnswerStatusPayload` declares `displayName` and `answered`, but the server only sends
  `userId`, `answeredCount`, `totalPlayers`. Don't rely on the extra fields.
- `startedAt` on `QuestionPayload` is present only in `sync_state` (reconnect), not `new_question`.
- The player app has its own, different `types/game.ts`; the two are not shared.
