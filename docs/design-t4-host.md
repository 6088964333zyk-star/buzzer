# Design: T4 Host Capabilities

**Owner:** Bill Zhang (yyzhang). The admin restructure half of T4 is owned by Jack Mayerhofer
and is out of scope here, except where noted under *Coordination*.
**Status:** Draft, before Goldfish test.
**Process:** Written after the backend and frontend context docs (`backend/app/**/CLAUDE.md`,
`frontend/*/src/**/CLAUDE.md`). Committed before any implementation code. To be revised after
a Goldfish test.

---

## 1. Problem

T4 (see `instructions.md`) requires the **host** app to let a host:

1. download an HTML summary of a completed session's questions and results;
2. download a CSV of per-player scores for a completed session;
3. view and update the roster of any course where they have HOST access (add/deactivate via
   CSV upload);
4. create games and add, edit, delete and reorder questions and their scoring;
5. have games attached to a specific course at creation time. A game is only accessible to
   hosts and players of that course.

All of it must integrate with the existing role/permission system, with no bypassed access
checks.

**Current state:**

- **Admin-only APIs.** Items 1, 3 and 4 exist only as admin APIs in
  `backend/app/routers/admin.py`. Every one of those routes is `require_admin`.
- **Host CSV download.** Item 2 exists as `GET /api/game/sessions/{id}/export`
  (`routers/game.py`), restricted to the user who created the session.
- **Games have no course.** `Game` (`backend/app/models/game.py`) has no `course_id`. A course
  is only chosen per session (`GameSession.course_id`). Host access to games is granted per
  user through `UserGameAccess`.
- **Host frontend.** It has only Login, Home and the live-game screens.
  `frontend/host/src/lib/api.ts` supports `get`/`post`/`delete` only, always sends a JSON
  Content-Type, and has no file download helper.

**Roles, for readers new to the codebase.** There are two separate role systems.

- **Global role.** `User.role` is ADMIN / USER / GUEST.
- **Per-course role.** `UserCourseAccess.role` is HOST / PLAYER.
- **"Host of course C"** means there is a `UserCourseAccess(user, C, HOST)` row.
- **The reusable check** for this is `services/game_service.assert_host_can_use_course(db,
  user, course_id)`. ADMIN passes (404 if the course is missing). Anyone else needs the HOST
  row, otherwise `ForbiddenError` (403).

---

## 2. Technical Plan (summary)

- **Data:** add a nullable `games.course_id` foreign key (migration `004`). NULL means a legacy
  game with no course. Every newly created game gets a course.
- **API:** a new router `backend/app/routers/host.py` mounted at `/api/host`. Every route
  authorizes by course using `assert_host_can_use_course`, plus a new
  `assert_host_can_manage_game`. `/api/admin/*` keeps its URLs and responses.
- **Shared question logic:** a new `backend/app/services/question_service.py` holds create,
  update, delete and reorder. Both the admin and host routers call it. It fixes two existing
  bugs once, for both:
  - update now runs the same structural validation as create;
  - deleting an answered question returns 409 instead of failing.
- **Frontend:** new host pages for a course hub, the games list, the question editor (copied
  from admin), the roster (CSV upload with a preview), and sessions (CSV/HTML downloads).
  `api.ts` gains `put`, `patch`, `postForm` and `download`.

### Design decisions

**D1 — Games belong to a course; the column is nullable for legacy rows.**

- **Column.** `games.course_id` is a nullable FK to `courses.id` with no cascade (the default
  restrict). NULL is allowed only so that existing games survive the migration.
- **Creation.** Games created through the host API must carry a course the caller hosts. Games
  created through the admin API *should* carry one; it's optional there for backward
  compatibility (see *Coordination*).
- **Room creation rule** (in `game_service.create_room`):
  - **The game has a course:** `body.course_id` must equal `game.course_id`. This applies to
    ADMIN too. Otherwise 403: *"This game belongs to a different course."*
  - **The game has no course (NULL):** only ADMIN may start it, in any course. This is today's
    behavior, and it keeps `tests/integration/conftest.py` working, since it creates
    course-less games as admin. A non-admin gets 403: *"This game is not assigned to a
    course."*
