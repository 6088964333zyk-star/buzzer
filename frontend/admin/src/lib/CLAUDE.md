# frontend/admin/src/lib/

## Purpose
Small shared helpers: the most complete REST client of the three apps, a JWT claim reader,
and the Tailwind class-merge utility.

## Contents
- `api.ts` — `get`, `post`, `put`, `patch`, `delete` (JSON; Bearer token from
  `localStorage.token`; `{}` for empty bodies), plus the two below. On non-2xx every call throws
  via `toError`: the backend's `message`, else a string `detail`, else a validation `detail`
  array as `field: msg; …`, else `HTTP <status>` (also for non-JSON bodies).
  - `postForm(path, FormData)` / `putForm(path, FormData)` — multipart upload (game import,
    image upload and replace); omits `Content-Type` so the browser sets the boundary.
  - `download(path)` — authenticated `fetch` → blob → temporary `<a download>`, using the
    filename from `Content-Disposition`.
- `auth.ts` — `getTokenClaims()` decodes (doesn't verify) `localStorage.token`'s `role` and `exp`;
  used by `RequireAdmin` in `../App.tsx`. Decoding copied from the player app's `isTokenExpired`.
- `images.ts` — `imageUrl(id, version?)` → `/api/images/{id}` (public, no auth; T8). Editors pass
  the image's `sha256` as `version` (`?v=`) so a replaced image reloads; game screens don't.
  Also the `GameImage` list type. Identical in all three apps.
- `numeric.ts` — `parseNumber` / `formatNumber` / `withUnit` for the `numeric` (T7) fields in
  `QuestionEditorPage` (copied from the player app).
- `utils.ts` — `cn(...)` = `clsx` + `tailwind-merge`.

## How it fits in
Every page in `../pages/` imports `api`. `postForm` is used for game JSON import; `download`
for game export, session CSV export, and the HTML session report.

## Gotchas
- `download` expects the filename in `filename="…"` form; otherwise the file is named `download`.
- No 401 handling: an expired token shows up as an error message on the page; nothing
  redirects to `/login`.
