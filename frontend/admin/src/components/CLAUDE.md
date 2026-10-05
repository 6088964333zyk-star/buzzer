# frontend/admin/src/components/

## Purpose
Reusable components for the admin app — a small shadcn-style set under `ui/`, plus the
question-editor components copied from the host app (map questions T7, images T8). Other
forms, tables and dialogs are written inline in each page.

## Contents
- `ui/button.tsx` — `Button` (`default` | `outline` | `ghost` | `destructive`; `sm` | `md` | `lg`).
- `ui/card.tsx` — `Card`, `CardHeader`, `CardContent`.
- `ThemeToggle.tsx` — light/dark toggle (T9): `variant="sidebar"` (AdminLayout footer, with a label) or `"floating"` (Login, NotAdmin).
- `ui/input.tsx` — Styled full-width `Input`.
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
Used by `../pages/*`. Class merging via `../lib/utils.ts`.

## Gotchas
- Byte-for-byte identical to `frontend/host/src/components/ui/{button,card,input}.tsx`; the player
  versions differ. There's no shared package, so changes must be copied by hand.
- No `TimerBar` here (admin never runs a game).
- Because pages build their own tables and forms, restyling these three files covers only part
  of the admin UI; T9 theming went through the pages too.
- Colors are T9 tokens only (see `../CLAUDE.md`); `MapCanvas` reads them with `cssColor()` and
  redraws on theme change.
