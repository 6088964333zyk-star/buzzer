# frontend/player/src/components/

## Purpose
Reusable components for the player app — a small shadcn-style set under `ui/`, sized for
phones, plus the `map_pin` canvas.

## Contents
- `ui/button.tsx` — `Button` (`default` | `outline` | `ghost` | `destructive`; `sm` | `md` | `lg`),
  with larger padding and `active:scale-95` press feedback for touch.
- `ui/card.tsx` — `Card`, `CardHeader`, `CardContent`.
- `ThemeToggle.tsx` — light/dark toggle (T9), fixed top-right; mounted once in `App.tsx`.
- `ui/input.tsx` — Full-width `Input` with large touch padding and `text-base` (avoids iOS zoom).
- `ui/TimerBar.tsx` — Countdown bar (green → yellow → red) with seconds label.
  Props: `totalSeconds`, `paused`.
- `MapCanvas.tsx` — the `map_pin` (T7) `<canvas>`: draws the map, pins, the target's radius
  circles and answer dots; taps → image fractions `{x, y}`. Sized from `aspectRatio` (never the
  image's natural size), height capped at 70% of the window. `imageUrl` swaps the built-in
  `world-map.svg` for an uploaded image (T8); images are cached per URL for the whole page.
  **Identical copies in host, player and admin.**

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
- Colors are T9 tokens only (see `../CLAUDE.md`); `MapCanvas` reads them with `cssColor()` and
  redraws on theme change.
