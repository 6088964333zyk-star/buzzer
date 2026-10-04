# frontend/host/src/pages/manage/

## Purpose
T4 course management for hosts: one course at a time, its games and questions, its roster, and
its finished sessions with downloads. Design: `docs/design-t4-host.md`.

## Contents
- `ManageNav.tsx` — Header for every page here: course name (from `/game/my-courses`), a back
  link to `/home`, and Games / Roster / Sessions tabs.
- `GamesPage.tsx` — Lists `GET /host/courses/:id/games`; "Create game" posts a title to the same
  path, so a new game always belongs to this course, then opens the editor.
- `QuestionEditorPage.tsx` — Add, edit, delete and reorder questions via
  `/host/games/:gameId/questions[...]`. Copied from the admin editor; differences are listed in
  its header comment (no JSON export; an unknown type throws instead of saving as
  fill-in-the-blank; `points_value` ignores blank rows).
- `RosterPage.tsx` — Upload a roster CSV: it is parsed in the browser, a preview shows who is
  added, updated and **deactivated**, and only "Confirm upload" posts the rows as JSON to
  `/host/courses/:id/roster/import`. Each row can be toggled active/inactive with `PATCH`.
- `rosterCsv.ts` — `parseCSV` (copied from admin), `toRosterRows` (auto-detects a Canvas
  gradebook export or a basic `netid,name,email` file), `previewUpload`, `MAX_ROWS`.
- `SessionsPage.tsx` — Lists `GET /host/courses/:id/sessions`; completed sessions get "Scores
  CSV" and "Summary" (HTML) buttons, which call `api.download` on `/host/sessions/:id/{export,report}`.

## How it fits in
Routed in `../../App.tsx` under `/manage/:courseId/*`, reached from `HomePage`'s "Manage this
course" button. Every call goes to `backend/app/routers/host.py`, which checks HOST access to
the course (or the game's course) on each route; ADMIN passes everywhere.

## Gotchas
- **The server is the access check.** These pages don't check roles; a user without HOST access
  sees the server's 403 message.
- **Expect 409 and 422 from the question routes.** Deleting or changing the type of a question
  that already has answers → 409; any edit while the game has a live room → 409; an update that
  makes the question invalid → 422. The editor shows the server's `message`.
- **Roster upload deactivates.** Anyone active but missing from the file is deactivated, which
  is why the preview step exists. Files over `MAX_ROWS` (1000, mirrors the backend) are rejected
  in the browser and again with a 422 on the server.
- A game's course is fixed: there is no "move game" UI, and the backend refuses to change it.
- A new question type must be added to `QuestionEditorPage.tsx` here **and** in
  `frontend/admin/src/pages/QuestionEditorPage.tsx`.
