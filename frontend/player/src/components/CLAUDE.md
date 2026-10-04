# frontend/player/src/components/

## Purpose
Reusable presentational components for the player app — a small shadcn-style set under `ui/`,
sized for phones. No feature-level components yet.

## Contents
- `ui/button.tsx` — `Button` (`default` | `outline` | `ghost` | `destructive`; `sm` | `md` | `lg`),
  with larger padding and `active:scale-95` press feedback for touch.
- `ui/card.tsx` — `Card`, `CardHeader`, `CardContent`.
- `ui/input.tsx` — Full-width `Input` with large touch padding and `text-base` (avoids iOS zoom).
- `ui/TimerBar.tsx` — Countdown bar (green → yellow → red) with seconds label.
  Props: `totalSeconds`, `paused`.

## How it fits in
Used by `../pages/` (Join, Name, Login) and `../pages/game/`. Class merging via `../lib/utils.ts`.

## Gotchas
- **Copies of the host/admin `ui/` files, but not identical** — bigger radius and padding, and
  this `TimerBar` has no `initialSeconds` prop (a late joiner gets a shortened
  `timeLimitSeconds` from the server instead). Don't assume a fix in one app applies to the others.
- `TimerBar` starts its interval once on mount; the parent must pass `key={questionId}` to reset
  it. It's visual only — the server decides when answers lock.
- The answer buttons in `../pages/game/QuestionPage.tsx` are hand-built `<button>`s, not `Button`,
  so restyling `Button` doesn't change them.
- Hardcoded palette classes throughout — T9 target.
