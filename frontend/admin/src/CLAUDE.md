# frontend/admin/src/

## Purpose
The admin app: a React + Vite + Tailwind management UI for courses, rosters, users and access,
guests, games and questions, and past sessions.

## Contents
- `main.tsx` — Mounts `<App />` in `StrictMode`.
- `App.tsx` — Routes plus `AdminLayout` (sidebar: Courses, Users, Games, Guests, Sessions; Logout).
  `RequireAdmin` only checks that a token exists — it does not check the user's role.
- `index.css` — Tailwind directives and a hardcoded dark body background/text.
- `pages/` — One self-contained page per screen, including the ~790-line `QuestionEditorPage`
  and the client-side CSV mapping wizard in `RosterPage`. See `pages/CLAUDE.md`.
- `components/` — `ui/` primitives: `Button`, `Card`, `Input`. See `components/CLAUDE.md`.
- `lib/` — The fullest `api.ts` of the three apps (`put`, `patch`, `postForm`, `download`) and `cn`.
  See `lib/CLAUDE.md`.

## How it fits in
One of three separate frontends sharing no code. Built with `base: '/admin/'` and served by nginx
at `localhost:8080/admin/`; dev server on 5175. Pure REST, no Socket.io: almost every call goes to
`/api/admin/*`, which the backend protects with `require_admin`.

## Gotchas
- **T4 restructures this app** to put admin tasks first (users, courses, access) with host/player
  functions secondary, and moves roster, game editing, and downloads to the host. Since the apps
  don't share code and the endpoints are admin-only, that means extracting or copying pages and
  adding host-authorized endpoints.
- A non-admin with a token can open the UI; every request then fails with 403.
- **Adding a question type (T7)** means updating about six places in `QuestionEditorPage`; an
  unhandled type is silently saved as fill-in-the-blank.
- Known editor bug: blank multi-select/FITB rows with points inflate `points_value`.
- Games are created without a course; access is granted per user. T4 changes this model.
- **Theming (T9):** hardcoded palette in `index.css`, the sidebar, and every page; the `ui/`
  primitives cover only a small part of the UI.