- **Host access to games is course-based.** A USER may run or manage game G iff
  `G.course_id` is non-NULL and they are HOST of that course. `UserGameAccess` no longer grants
  host access.
- **No re-assignment.** A game's course is never changed by the host API, and is never
  changed implicitly (for example by starting it in another course). Copying a game to another
  course is future work.

**D2 — A separate `/api/host/*` router, with logic in services.**

- **Why not loosen the admin routes?** Admin routes stay `require_admin`, so "admin-only" stays
  obvious, and the admin half of T4 isn't destabilized.
- **No duplicated logic.** Host routes are thin: authorize, then call the same services the
  admin routes use.

**D3 — Session results are visible to any HOST of the session's course.**

- **Who:** ADMIN or any HOST of `session.course_id` may list sessions, download the CSV, and
  download the HTML summary.
- **Deleting** a session keeps today's rule: the session's creator or ADMIN
  (`routers/game.py`).
- **Trade-off:** this widens today's creator-only rule for viewing. It's acceptable because
  courses have no sub-groups.

**D4 — Roster CSV upload is a full replace, with a client-side preview.**

- **Semantics.** Uploading upserts the listed rows and **deactivates** active entries whose
  netid is absent. This is `services/roster_service.process_roster_rows`, unchanged, and it
  matches T4's "add/deactivate entries via CSV upload".
- **Preview.** Before submitting, the host UI shows *"N new · M updated · K will be
  deactivated"* and requires confirmation, because a partial file would otherwise silently
  deactivate the rest of the class. The preview is computed in the browser by diffing the
  parsed CSV against `GET` roster, so no preview endpoint is needed.
- **Row limit.** Uploads with more than 1000 rows (`MAX_ROWS`) are **rejected** (422) with no
  changes. Today the extra rows are skipped and then deactivated.
- **Single entry.** A single entry can be toggled active/inactive.

**D5 — Answered questions cannot be deleted; hosts cannot delete games.**

- **Answered questions.** If any `SessionScore` references the question → 409: *"This question
  has been answered in N session(s); deleting it would change past results."* Unanswered
  questions delete normally.
  - Today the delete fails inside `get_db`'s commit, because `session_scores.question_id` is a
    NOT NULL FK with no cascade. The client sees a 500 or a misleading 204.
  - Archiving is future work.
- **Games.** No host endpoint deletes games. Admin `delete_game` cascades sessions and scores;
  that power stays admin-only. T4 doesn't ask hosts to delete games.

**D6 — The host question editor is a copy of admin's.**

- **Why a copy.** The three frontends are separate Vite builds and can't import each other.
  The admin `QuestionEditorPage.tsx` and the CSV parsing in `RosterPage.tsx` are copied into
  the host app and pointed at `/api/host`.
- **Two admin bugs are fixed in the host copy:**
  - (a) `formToPayload`'s final `else` silently treats an unknown type as fill-in-the-blank.
    Make it throw.
  - (b) For multi_select and fill-in-the-blank, `points_value` is computed from all rows
    while blank rows are dropped from the payload. Compute it from the filtered rows.
- **Accepted debt:** T7's new types must be added to both editors.

**D7 — Question update runs the create-time validation (merge-then-validate).**

- **How.** In `question_service.update`:
  1. Build the would-be question by overlaying the non-null `QuestionUpdate` fields onto the
     stored question.
  2. Validate the result with `QuestionCreate` (which runs `validate_structure`).
  3. On failure → 422 and **nothing is changed**.
- **Effect.** Create and update share one rule set, so T7 adds validation in one place.
- **Admin.** Admin inherits the fix. No existing test calls question PUT.

**D8 — No question edits while the game has a session IN_PROGRESS.**

- **Why.** `start_game` snapshots the ordered question ids into Redis. Deleting or editing a
  question mid-game can leave the gateway pointing at a missing or changed question.
- **Rule.** Create, update, delete and reorder → 409 *"This game has a session in progress"*
  while any `GameSession` for the game has status IN_PROGRESS.
- **LOBBY is deliberately allowed.** The question list is read only when the game starts.
  Lobbies that are never started are not cleaned up today, so blocking on LOBBY could freeze a
  game indefinitely.
- **Scope.** This applies to both the admin and host routes, via `question_service`.

---

## 3. Alternatives considered

