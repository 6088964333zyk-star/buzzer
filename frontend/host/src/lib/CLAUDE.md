# frontend/host/src/lib/

## Purpose
Small shared helpers: the REST client and the Tailwind class-merge utility.

## Contents
- `api.ts` — `api.get` / `api.post` / `api.delete` wrapping `fetch('/api' + path)`. Adds the
  `Authorization: Bearer` header from `localStorage.token`, throws `Error(detail)` on non-2xx,
  and returns `{}` for empty bodies (e.g. 204).
- `numeric.ts` — copy of the player app's `numeric` helpers (T7): parsing for the question
  editor, formatting for the results screens.
- `utils.ts` — `cn(...)` = `clsx` + `tailwind-merge`.

## How it fits in
Every page that calls the backend over HTTP imports `api` (login, `HomePage` course/game/room
calls, `GameLayout` room lookup). Real-time traffic does **not** go through here — it uses
`socket.io-client` directly in `../pages/game/GameLayout.tsx`.

## Gotchas
- **No `put` or `patch`.** The backend updates questions with `PUT` and roster entries with
  `PATCH`; T4 host game/roster management needs these added.
- **Always sends `Content-Type: application/json`.** Passing `FormData` (roster CSV upload, game
  JSON import, image upload) through `apiFetch` will break the multipart boundary — a file
  upload needs a variant that omits the header.
- **No file-download helper.** Responses are parsed as JSON; CSV/HTML exports need a separate
  `fetch` → `blob` path (the auth header still has to be added, so a plain `<a href>` won't work).
- No 401 handling: an expired token surfaces as a thrown error on each page; nothing redirects
  to `/login` automatically.
- The `/api` prefix relies on nginx or the Vite dev proxy (`../../vite.config.ts`).
