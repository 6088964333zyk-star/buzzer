# frontend/host/src/lib/

## Purpose
Small shared helpers: the REST client and the Tailwind class-merge utility.

## Contents
- `api.ts` — `api.get` / `post` / `put` / `patch` / `delete` wrapping `fetch('/api' + path)`, plus
  `api.download(path, fallbackName)`. Adds the `Authorization: Bearer` header from
  `localStorage.token`, throws `Error` with the server's `message` (BuzzerError) or string
  `detail` on non-2xx, and returns `{}` for empty bodies (e.g. 204). `download` fetches a blob
  with the auth header and saves it under the `Content-Disposition` filename.
- `numeric.ts` — copy of the player app's `numeric` helpers (T7): parsing for the question
  editor, formatting for the results screens.
- `utils.ts` — `cn(...)` = `clsx` + `tailwind-merge`.

## How it fits in
Every page that calls the backend over HTTP imports `api` (login, `HomePage` course/game/room
calls, `GameLayout` room lookup, and the `pages/manage/` screens). Real-time traffic does **not** go through here — it uses
`socket.io-client` directly in `../pages/game/GameLayout.tsx`.

## Gotchas
- **Always sends `Content-Type: application/json`.** Passing `FormData` (e.g. a future image
  upload, T8) through `apiFetch` will break the multipart boundary — a file upload needs a
  variant that omits the header. The roster upload avoids this: the CSV is parsed in the
  browser and sent as JSON rows.
- FastAPI validation errors (`detail` is an array) fall back to `HTTP 422`; the admin app's
  `toError` formats them, this one doesn't.
- No 401 handling: an expired token surfaces as a thrown error on each page; nothing redirects
  to `/login` automatically.
- The `/api` prefix relies on nginx or the Vite dev proxy (`../../vite.config.ts`).
