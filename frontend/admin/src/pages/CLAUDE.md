# frontend/admin/src/pages/

## Purpose
Every screen of the admin app: course/roster, user/access, guest, game/question, and session
management. Each page is a self-contained route component that loads its own data over REST.

## Contents
- `LoginPage.tsx` — Username/password → `POST /api/auth/login`, stores `token`, goes to `/courses`.
- `CoursesPage.tsx` — List, create, and edit courses (name, semester); links to each roster.
- `RosterPage.tsx` — Course roster table with inline edit and activate/deactivate (`PATCH`).
  CSV import is a client-side wizard: parse the file in the browser (`parseCSV`), auto-detect
  Canvas gradebook columns ("SIS Login ID"), let the user map columns and strip `@domain`, then
  `POST /roster/import` with JSON rows.
- `UsersPage.tsx` — List users, create local accounts; click through to detail.
- `UserDetailPage.tsx` — Edit a user, grant/revoke per-course access (HOST or PLAYER) and
  per-game access, delete the user.
- `GuestsPage.tsx` — List guest accounts, merge a guest's scores into a real netid, delete guests.
- `GamesPage.tsx` — List, create, edit, delete games; import a game JSON file (`postForm`).
- `QuestionEditorPage.tsx` — Largest page (~790 lines). Question list with up/down reorder,
  inline create/edit form (`QuestionForm`), delete, and "Export JSON". Per-type helpers
  convert between the form and the API shape: `questionToForm`, `formToPayload`, and
  `build{Mc,Tf,Ms,Fib}Payload`.
  T7 adds `map_pin` (a `MapPicker`) and `numeric` (answer, unit, absolute/percent tolerances
  as text fields parsed with `lib/numeric.parseNumber`, a live preview of the effective range);
  both use the form's own points field. The host app's copy of this editor gets the same
  changes.
- `SessionsPage.tsx` — Sessions filtered by status; per-session CSV export with options,
  HTML report download, and delete (`DELETE /api/game/sessions/{id}`).

## How it fits in
Routed in `../App.tsx` under `AdminLayout` (sidebar: Courses, Users, Games, Guests, Sessions).
All calls go through `../lib/api.ts` to `/api/admin/*`, which the backend guards with
`require_admin` — so every page here is admin-only on the server side.

## Gotchas
- **T4 moves much of this to the host.** Roster, game/question editing, and session
  downloads are what the host app needs. The host app is a separate Vite build and can't import
  these files, and the endpoints they call are admin-only — so reuse means copying/extracting
  components *and* adding host-authorized endpoints with course checks.
- **Question-type logic lives in `QuestionEditorPage`**: the `QuestionType` union, `FormState`
  fields, `questionToForm`, `formToPayload`, `points_value` derivation, the form's per-type
  sections, and the list's per-type preview. A new type (T7) must touch all of them.
- **`formToPayload` falls through to fill-in-the-blank** in its final `else` — an unhandled
  type is silently saved with FITB config.
- **`points_value` is computed on the client** (max option points for MC/TF/FITB, sum of positive
  points for multi-select). For multi-select and FITB it uses the unfiltered list while the
  payload drops blank entries, so a blank row with points can inflate `points_value` above
  what's achievable (nobody is ever marked fully correct).
- Games have no course; `GamesPage` creates them standalone. Access is granted per user in
  `UserDetailPage` (T4 changes this).
- The multipart `POST /admin/courses/{id}/roster` endpoint isn't used by the UI — only the JSON
  `/roster/import` path is.
- Four pages use `window.confirm()` before deletes (Games, Questions, Users, Guests).
- Colors are hardcoded palette classes throughout — T9 target.