| Decision | Alternative | Why rejected |
|---|---|---|
| D1 | `course_id` NOT NULL, backfilled into one course | The migration must invent an owner, and it fails with zero courses. Existing tests create games without a course and would break; changing them reads as weakening tests. |
| D1 | Starting a game in another course re-assigns it | Silently removes the game from its original course's hosts. That's an access-control bypass. |
| D2 | Relax admin routes to "ADMIN or HOST of course" | Every admin route would need its own course check; one omission is a hole. It also collides with Jack's admin restructure. |
| D3 | Keep creator-only access to results | A co-host or TA could never download a session they didn't run, which is inconsistent with course-scoped games and rosters. |
| D4 | Add-only upload; deactivate one entry at a time | T4 says deactivation happens *via CSV upload*. |
| D4 | Upload mode toggle (replace / add) | More UI, more logic and more tests, for little gain over a preview. |
| D5 | Delete the question's scores too | Silently changes past grades and exports, which may already be in Canvas. |
| D5 | Soft-delete / archive flag | Most correct, but needs a migration and changes to `start_game`, exports, reports and the editor. Deferred. |
| D6 | Shared `frontend/shared/` pure-logic module | Halves T7 edits, but needs Vite/tsc verification outside app roots and touches Jack's admin code mid-restructure. Revisit at T7. |
| D6 | Shared npm workspace package | Build-system change; too risky this close to the deadline. |
| D7 | Defer validation to T7 | The new host editor would ship with the known hole. |
| D8 | Also block edits while a session is in LOBBY | Abandoned lobbies are never cleaned up, so a game could stay locked forever. Edits made before start are read correctly anyway. |

---

## 4. Detailed implementation

Implement in this order. Each step is a separately testable commit (or a small group).

### Step 1 — Model and migration
- `backend/app/models/game.py`: add
  `course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id"), nullable=True, index=True)`,
  plus `course` relationship. Add `Course.games` back-population in `models/course.py`.
- `backend/app/migrations/versions/004_game_course_id.py`: `revision = "004"`,
  `down_revision = "003"`. Add the nullable column, FK and index. The downgrade drops them.
  Existing rows stay NULL.
- `backend/app/schemas/admin.py`:
  - `GameCreate` and `GameUpdate` get an optional `course_id: int | None`.
  - `GameResponse` gets `course_id: int | None`.
  - The admin create route validates the course exists, if one is given.

### Step 2 — Access helpers and room rule (`backend/app/services/game_service.py`)
- `assert_host_can_manage_game(db, user, game_id) -> Game`:
  1. Load the game, or 404.
  2. ADMIN → return it.
  3. `course_id` is NULL → 403 "not assigned to a course".
  4. Otherwise `assert_host_can_use_course(db, user, game.course_id)`, then return it.
- `assert_host_can_use_game` (used by `create_room`):
  - **Non-ADMIN:** call `assert_host_can_manage_game`. Don't fall back to `UserGameAccess`.
  - **ADMIN:** unchanged.
- `create_room`: after both access checks, apply the D1 room rule.
- New `assert_host_can_view_session(db, user, session_id) -> GameSession`: load the session
  (404 if missing), then `assert_host_can_use_course(db, user, session.course_id)`.

### Step 3 — Shared question service (`backend/app/services/question_service.py`, new)

All functions take `(db, game, …)` with the game already authorized by the caller, and raise
`BuzzerError` subclasses.

- `create(db, game, body: QuestionCreate) -> Question`:
  - Move the logic from admin `create_question` here: bleach the prompt with
    `_PROMPT_TAGS = b,i,br,u`, and auto-assign `order_index`.
  - D8 check.
- `update(db, game, question_id, body: QuestionUpdate) -> Question`:
  1. Load the question within the game, or 404.
  2. D8 check.
  3. Merge-then-validate (D7): build a dict of the stored fields, overlay `body`'s non-None
     fields, and call `QuestionCreate(**merged)`. Convert a validation failure into a 422
     carrying the validator message; `common/exceptions.py` already formats
     `RequestValidationError`. Raising a `BuzzerError` with status 422 and code
     `VALIDATION_ERROR` is acceptable.
  4. Apply the fields, re-bleaching the prompt.
