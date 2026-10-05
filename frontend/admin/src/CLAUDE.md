# frontend/admin/src/

## Purpose
The admin app: a React + Vite + Tailwind management UI for courses, rosters, users and access,
guests, games and questions, and past sessions.

## Contents
- `main.tsx` — Mounts `<App />` in `StrictMode`.
- `App.tsx` — Routes plus `AdminLayout`. The sidebar is admin-first (T4): **Administration**
  (Courses, Users, Guests), then a secondary **Host & play** group (Games, Sessions, and links that
  open `/host/` and `/player/` in a new tab), then Logout. `RequireAdmin` decodes the JWT
  (`lib/auth.ts`): missing/expired → `/login`; role not ADMIN → `NotAdminPage`.
- `index.css` — Tailwind directives and a hardcoded dark body background/text.
- `pages/` — One self-contained page per screen, including the ~790-line `QuestionEditorPage`
  and the client-side CSV mapping wizard in `RosterPage`. See `pages/CLAUDE.md`.
- `components/` — `ui/` primitives (`Button`, `Card`, `Input`) plus the editor's `MapCanvas`/`MapPicker`
  (T7) and `ImageLibrary`/`ImagePicker` (T8). See `components/CLAUDE.md`.
- `lib/` — `api.ts` (`put`, `patch`, `postForm`, `putForm`, `download`), the JWT claim reader
  `auth.ts`, `images.ts` (T8), `mapPin.ts`, `numeric.ts` and `cn`. See `lib/CLAUDE.md`.

## How it fits in
One of three separate frontends sharing no code. Built with `base: '/admin/'` and served by nginx
at `localhost:8080/admin/`; dev server on 5175. Pure REST, no Socket.io: almost every call goes to
`/api/admin/*`, which the backend protects with `require_admin`.

## Gotchas
- **T4 (docs/design-t4-admin.md):** admin tasks come first; the course page is the access hub.
  The host app has its *own copies* of the roster, game/question editor and session pages
  (`feature/t4-host`, `/api/host/*`). This app keeps its versions as secondary ("Host & play") —
  they're the only place to edit games that have no course, delete games, or import/export JSON.
- The role check in `RequireAdmin` is decoded, not verified — a UX guard. The backend's
  `require_admin` is the real check. The role in the token is fixed at login.
- **Adding a question type (T7)** means updating about six places in `QuestionEditorPage`; an
  unhandled type is silently saved as fill-in-the-blank.
- Known editor bug: blank multi-select/FITB rows with points inflate `points_value`.
- **Game access is course-based** (T4): a game belongs to one course, set once. Per-game grants
  (`UserGameAccess`) no longer do anything and have no UI; the endpoints remain unused.
- **Theming (T9):** hardcoded palette in `index.css`, the sidebar, and every page; the `ui/`
  primitives cover only a small part of the UI.
