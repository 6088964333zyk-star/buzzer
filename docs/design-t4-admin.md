# Design: T4 Admin Restructure

**Owner:** Jack Mayerhofer (jmayerhofer). The host half of T4 is owned by Bill Zhang (yyzhang)
and specified in `docs/design-t4-host.md`. This doc covers only the admin app, plus one new admin
endpoint.
**Status:** Draft, pre-Goldfish.
**Branch:** `feature/t4-admin`, cut from `origin/feature/t4-host` (it depends on `games.course_id`
and the course-based access rules from that branch). **This branch merges after `feature/t4-host`.**
**Process:** Written after the T3 context docs (`frontend/admin/src/**/CLAUDE.md`, merged in !3)
and committed before any implementation code.

---

## 1. Problem

T4 (`instructions.md`) says the admin app "currently handles both admin-level tasks and tasks a
Host should own," and requires:

| Requirement | Description (quoted from `instructions.md`) |
|---|---|
| Admin-first layout | "The UI prioritizes admin-specific tasks: user account management, course creation, granting course/game access." |
| Full access retained | "Admins can still perform all host and player actions, but these are secondary in the navigation/layout." |

…and "Your changes must integrate with the existing role and permission system — no bypassing
access checks."

**Current state of the admin app** (see `frontend/admin/src/CLAUDE.md` and `pages/CLAUDE.md`):

- **Flat sidebar.** `App.tsx`'s `AdminLayout` lists Courses, Users, Games, Guests, Sessions with
  equal weight. Admin tasks and host-type tasks (games, sessions) are mixed together.
- **Access is only granted from a user's page.** `UserDetailPage` grants/revokes per-course
  HOST/PLAYER access and per-game access. There is no way to see "who has access to course C"
  without opening every user. No endpoint lists access by course.
- **Per-game access no longer does anything.** After `feature/t4-host` (design D1), host access
  to a game is course-based: a USER may run or manage game G iff `G.course_id` is non-NULL and
  they are HOST of that course. `UserGameAccess` rows are still written by
  `POST /api/admin/users/{id}/game-access` but nothing reads them for authorization.
- **Games are created without a course.** `GamesPage` creates and imports games with no
  `course_id`. After `feature/t4-host`, a course-less game can only be run or managed by ADMIN.
  `PUT /api/admin/games/{id}` may set `course_id` only while it is NULL (set-once; changing a
  non-NULL value → 409).
- **Error messages are lost.** The backend's `BuzzerError` handler
  (`backend/app/common/exceptions.py`) returns `{"error": CODE, "message": "..."}`. Request
  validation errors return `{"error": "VALIDATION_ERROR", "detail": [ {msg, ...}, ... ]}`.
  Admin `lib/api.ts` only reads a **string** `detail`, so every 404/409/422 from the backend
  shows as `HTTP 409` etc. This hides the new `feature/t4-host` errors that now also reach
  admin: answered-question delete (D5, 409), type change on an answered question (D5, 409),
  invalid merged update (D7, 422), edits during a live session (D8, 409), and roster uploads
  over 1000 rows (D4, 422). The host app's `api.ts` already parses both shapes correctly.
- **`RequireAdmin` only checks that a token exists.** A HOST or PLAYER who logs in gets the full
  admin UI, and every request fails with 403.

### Terms

- **Global role:** `User.role` ∈ ADMIN / USER / GUEST. Carried in the JWT access token as the
  `role` claim (`backend/app/services/auth_service.create_access_token`; payload keys `sub`,
  `role`, `token_type`, `iat`, `exp`).
- **Course role:** `UserCourseAccess.role` ∈ HOST / PLAYER, one row per (user, course).
- **Who can play in course C** (`game_service`, join path): an ADMIN; a GUEST (guests aren't
  course-gated); a NetID user with an **active** `CourseRoster` row for C; or a local user with
  a PLAYER or HOST `UserCourseAccess` row for C.
- **Who can host/manage a game G:** ADMIN; or a USER who is HOST of `G.course_id` (G must have a
  course).

---

## 2. Technical Plan (summary)