- `delete(db, game, question_id) -> None`:
  1. Load the question, or 404.
  2. D8 check.
  3. Count `SessionScore` rows with this `question_id` (distinct sessions for the message).
     If greater than 0 → `ConflictError` (409).
  4. Otherwise delete.
- `reorder(db, game, order: list[int]) -> None`: move the logic from admin
  `reorder_questions` (the ids must match exactly, else 409), plus the D8 check.
- `_assert_no_live_session(db, game_id)`: 409 if any `GameSession` for the game has status
  IN_PROGRESS. LOBBY sessions don't block edits (see D8).
- `backend/app/routers/admin.py`: the question create/update/delete/reorder handlers keep their
  URLs, `require_admin` and response models, and delegate to `question_service`.

### Step 4 — Roster limit (`backend/app/services/roster_service.py`)
- `process_roster_rows` and `process_roster_csv` check the row count before writing anything.
  More than `MAX_ROWS` → a 422-style error result (or raise) with **no** writes or
  deactivations.

### Step 5 — Host router (`backend/app/routers/host.py`, new; mounted in `main.py` with `prefix="/api"`, router prefix `/host`)

Every route depends on `require_user`, so GUEST gets 403, and then authorizes as below.

| Method | Path | Authorize | Behavior |
|---|---|---|---|
| GET | `/host/courses/{cid}/games` | `assert_host_can_use_course(cid)` | Games where `course_id == cid` |
| POST | `/host/courses/{cid}/games` | same | Create a game with `course_id = cid` (body: title, description, max_players) → 201 |
| PUT | `/host/games/{gid}` | `assert_host_can_manage_game` | Update title/description/max_players. **`course_id` is not accepted** (`extra="forbid"`) |
| GET | `/host/games/{gid}/questions` | same | List ordered by `order_index`; `QuestionResponse` (hosts may see answers) |
| POST | `/host/games/{gid}/questions` | same | `question_service.create` → 201 |
| PUT | `/host/games/{gid}/questions/{qid}` | same | `question_service.update` |
| DELETE | `/host/games/{gid}/questions/{qid}` | same | `question_service.delete` → 204 / 409 |
| POST | `/host/games/{gid}/questions/reorder` | same | `question_service.reorder` → 204 |
| GET | `/host/courses/{cid}/roster` | `assert_host_can_use_course(cid)` | Roster entries for the course |
| POST | `/host/courses/{cid}/roster/import` | same | Body `RosterImportPayload` → `process_roster_rows` → `RosterUploadResult` |
| PATCH | `/host/courses/{cid}/roster/{rid}` | same | Body `{is_active: bool}` only, for the entry within the course (404 otherwise) |
| GET | `/host/courses/{cid}/sessions` | same | Sessions of the course, newest first: id, room_code, status, game title, created/completed, player count |
| GET | `/host/sessions/{sid}/export` | `assert_host_can_view_session` | `export_service.build_session_csv` as a CSV attachment |
| GET | `/host/sessions/{sid}/report` | same | `report_service.build_session_report` as an HTML attachment |

Also:
- `routers/game.py` `my-games`: for USER, return games whose `course_id` is a course where
  they are HOST. ADMIN is unchanged (all games).
- `routers/game.py` `sessions/{id}/export`: switch to `assert_host_can_view_session` (D3), so
  the old endpoint and the new one agree.
- `scripts/seed_demo.py`: include `course_id` of Demo Course when creating the demo game.

### Step 6 — Host frontend (`frontend/host/src/`)
- `lib/api.ts`:
  - `put` and `patch` (JSON).
  - `postForm(path, FormData)`, which doesn't set Content-Type.
  - `download(path, fallbackName)`: fetch with the Bearer header → `blob()` → trigger a save
    with the filename from `Content-Disposition`.
- New pages under `pages/manage/`, routed in `App.tsx` inside `RequireAuth`:
  - `/manage/:courseId` — course hub with tabs or links: Games, Roster, Sessions.
  - `/manage/:courseId/games` — list and create games.
  - `/manage/:courseId/games/:gameId` — question editor. Copied from admin
    `QuestionEditorPage.tsx`, endpoints switched to `/host/...`, with the D6 bug fixes. A 409
    is shown as an inline message.
  - `/manage/:courseId/roster` — table with an active toggle; CSV upload. Parse in the
    browser using the copied admin parser; diff against the current roster; preview
    "N new · M updated · K deactivated"; confirm → `POST …/roster/import`.
  - `/manage/:courseId/sessions` — table, plus "Download CSV" and "Download summary" buttons
    (`api.download`).
