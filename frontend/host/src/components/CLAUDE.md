# frontend/host/src/components/

## Purpose
Reusable presentational components for the host app. Currently only a small shadcn-style
primitive set under `ui/`; there are no feature-level components yet.

## Contents
- `ui/button.tsx` — `Button` with `variant` (`default` | `outline` | `ghost` | `destructive`)
  and `size` (`sm` | `md` | `lg`); merges extra classes via `cn`.
- `ui/card.tsx` — `Card`, `CardHeader`, `CardContent` wrappers (rounded, bordered panel).
- `ui/input.tsx` — Styled `Input` (full width, focus ring).
- `ui/TimerBar.tsx` — Countdown bar that turns green → yellow → red, with seconds label.
  Props: `totalSeconds`, optional `initialSeconds` (for reconnect/locked resume), `paused`.

- `NumericBuckets.tsx` — the `numeric` (T7) direction-of-error chart: five bars from "Way under"
  to "Way over", from the bucket keys in the answer distribution, plus the answer and "N of M
  within full credit". `size="large"` on results, `"card"` on game over.

## How it fits in
Used by `../pages/` (Home, Login) and `../pages/game/` (Lobby, Question, Results, GameOver).
All class merging goes through `../lib/utils.ts` (`cn`).

## Gotchas
- **TimerBar runs its interval once on mount.** It ignores later changes to `totalSeconds` /
  `initialSeconds`; the parent must pass `key={questionId}` to reset it per question. Pausing
  works by freezing the remaining time and sliding the end time forward.
- The timer is purely visual — the server's own timer decides when answers lock.
- These files are near-copies of `frontend/player/src/components/ui/` and
  `frontend/admin/src/components/ui/` (no shared package). A fix or theme change here must be
  repeated in the other apps.
- Colors are hardcoded palette classes (`bg-indigo-600`, `border-slate-700`,
  `focus:ring-offset-slate-900`, …). Theming (T9) should start here, since every page uses these.
