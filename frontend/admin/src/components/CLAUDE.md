# frontend/admin/src/components/

## Purpose
Reusable presentational components for the admin app — a small shadcn-style set under `ui/`.
No feature-level components; forms, tables, and dialogs are written inline in each page.

## Contents
- `ui/button.tsx` — `Button` (`default` | `outline` | `ghost` | `destructive`; `sm` | `md` | `lg`).
- `ui/card.tsx` — `Card`, `CardHeader`, `CardContent`.
- `ui/input.tsx` — Styled full-width `Input`.

## How it fits in
Used by `../pages/*`. Class merging via `../lib/utils.ts`.

## Gotchas
- Byte-for-byte identical to `frontend/host/src/components/ui/{button,card,input}.tsx`; the player
  versions differ. There's no shared package, so changes must be copied by hand.
- No `TimerBar` here (admin never runs a game).
- Because pages build their own tables and forms, restyling these three files covers only part
  of the admin UI — T9 theming has to go through the pages too.
- Hardcoded palette classes (`bg-indigo-600`, `slate-*`) — T9 target.