1. **Two-tier navigation.** The sidebar is split into **Administration** (Courses, Users,
   Guests) and a visually secondary **Course content** section (Games, Sessions, and links that
   open the host and player apps). Courses is the landing page.
2. **Course detail page as the access hub.** A new `CourseDetailPage` at `/courses/:courseId`
   shows the course's details, **who has access** (grant/change/revoke HOST and PLAYER), **game
   access** (which games belong to the course and who can use them, plus assigning course-less
   games), and the roster summary with a link to the roster page.
3. **One new endpoint:** `GET /api/admin/courses/{course_id}/access` lists the users with a
   `UserCourseAccess` row for the course.
4. **"Granting game access" is course-based and visible.** Game access = the game's course
   (set once) + that course's HOST/PLAYER grants and roster. The UI says this explicitly on the
   course page and on the user page. The per-game grant UI in `UserDetailPage` is replaced by a
   read-only, derived list.
5. **Coordination items from `docs/design-t4-host.md` §5:** course required when creating or
   importing a game; "assign course" for course-less games; backend error messages surfaced
   (fixed once in `lib/api.ts`); the 1000-row roster limit checked client-side too.
6. **`RequireAdmin` checks the role** in the JWT. Non-admins see a short "this is the admin
   console" screen with a link to the host app.
7. **`QuestionEditorPage.tsx` is not modified.** The `api.ts` fix makes its errors readable.
   This avoids conflicts with `feature/t7-map-question`, which adds `map_pin` branches to that
   file and adds `components/MapCanvas.tsx`, `components/MapPicker.tsx` and `lib/mapPin.ts`.

### Design decisions

**A1 — Two-tier sidebar; admin tasks first.**

- **Administration** (top, normal weight): Courses (`/courses`), Users (`/users`), Guests
  (`/guests`).