- `pages/HomePage.tsx`:
  - a "Manage" link per hosted course;
  - the game picker shows only games where `course_id` equals the selected course
    (`MyGameItem` gains `course_id`).
- Update `pages/CLAUDE.md`, `lib/CLAUDE.md` and `src/CLAUDE.md` (context-sync rule).

### Step 7 — Integration tests (`tests/integration/test_host_api.py`, new)

Use the existing conftest helpers and add fixtures for:
- a second course;
- a non-admin user who is HOST of course A only (via
  `POST /api/admin/users/{id}/course-access`);
- a PLAYER user.

Tests assert behavior, not just status codes:

1. **Access matrix.**
   - HOST(A) gets 200 on A's games, roster and sessions.
   - HOST(A) gets 403 on course B's routes, on a NULL-course game, and on B's sessions.
   - PLAYER and GUEST get 403 on every `/api/host` route.
   - ADMIN gets 200.
2. **Course-specific games.**
   - A game created by HOST(A) has `course_id = A`.
   - Creating a room with it in course B → 403.
   - A non-admin creating a room with a NULL-course game → 403.
   - Admin with a NULL-course game in any course → 201 (existing flow intact).
3. **D7.** A PUT that leaves `answer_points` length ≠ options length → 422, and a follow-up GET
   shows the question unchanged.
4. **D5.**
   - Delete an unanswered question → 204, then GET shows it gone.
   - Play a session where the question is answered, then delete it → 409, and the
     `SessionScore` rows are still present (CSV export still shows them).
5. **D8.**
   - With a session IN_PROGRESS (started via the socket flow), question
     create/update/delete/reorder → 409.
   - With a session only in LOBBY, the same edits succeed.
6. **Roster.**
   - Upload rows {a,b} → imported 2.
   - Upload {b,c} → imported 1, updated 1, deactivated 1, and `a` is inactive.
   - 1001 rows → rejected, and the roster is unchanged.
7. **D3.**
   - A second HOST of course A (not the session creator) can download the CSV and HTML.
   - The CSV totals equal the sum of the session's scores.
   - That host's `DELETE /api/game/sessions/{id}` → 403.

Existing tests are not modified.

---

## 5. Coordination (Jack — admin restructure)
- **Create game.** Admin GamesPage should require choosing a course. Course-less games need
  an "assign course" action, using `PUT /api/admin/games/{id}` with `course_id`.
- **Game access.** `UserGameAccess` grants no host access any more. The admin "game access"
  UI is moot for hosts; Jack decides whether to hide it.
- **Question routes.** Admin question routes are refactored internally to `question_service`.
  The API is unchanged, but the D5, D7 and D8 409/422 responses now also appear in admin.

## 6. Out of scope / future work
- Copying a game to another course.
- Archiving answered questions.
- Host game deletion.
- Host game JSON import/export.
- The existing `report_service` multi_select rendering gap.
- Host `merge-guest` over-breadth, the `oauth2-callback` header trust, and `rejoin_room`
  admin→host promotion. These are pre-existing issues documented in the backend `CLAUDE.md`
  files, and each gets its own MR.

## 7. Verification
- `docker compose up -d`, then `docker compose run --rm backend alembic upgrade head`. 004
  applies, and existing games stay NULL.
- `python -m pytest tests/integration/ -q`, plus `--fast`: all old and new tests pass.
- CI parity: `ruff check backend/ scripts/`, `ruff format --check backend/ scripts/`, and
  `npx tsc --noEmit` in `frontend/host`, `frontend/player` and `frontend/admin`.
- Manual walkthrough:
  1. As a non-admin HOST of Demo Course, create a game with one question of each type.
  2. Upload a roster and confirm the deactivation preview appears.
  3. Run a round with `scripts/simulate_players.py --keep`.
  4. Download the CSV and the summary from the host Sessions page.
  5. Confirm that a second course's games, roster and sessions are not visible.
