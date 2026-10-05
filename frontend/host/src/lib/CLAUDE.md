# frontend/host/src/lib/

## Purpose
Small shared helpers: the REST client and the Tailwind class-merge utility.

## Contents
- `api.ts` — `api.get` / `post` / `put` / `patch` / `delete` wrapping `fetch('/api' + path)`, plus
  `api.download(path, fallbackName)`. Adds the `Authorization: Bearer` header from
  `localStorage.token`, throws `Error` with the server's `message` (BuzzerError) or string
  `detail` on non-2xx, and returns `{}` for empty bodies (e.g. 204). `download` fetches a blob
  with the auth header and saves it under the `Content-Disposition` filename. `postForm` /
  `putForm` send `FormData` (image upload/replace, T8) without the JSON `Content-Type`.
  Errors use the server's `message`, a string `detail`, or a validation `detail` array as
  `field: msg; …` (ported from admin's `toError`).
- `images.ts` — `imageUrl(id, version?)` → `/api/images/{id}` (public, no auth; T8). Editors pass
  the image's `sha256` as `version` (`?v=`) so a replaced image reloads; game screens don't.
  Also the `GameImage` list type. Identical in all three apps.
- `numeric.ts` — copy of the player app's `numeric` helpers (T7): parsing for the question
  editor, formatting for the results screens.
- `theme.ts` — T9 light/dark state: `getTheme`, `setTheme` (saves `localStorage['buzzer-theme']`, shared by all three apps), `onThemeChange(cb)` (returns an unsubscribe), and `cssColor(token, alpha)` for canvas/QR code. Follows the OS preference until the user picks. The inline script in `index.html` applies the theme before React renders. Identical in all three apps.
- `utils.ts` — `cn(...)` = `clsx` + `tailwind-merge`.

## How it fits in
Every page that calls the backend over HTTP imports `api` (login, `HomePage` course/game/room
calls, `GameLayout` room lookup, and the `pages/manage/` screens). Real-time traffic does **not** go through here — it uses
`socket.io-client` directly in `../pages/game/GameLayout.tsx`.

## Gotchas
- **`get`/`post`/`put`/`patch` always send `Content-Type: application/json`.** Files go
  through `postForm`/`putForm`; passing `FormData` to `post` would break the multipart
  boundary. The roster upload avoids files entirely: the CSV is parsed in the browser and sent
  as JSON rows.
- No 401 handling: an expired token surfaces as a thrown error on each page; nothing redirects
  to `/login` automatically.
- The `/api` prefix relies on nginx or the Vite dev proxy (`../../vite.config.ts`).
