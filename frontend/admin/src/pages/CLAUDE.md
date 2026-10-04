# frontend/admin/src/pages/

## Purpose
Every screen of the admin app: course/roster, user/access, guest, game/question, and session
management. Each page is a self-contained route component that loads its own data over REST.

## Contents
- `LoginPage.tsx` — Username/password → `POST /api/auth/login`, stores `token`, goes to `/courses`.
- `CoursesPage.tsx` — List and create courses; each name links to its `CourseDetailPage`.
- `CourseDetailPage.tsx` — The access hub for one course (`/courses/:courseId`): edit name/semester;
  **people with access** (from `GET /admin/courses/{id}/access`; add a USER, change HOST↔PLAYER,
  revoke — via the per-user course-access endpoints); **game access** (the course's games, host/
  player/roster counts, assign a course-less game — set once); roster counts and a link to the
  roster page. Loads five requests with `Promise.allSettled`; if the course itself fails, shows
  only that error.
- `NotAdminPage.tsx` — Shown by `RequireAdmin` to a non-admin token: links to the host and player
  apps, a "log in again if you were just promoted" note, and Log out.
- `RosterPage.tsx` — Course roster table with inline edit and activate/deactivate (`PATCH`).
  CSV import is a client-side wizard: parse the file in the browser (`parseCSV`), auto-detect
  Canvas gradebook columns ("SIS Login ID"), let the user map columns and strip `@domain`, then
  `POST /roster/import` with JSON rows. Rejects more than 1000 mapped rows before sending (mirrors
  `roster_service.MAX_ROWS`). "Back to course" → `/courses/:courseId`.
- `UsersPage.tsx` — List users, create local accounts; click through to detail.
- `UserDetailPage.tsx` — Edit a user, grant/revoke per-course access (HOST or PLAYER), delete the
  user. "Game Access" is read-only, derived from course access (games of each course the user has
  a role in); it doesn't include roster-based play access, and says so.
- `GuestsPage.tsx` — List guest accounts, merge a guest's scores into a real netid, delete guests.
- `GamesPage.tsx` — List, create, edit, delete games. Create requires a course; import needs a
  course chosen first, then imports (`postForm`) and assigns it with `PUT {course_id}` — if that
  second call fails, the game stays "No course" with an inline Assign control. With no courses,
  create/import are disabled.
- `QuestionEditorPage.tsx` — Largest page (~790 lines). Question list with up/down reorder,
  inline create/edit form (`QuestionForm`), delete, and "Export JSON". Per-type helpers
  convert between the form and the API shape: `questionToForm`, `formToPayload`, and
  `build{Mc,Tf,Ms,Fib}Payload`.
- `SessionsPage.tsx` — Sessions filtered by status; per-session CSV export with options,
  HTML report download, and delete (`DELETE /api/game/sessions/{id}`).

## How it fits in
Routed in `../App.tsx` under `AdminLayout` (Administration: Courses, Users, Guests; Host & play:
Games, Sessions).
All calls go through `../lib/api.ts` to `/api/admin/*`, which the backend guards with
`require_admin` — so every page here is admin-only on the server side.

## Gotchas
- **The host app has its own copies** of the roster, question editor and session pages
  (`feature/t4-host`, calling `/api/host/*`). Changes here (e.g. a new question type) must be
  made in both apps.
- **Question-type logic lives in `QuestionEditorPage`**: the `QuestionType` union, `FormState`
  fields, `questionToForm`, `formToPayload`, `points_value` derivation, the form's per-type
  sections, and the list's per-type preview. A new type (T7) must touch all of them.
- **`formToPayload` falls through to fill-in-the-blank** in its final `else` — an unhandled
  type is silently saved with FITB config.
- **`points_value` is computed on the client** (max option points for MC/TF/FITB, sum of positive
  points for multi-select). For multi-select and FITB it uses the unfiltered list while the
  payload drops blank entries, so a blank row with points can inflate `points_value` above
  what's achievable (nobody is ever marked fully correct).
- A game's course is **set once** (`PUT` 409s on a change). Legacy games may still have none;
  only admins can run or edit those until one is assigned (GamesPage or the course page).
- The multipart `POST /admin/courses/{id}/roster` endpoint isn't used by the UI — only the JSON
  `/roster/import` path is.
- Pages use `window.confirm()` before deletes, revokes, and course assignment.
- Colors are hardcoded palette classes throughout — T9 target.
