# frontend/admin/src/lib/

## Purpose
Small shared helpers: the most complete REST client of the three apps, and the Tailwind
class-merge utility.

## Contents
- `api.ts` — `get`, `post`, `put`, `patch`, `delete` (JSON; Bearer token from
  `localStorage.token`; throws `Error(detail)` on non-2xx; `{}` for empty bodies), plus:
  - `postForm(path, FormData)` — multipart upload; omits `Content-Type` so the browser sets the boundary.
  - `download(path)` — authenticated `fetch` → blob → temporary `<a download>`, using the
    filename from `Content-Disposition`.
- `utils.ts` — `cn(...)` = `clsx` + `tailwind-merge`.

## How it fits in
Every page in `../pages/` imports `api`. `postForm` is used for game JSON import; `download`
for game export, session CSV export, and the HTML session report.

## Gotchas
- **The host app's `api.ts` lacks `put`, `patch`, `postForm`, and `download`.** T4 host features
  (question editing, roster, downloads) need them — copy from here rather than re-inventing.
- `download` expects the filename in `filename="…"` form; otherwise the file is named `download`.
- No 401 handling: an expired token shows up as an error message on the page; nothing
  redirects to `/login`.