- **Course content** (below a divider, with a small uppercase section label and the same link
  style): Games (`/games`), Sessions (`/sessions`), then two external links:
  - "Open host app ↗" → `/host/`
  - "Open player app ↗" → `/player/`
  Both open in a new tab (`target="_blank" rel="noopener"`). They are plain `<a>` tags, not
  `NavLink`s (they leave the admin app's router).
- Landing page stays `/courses` (login redirect and the `*` route).
- **Why this satisfies "full access retained":** every existing admin page stays reachable. An
  admin can also run games through the host app: on `feature/t4-host`, `/api/game/my-courses`
  returns every course to ADMIN, and all host checks let ADMIN through. All three apps are served
  from one origin through nginx (`/admin/`, `/host/`, `/player/`) and read the same
  `localStorage.token`, so an admin logged into the admin app is already logged into the others.
  (In standalone Vite dev servers on ports 5173–5175 the origins differ and the links won't
  carry the session; use the nginx URL, `localhost:8080`.)

**A2 — `CourseDetailPage` is the access hub.**

Route `/courses/:courseId`, inside `AdminLayout`. `CoursesPage` keeps list + create; each row's
name links to the detail page. The inline edit form and the "Roster" link move from
`CoursesPage` to the detail page so there is one place to edit a course.

Sections, top to bottom:

1. **Course details.** Name and semester, editable (`PUT /api/admin/courses/{id}`, existing).
2. **People with access.** Table from the new endpoint (A3): display name / username / netid,
   global role, course role, actions.
   - **Change role:** HOST ↔ PLAYER via `POST /api/admin/users/{user_id}/course-access`
     `{course_id, role}` (existing; it upserts the role).
   - **Revoke:** `DELETE /api/admin/users/{user_id}/course-access/{course_id}` (existing), after
     `window.confirm()` (matches the other admin pages' delete pattern).
   - **Add people:** a select of users from `GET /api/admin/users` (existing), filtered to
     `role === 'USER'` and not already listed, plus a HOST/PLAYER select and an "Add" button.
     ADMINs are excluded (they already have full access); GUESTs are excluded (guests aren't
     course-gated).
   - Help text: "Hosts can run and edit this course's games, manage its roster, and download its
     session results. Players can join this course's games."
3. **Game access.** See A4.
4. **Roster.** "N active / M total roster entries" from `GET /api/admin/courses/{id}/roster`
   (existing) and a "Manage roster" link to `/courses/:courseId/roster` (existing page). Help
   text: "Students on the active roster can sign in with NetID and join this course's games."

Unknown course id → the page shows the backend's 404 message and a link back to Courses.

**A3 — New endpoint `GET /api/admin/courses/{course_id}/access`.**

- `require_admin`. 404 (`NotFoundError("Course {id} not found")`) if the course doesn't exist.
- Returns `list[CourseAccessEntry]`, one per `UserCourseAccess` row for the course, joined to
  `User`:

  | Field | Type | Source |
  |---|---|---|
  | `user_id` | `str` | `User.id` |
  | `username` | `str \| None` | `User.username` |
  | `netid` | `str \| None` | `User.netid` |
  | `display_name` | `str \| None` | `User.display_name` |
  | `user_role` | `str` | `User.role` (global) |
  | `course_role` | `str` | `UserCourseAccess.role` (HOST / PLAYER) |

- Order: HOST before PLAYER, then by `coalesce(display_name, username, netid)` ascending.
- Empty list if the course exists but has no grants.
- **Why a new endpoint:** the alternative is the client calling `GET /api/admin/users/{id}` for
  every user (N+1 requests). Grants and revokes reuse the existing per-user endpoints, so no
  write endpoints are added.

**A4 — Game access is course-based, and shown, not hidden.**

T4 lists "granting course/game access" as an admin task. After `feature/t4-host` D1, access to
a game *is* access to its course. This design reads "granting game access" as:

> **Granting access to a game = assigning the game to a course (once) + granting HOST/PLAYER on
> that course (or adding students to its roster).**

The UI makes that explicit instead of dropping the concept:

- **Course page, "Game access" section:**
  - Lists games with `course_id === courseId` (from `GET /api/admin/games`, filtered
    client-side; `GameResponse` includes `course_id`). Each links to
    `/games/:gameId/questions`.
  - States who can use them, with live counts: "These games can be run and edited by this
    course's **N hosts** and played by its **M players** and **K active roster students**."
    (N, M from A3; K from the roster.)
  - **Assign a game to this course:** a select of games with `course_id === null` and an
    "Assign" button → `PUT /api/admin/games/{id}` `{course_id}`. Before sending,
    `window.confirm("Assign '<title>' to <course>? A game's course can't be changed later.")`.
    If there are no course-less games the control is hidden.
- **User page (`UserDetailPage`), "Game access" section:** replaces the per-game grant/revoke
  UI with a **read-only** list derived from the user's course access: for each course in
  `user.course_access`, the games with that `course_id` and the role the user has there ("Can
  host" / "Can play"). Help text: "Game access comes from course access. To give this user a
  game, grant them access to the game's course." Admin users show "Admins can access every
  game."
- The backend `POST/DELETE /api/admin/users/{id}/game-access` endpoints and
  `UserWithAccessResponse.game_access` are **left in place** (no UI calls them). Removing them
  would touch more of `admin.py`, which `feature/t4-host` already edited heavily, for no
  user-visible gain.

**A5 — Fix error parsing once, in `lib/api.ts`.**

Replace the three `throw new Error((err as { detail?: string }).detail ?? ...)` sites with one
helper, matching the host app's `api.ts` on `feature/t4-host`:

- If the JSON body has a string `message` → use it.
- Else if `detail` is a string → use it.
- Else if `detail` is an array (request validation) → join each item's `msg` with `"; "`.
- Else → `` `HTTP ${status}` ``.

Every admin page already shows `err.message` in its error banner, so this alone surfaces the
D4/D5/D7/D8 messages in `QuestionEditorPage`, `RosterPage`, and `GamesPage` without editing
`QuestionEditorPage`.

**A6 — `GamesPage`: every new game gets a course.**

- **Create form:** adds a required "Course" select (from `GET /api/admin/courses`); the POST body
  includes `course_id`. The backend still allows omitting it (D1 backward compatibility); the
  admin UI no longer does.
- **List:** a "Course" column showing the course name, or a "No course" badge.
- **Assign course:** rows with no course get an inline course select + "Assign" button, same
  confirm and `PUT` as A4.
- **Edit form:** title, description, max players as today. The course is shown read-only; it is
  not sent in the update body.
- **Import JSON:** the import control gets the same required course select (choose course, then
  file). After `POST /api/admin/games/import` returns `{game_id}`, the page sends
  `PUT /api/admin/games/{game_id}` `{course_id}`. If that second call fails, the error banner
  says "Imported, but assigning the course failed: <message>" and the game appears in the list
  as "No course" with the assign control, so nothing is lost. (Adding `course_id` to the import
  endpoint itself was rejected; see §3.)

**A7 — `RequireAdmin` checks the role.**

- Add `lib/auth.ts` with `getTokenClaims(): { role: string; exp: number } | null`: split the
  token on `.`, base64url-decode the middle part, `JSON.parse`; return `null` on any failure.
  No signature check (the browser can't verify RS256 without the public key, and the server
  enforces `require_admin` anyway — this is a UX guard, not a security boundary).
- `RequireAdmin`:
  - No token, unparseable token, or `exp * 1000 <= Date.now()` → `<Navigate to="/login" />`.
  - `role !== 'ADMIN'` → render `NotAdminPage` (not inside `AdminLayout`).
  - Otherwise → `<Outlet />`.
- `NotAdminPage`: "This is the Buzzer admin console. Your account isn't an admin." A primary
  link "Go to the host app" → `/host/`, and a "Log out" button (removes `token`, navigates to
  `/login`).
- `LoginPage` is unchanged: it stores the token and goes to `/courses`; `RequireAdmin` then
  decides.

**A8 — Roster limit is checked before upload too.**

In `RosterPage`'s import step, if the mapped row count is over 1000, show "Roster has N rows;
the limit is 1000. Nothing was changed." and don't send the request. The server's 422 (now
readable via A5) remains the real check. The constant lives at the top of `RosterPage.tsx` with a
comment pointing to `roster_service.MAX_ROWS`.

---

## 3. Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| 1 | **Sidebar regrouping only** (A1 + A5–A8, no course page or endpoint). | About half a day, but "granting course/game access" would still mean opening users one at a time. The restructure would be cosmetic. |
| 2 | **Hide game access entirely** (delete the per-game UI, say nothing). | Matches the backend model, but the spec names game access as an admin task; a reader checking for it would find nothing. A4 keeps the concept visible and explains it. |
| 3 | **Keep per-game grants meaningful** (let `UserGameAccess` grant host access again). | Contradicts `feature/t4-host` D1 ("a game is only accessible to hosts and players of that course") and reintroduces two access paths to audit. |
| 4 | **Remove admin's Games/Questions/Sessions pages and send admins to the host app.** | Course-less legacy games aren't reachable from host pages (they're scoped by course), game delete and JSON import/export are admin-only, and it would conflict with T7's admin editor changes. Linking out (A1) gives the "host actions" path without removing anything. |
| 5 | **Add `course_id` to `POST /admin/games/import`.** | Cleaner single request, but it changes a multipart endpoint `feature/t4-host` didn't touch and needs its own validation/tests. Import-then-assign (A6) reuses the existing set-once `PUT` and fails safe. Revisit if import is used heavily. |
| 6 | **Build the access list from per-user GETs** instead of A3. | N+1 requests on every course page load. |
| 7 | **Delete the game-access endpoints.** | Extra churn in `admin.py` right after `feature/t4-host`'s refactor; nothing calls them after this change. Note as cleanup. |
| 8 | **Shared frontend package for `api.ts`/auth helpers.** | Same reason as `design-t4-host.md` D6: the three apps are separate Vite builds; out of scope for T4. A5 copies the host app's logic. |

---

## 4. Detailed implementation

Implement in this order; each step leaves the app working.

### Step 1 — Backend: course access endpoint (A3)

- `backend/app/schemas/admin.py`: add `CourseAccessEntry(BaseModel)` with the six fields in A3
  (`model_config = ConfigDict(from_attributes=True)` not needed; the route returns dicts).
- `backend/app/routers/admin.py`, in the Courses section after `update_course`:
  `@router.get("/courses/{course_id}/access", response_model=list[CourseAccessEntry])`.
  `db.get(Course, course_id)` → `NotFoundError` if missing. Then
  `select(UserCourseAccess, User).join(User, User.id == UserCourseAccess.user_id).where(UserCourseAccess.course_id == course_id)`,
  build dicts, sort in Python by `(0 if course_role == "HOST" else 1, (display_name or username or netid or "").lower())`.
- `backend/app/routers/CLAUDE.md`, `backend/app/schemas/CLAUDE.md`: one line each for the new
  route/schema (per `.claude/rules/context-sync.md`). These are partner-owned docs; keep the edit
  to the added line.

### Step 2 — `lib/api.ts` error parsing (A5)

- `frontend/admin/src/lib/api.ts`: add `async function toError(res: Response): Promise<Error>`
  implementing A5; use it at all three throw sites (`request`, `postForm`, `download`).

### Step 3 — Auth guard (A7)

- New `frontend/admin/src/lib/auth.ts`: `getTokenClaims()`.
- New `frontend/admin/src/pages/NotAdminPage.tsx`.
- `frontend/admin/src/App.tsx`: `RequireAdmin` uses `getTokenClaims()` per A7.

### Step 4 — Sidebar (A1)

- `frontend/admin/src/App.tsx` `AdminLayout`: two groups as in A1. Keep `linkClass`. The
  section label is a small `text-xs uppercase tracking-wide text-slate-500 px-4 pt-4 pb-1`
  heading; the Course content links use the same `linkClass`. Icons: keep the existing lucide
  icons; use `ExternalLink` for the two app links.

### Step 5 — Course detail page (A2, A4)

- New `frontend/admin/src/pages/CourseDetailPage.tsx`. On load, in parallel:
  `GET /admin/courses/{id}`, `GET /admin/courses/{id}/access`, `GET /admin/users`,
  `GET /admin/games`, `GET /admin/courses/{id}/roster`. Each mutation (edit details, add/change/
  revoke access, assign game) re-fetches the affected data and shows errors in one page-level
  banner, like the other pages.
- `frontend/admin/src/App.tsx`: route `/courses/:courseId` → `CourseDetailPage`.
- `frontend/admin/src/pages/CoursesPage.tsx`: course name links to `/courses/:id`; remove the
  inline edit form and the roster link (both now on the detail page). Create stays.

### Step 6 — User page game access (A4)

- `frontend/admin/src/pages/UserDetailPage.tsx`: remove the game grant panel, its state, and the
  `grantGameAccess` / `revokeGameAccess` handlers. Replace with the read-only derived list from
  A4 (it already loads `/admin/games` and `/admin/courses`; filter games by the user's
  `course_access` course ids). The course access section is unchanged.

### Step 7 — Games page (A6)

- `frontend/admin/src/pages/GamesPage.tsx`: add a courses fetch; the `Game` interface gains
  `course_id: number | null`; required course select on create and import; Course column;
  inline assign for course-less rows; import-then-assign flow and its partial-failure message.

### Step 8 — Roster limit (A8)

- `frontend/admin/src/pages/RosterPage.tsx`: `const MAX_ROSTER_ROWS = 1000;` and the pre-check in
  the import handler, before `api.post`.

### Step 9 — Context docs

Update `frontend/admin/src/CLAUDE.md` and `frontend/admin/src/pages/CLAUDE.md` (sidebar
structure, new pages, game access model, `RequireAdmin` now checks role) and
`frontend/admin/src/lib/CLAUDE.md` (`auth.ts`, error parsing). Remove the gotchas this design
resolves.

### Files touched

| File | Change |
|---|---|
| `backend/app/routers/admin.py` | + `GET /courses/{id}/access` |
| `backend/app/schemas/admin.py` | + `CourseAccessEntry` |
| `backend/app/routers/CLAUDE.md`, `backend/app/schemas/CLAUDE.md` | one line each |
| `frontend/admin/src/App.tsx` | sidebar, `RequireAdmin`, new route |
| `frontend/admin/src/lib/api.ts` | error parsing |
| `frontend/admin/src/lib/auth.ts` | **new** |
| `frontend/admin/src/pages/CourseDetailPage.tsx` | **new** |
| `frontend/admin/src/pages/NotAdminPage.tsx` | **new** |
| `frontend/admin/src/pages/CoursesPage.tsx` | link to detail; edit/roster link moved out |
| `frontend/admin/src/pages/UserDetailPage.tsx` | game access becomes read-only, derived |
| `frontend/admin/src/pages/GamesPage.tsx` | course on create/import, column, assign |
| `frontend/admin/src/pages/RosterPage.tsx` | 1000-row pre-check |
| `frontend/admin/src/**/CLAUDE.md` | context sync |
| `tests/integration/test_admin_access.py` | **new** (§5) |

**Not touched:** `QuestionEditorPage.tsx`, `frontend/admin/src/components/**`, any host or player
file, `game_service`, the game-access endpoints.

---

## 5. Verification

### Integration tests — `tests/integration/test_admin_access.py`

Use the existing fixtures in `tests/integration/conftest.py` (`docker_stack`, `base_url`,
`admin_token`) and create users/courses through the admin API, as `test_host_api.py` does.

1. **Lists grants.** Create a course and two local USERs; grant one HOST and one PLAYER →
   `GET /api/admin/courses/{id}/access` returns both with the right `course_role`,
   `user_role == "USER"`, HOST first.
2. **Reflects changes.** Change the PLAYER to HOST (POST course-access) → listed as HOST.
   Revoke one → no longer listed.
3. **Empty and missing.** A new course with no grants → `[]`. A nonexistent course id → 404 with
   a `message`.
4. **Admin only.** A HOST of the course calling the endpoint → 403. No token → 401.
5. **Course assignment is set-once through admin** (A4/A6 rely on it): already covered by
   `test_host_api.py::test_admin_can_assign_course_once` (NULL → course A → 200; → course B →
   409). Not duplicated.

### Frontend checks

- `npx tsc --noEmit` and `npm run build` in `frontend/admin`.
- Manual, through `localhost:8080/admin/` after `docker compose up` + `scripts/seed_demo.py`:
  1. Log in as admin → lands on Courses; sidebar shows the two groups.
  2. Open a course → grant a user HOST, change to PLAYER, revoke. Counts in "Game access"
     update.
  3. Assign a course-less game from the course page; confirm it can't be reassigned from
     GamesPage (no assign control once set).
  4. Create a game without choosing a course → blocked by the form. Import a game JSON with a
     course → listed with that course.
  5. In the question editor, delete a question that has been answered → the banner shows the
     409 text, not "HTTP 409".
  6. Upload a 1001-row roster CSV → client-side error, no request sent.
  7. Log in as a non-admin USER → "not an admin" screen with a working host-app link.
  8. "Open host app ↗" opens `/host/` already logged in as the admin.

---

## 6. Known limits and risks

- **Game access is an interpretation.** If a grader expects a per-game grant control, A4's
  explanation is the answer; it's quoted against the spec in §1 and §2-A4.
- **Two question editors** (admin and host) will drift. Accepted in `design-t4-host.md` D6; T7
  types must be added to both.
- **Client-side role check is decoded, not verified.** Editing the token in devtools shows the
  admin UI, but every request still fails `require_admin`. This is a UX guard only.
- **Import-then-assign isn't atomic.** A failed second call leaves a course-less game, which is
  visible and fixable from the same page.
- **Merge order.** This branch includes `feature/t4-host`. It must merge after it; if
  `feature/t4-host` changes before merging, rebase this branch onto it. `feature/t7-map-question`
  touches `QuestionEditorPage.tsx` and new admin files only; this design doesn't edit those.
- **Dev servers.** The host/player links assume the nginx origin (`localhost:8080`).
