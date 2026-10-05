# frontend/host/src/components/

## Purpose
Reusable components for the host app: a small shadcn-style primitive set under `ui/`, plus
the feature components for map questions (T7), numeric results (T7) and images (T8).

## Contents
- `ui/button.tsx` — `Button` with `variant` (`default` | `outline` | `ghost` | `destructive`)
  and `size` (`sm` | `md` | `lg`); merges extra classes via `cn`.
- `ui/card.tsx` — `Card`, `CardHeader`, `CardContent` wrappers (rounded, bordered panel).
- `ThemeToggle.tsx` — light/dark toggle (T9), fixed top-right; mounted once in `App.tsx`.
- `ui/input.tsx` — Styled `Input` (full width, focus ring).
- `ui/TimerBar.tsx` — Countdown bar that turns green → yellow → red, with seconds label.
  Props: `totalSeconds`, optional `initialSeconds` (for reconnect/locked resume), `paused`.
- `NumericBuckets.tsx` — the `numeric` (T7) direction-of-error chart: five bars from "Way under"
  to "Way over", from the bucket keys in the answer distribution, plus the answer and "N of M
  within full credit". `size="large"` on results, `"card"` on game over.
- `MapCanvas.tsx` — the `map_pin` (T7) `<canvas>`: draws the map, pins, the target's radius
  circles and answer dots; taps → image fractions `{x, y}`. Sized from `aspectRatio` (never the
  image's natural size), height capped at 70% of the window. `imageUrl` swaps the built-in
  `world-map.svg` for an uploaded image (T8); images are cached per URL for the whole page.
  **Identical copies in host, player and admin.**
- `MapPicker.tsx` — editor control for `map_pin`: `MapCanvas` + target click + the two radius
  inputs; `imageUrl`/`aspectRatio` props for a custom map (T8). Identical in host and admin.
- `ImageLibrary.tsx` — a game's images (T8, `docs/design-t8-images.md`): upload (multi-file),
  thumbnail, size, "Used by Q…", **Replace** and **Delete** (the server's 409 messages are
  shown). `prefix` is `/host` or `/admin`. Identical in host and admin.
- `ImagePicker.tsx` — "choose one image from the library, or none" popover, used for the prompt
  image, each option and the map image. Identical in host and admin.

## How it fits in
Used by `../pages/` (Home, Login), `../pages/game/` (Lobby, Question, Results, GameOver) and
`../pages/manage/QuestionEditorPage.tsx` (MapPicker, ImageLibrary, ImagePicker).
All class merging goes through `../lib/utils.ts` (`cn`).

## Gotchas
- **TimerBar runs its interval once on mount.** It ignores later changes to `totalSeconds` /
  `initialSeconds`; the parent must pass `key={questionId}` to reset it per question. Pausing
  works by freezing the remaining time and sliding the end time forward.
- The timer is purely visual — the server's own timer decides when answers lock.
- These files are near-copies of `frontend/player/src/components/ui/` and
  `frontend/admin/src/components/ui/` (no shared package). A fix or theme change here must be
  repeated in the other apps.
- Colors are T9 tokens only (see `../CLAUDE.md`). `MapCanvas` can't use classes, so it reads
  tokens with `cssColor()` at draw time and redraws on `onThemeChange`. Focus styling is the
  global `:focus-visible` outline in `index.css`; don't add `focus:ring-*`.
