# Jack Mayerhofer (jmayerhofer): Individual Document

Team: Jack Mayerhofer (jmayerhofer) and Bill Zhang (yyzhang).

**What I owned:**
- **T3:** the frontend context hierarchy.
- **T4:** the admin half of the restructure (`docs/design-t4-admin.md`).
- **T7:** the classroom question type, `numeric` (`docs/design-t7-numeric.md`).
- **T6:** my two sample games.
- **T9:** theming (`docs/design-t9-theming.md`).

**What Bill owned:**
- the backend context docs;
- the host half of T4;
- the `map_pin` canvas question type;
- T8 (images).

<!--
DRAFTING NOTE (delete before merging): Claude drafted the factual parts of this document
from the repository, the design docs and the ai_log files. Every block marked ✍️ is a
judgment only I can make. Rewrite those in my own words, and read the rest to make sure it
says what I actually think. R10 grades "genuine understanding … in the author's own words"
and an "honest" AI account.
-->

---

## 1. Repository and Codebase Organization

Buzzer has three parts: a Python backend, three separate React frontends, and the
infrastructure that ties them together.

| Directory | What lives there |
|---|---|
| `backend/app/` | FastAPI + python-socketio. `routers/` (REST), `services/` (business logic, scoring), `websocket/` (the live game), `models/` (SQLAlchemy), `schemas/` (Pydantic), `common/` (errors, rate limits), `migrations/` (Alembic). |
| `frontend/host/` | The big-screen app: course and game management (T4), and the live lobby, question, results and game-over screens. |
| `frontend/player/` | The phone app: join, answer, see feedback and results. |
| `frontend/admin/` | Admin console: users, courses, access, plus secondary host-type tools. |
| `nginx/`, `docker-compose.yml` | nginx serves the three built apps at `/host/`, `/player/`, `/admin/` and proxies `/api` and `/socket.io` to the backend. MySQL and Redis run as their own containers. |
| `scripts/`, `tests/`, `sample_games/`, `docs/` | Seed and simulator scripts, unit and integration tests, game JSON, design docs. |

**The three frontends share no code.** They are separate Vite builds. So anything common is
copied, and the copies are kept identical by hand (or, for T9's theme files, by a script):
- the `ui/` primitives;
- `MapCanvas`, `numeric.ts`, `images.ts`;
- `theme.css`.

That was the first thing that surprised me about the codebase. Any fix to a shared component is
really three fixes.

**Where the data lives:**
- **MySQL:** durable data, written by the backend: users, courses, access grants, games,
  questions, sessions, scores.
- **Redis:** live game state for a running room: the current question, its phase (`QUESTION` /
  `RESULTS`), whether it's locked, who has answered, and the answer distribution. The Socket.IO
  gateway is stateless between events; everything it needs comes from Redis through
  `services/state_service.py`.

**Who can do what** is decided on the server:
- **Global role:** `User.role` is ADMIN / USER / GUEST, carried in the JWT.
- **Course roles:** HOST / PLAYER grants per course, plus the course roster.
- **The frontends only hide things.** The real checks are `require_admin` and
  `game_service.authorise_player`, and that every `/api/host/*` route checks HOST access to the
  course.

### A game round, end to end

1. **The host starts the question.** The host app's `GameLayout` owns the socket and emits
   `host_advance`. The gateway's state machine in `websocket/gateway.py` reads the room's phase
   from Redis and moves to `QUESTION`. It broadcasts `new_question` to the whole room
   (`{code}`) and starts a server-side timer task. The payload includes the question's `config`
   but **never** `answer_data`, so the answer key never reaches a browser. That's why my numeric
   type keeps the answer and tolerances in `answer_data` and only the optional unit in `config`.
2. **The player answers.** The player's `QuestionPage` renders by `type` and emits
   `submit_answer` with a type-specific payload (`{selectedIndex}`, `{point}`, `{value}`, …).
3. **The gateway validates before it scores.** It checks that:
   - the sender is a PLAYER in the room;
   - the phase is `QUESTION` and the question isn't locked;
   - the question id matches the current question;
   - the player hasn't already answered;
   - the payload has the right shape for its type. For numeric that's
     `numeric.is_finite_number`, and it runs *before* recording, so a malformed payload doesn't
     use up the player's one answer.

   Then `game_service.record_answer` → `calculate_score` scores it. For numeric the score is a
   linear falloff between `fullTolerance` and `zeroTolerance`. The answer goes to MySQL and the
   distribution to Redis.
4. **Live feedback.** The player gets `answer_received` with `isCorrect`, the points and the
   total. The host room gets `answer_status`, which updates the "N / M answered" count. When
   everyone has answered, or the timer runs out, the host gets `answer_phase_ended`, and the
   question auto-locks.
5. **Results.** The host advances again, and the phase becomes `RESULTS`. `question_results` goes
   to the host room and to each player's personal `user:{id}` room. So it's personalised: each
   player sees their own score and rank, plus the reveal from `_answer_reveal`. For numeric
   that's the answer and the five-bucket "way under → spot on → way over" distribution, which
   `NumericBuckets` draws on the host screen.
6. **Game over.** After the last question, the phase becomes `COMPLETED`, and `game_over` sends
   the final leaderboard and the per-question breakdown.

### The context files I wrote

For T3, I wrote the **frontend** half of the context hierarchy as nested `CLAUDE.md` files
(commit `8c24256`, merged in !3). Bill wrote the backend ones. There are 16 files:
- for each app: `src/`, `components/`, `lib/` and `pages/`;
- `pages/game/` in host and player;
- `types/` in host and player.

I followed the bottom-up order: leaf directories first, then `src/` as a roll-up. Bill's review
on !3 caught three mistakes, which I fixed in `dca9617`:
- I had said `ResultsPage` shows the correct answer for every type, but it's only for
  fill-in-the-blank;
- I had missed NetID SSO;
- I had missed the `game_abandoned` event.

After that, I kept the files current as I changed code:
- T4 admin, `3cba398`;
- T7 numeric, `f9da2bc`;
- T9 theming: the "hardcoded palette — T9 target" notes became a description of the token
  system.

> ✍️ **Jack:** What did writing these teach you that reading the code alone wouldn't have?
> Pick one or two concrete things. Candidates: that the three apps share nothing; that the
> host never shows options during a question; that `TimerBar` needs `key={questionId}` to
> reset; that `new_question` must never carry the answer. Also, did you actually re-read these
> files later, and did the AI's later sessions use them?

---

## 2. Design Process (Elephant / Goldfish)

I used the repo's skills for every feature:
- **Elephant:** `design-discussion` for the conversation, then `write-spec` to write it up.
- **Goldfish:** `goldfish-test`, run in a genuinely new Claude Code session.
- **Close:** `mean-review` after implementing.

In every case the design doc was committed before any code, and every Goldfish round is its
own commit, so the history shows the order.

### T4 admin restructure: `docs/design-t4-admin.md`

- **The Elephant session** (`ai_log/2026-10-04_14-54-28_816e9da9.md` onward) started from the
  admin context docs and Bill's host design, because my branch depended on his
  `games.course_id`.
- **Decisions in the discussion:**
  - a two-tier sidebar (Administration first, "Host & play" second);
  - a course page as the hub for granting access, instead of granting from each user's page;
  - keep game access visible;
  - fix `api.ts` so backend error messages actually show up.
- **Draft:** `d52acc3`.
- **Goldfish:** two zero-context reviews. G1 was a fresh subagent. G2 was a separate new session,
  `ai_log/2026-10-04_15-35-14_bada2f1d.md`.
- **What the Goldfish caught that the Elephant missed:**
  - The draft claimed admin's error handling would "match the host `api.ts`". G1 pointed out
    that host's doesn't handle FastAPI's validation-error array either, and today admin shows
    `[object Object]`. So A5 had to do more than copy.
  - Dead ends a real user would hit:
    - no courses means create/import has nowhere to go;
    - RosterPage has no back link;
    - a non-admin who logs in gets the full UI, and then every request fails.
  - **The Goldfish can be wrong.** G2's one "must-fix" said a PLAYER grant does nothing for a
    NetID user. Before changing the design, I had Claude check `game_service.authorise_player`.
    The roster check falls through to the `UserCourseAccess` check for every user, so the grant
    does work. I rejected the finding and recorded why (§7, row 25). The lesson: a Goldfish
    review is a list of claims to verify, not a list of changes to make.
- **Revision:** `a7aeb87` added 25 resolutions. Then I implemented A1–A8 (`eff3c03` → `73315dc`).

### T7 numeric estimate: `docs/design-t7-numeric.md`

- **Subject:** I picked statistics, modelled on *Guess the Correlation* from the instructions.
  You type one number and get partial credit for being close.
- **Decisions in the Elephant discussion** (`ai_log/2026-10-04_16-47-12_816e9da9.md`): absolute
  *and* percent tolerance modes, and the five-bucket "way under / spot on / way over" chart. A
  teacher learns more from *which direction* the class missed than from a histogram of raw
  guesses.
- **Draft:** `9d5994c`.
- **Round 1** (`ee0ff9b`), the most important finding: the branch had been cut from `main`,
  which didn't have `map_pin` yet. Every "add this next to map_pin's branch" instruction in the
  spec pointed at code that didn't exist on the branch. A fresh reader noticed immediately; the
  Elephant session had been reading Bill's branch the whole time and never saw it. I rebased
  onto `feature/t7-map-question` and stated the stacking in the header.
- **Round 2** (`5d0fb09`): a real UX problem neither of us had thought about. The iOS decimal
  keypad has no `-` and no `e`, so a player couldn't type a negative correlation or `6.02e23`.
  That's why the player screen has "±" and "×10ⁿ" buttons. Round 2 also found that a huge JSON
  integer like `10**400` passes a naive "is finite" check and then raises `OverflowError`
  (now a unit test).
- **Implementation:** commits `c13d6b3` → `9e0904b`, step by step against the doc.
- **The mean review** found two real bugs (`0eb0d3a`):
  - Switching an untouched question to percent mode kept the absolute defaults 0.05 / 0.15,
    which in percent mode means 0.05%.
  - Partial credit showed a red ✗ on the player's game-over card.

### T9 theming: `docs/design-t9-theming.md`

- **Decisions:** keep indigo; one theme key shared by all three apps; a Playwright tour for the
  screenshots, so the "after" set is repeatable; replace Tailwind's palette instead of extending
  it, so a missed class shows up unstyled instead of silently staying dark.
- **The Goldfish blocker** (`b598ce1`): the draft's own color values *failed its own contrast
  requirements*. White on green-600 is 3.30:1, and the borders were far below 3:1. The values
  were recomputed, and `scripts/check_contrast.mjs` now verifies all 39 pairs.
- **Implementation revealed two more flaws**, which I wrote back into the doc (§7, "Implementation
  revisions", `81a6d77`) before writing the code that depended on them, as T3 Step 6 says:
  - `tsc -b` refuses `noEmit` on a referenced project, so the planned fix for the stale
    `tailwind.config.js` couldn't work.
  - The planned CI job would have modified `.gitlab-ci.yml`, and the grader checks that file is
    unmodified.

> ✍️ **Jack:** Reflect on whether the process changed how you implemented. Some honest
> questions to answer for yourself: Did having the doc make the implementation sessions faster
> or just longer? Would you have caught the stacked-branch problem or the iOS keypad without the
> Goldfish? Was two Goldfish rounds worth it for numeric? What would you skip next time?

---

## 3. AI Tools Used

I used **Claude Code** for everything, with the repo's skills and rules. Nothing else: no ChatGPT
or Copilot. Every session is logged in `ai_log/`, one file per prompt.

| Session | Dates | What I used it for |
|---|---|---|
| `9de0c965` | 2026-09-29 | T0 logging check, a first look over the project, starting the frontend context docs |
| `f2697df3` | 2026-09-30 | Finishing T3 frontend docs, running the app for the first time, opening !3, saving the team split to memory |
| `816e9da9` | 2026-10-04 | T4 admin (design → Goldfish → implement), T7 numeric (design → 2 Goldfish → implement → mean review), T6 games, T9 design and "before" screenshots |
| `bada2f1d` | 2026-10-04 | The separate fresh session for the T4 admin Goldfish test (G2) |
| `30a99440` | 2026-10-05 | Checking the merged state, T9 implementation, the T9 MR, and drafting this document |

**How I used it.** Mostly I gave short direction prompts, the agent did the work, and I approved
the steps or redirected. Examples:
- "yes, start the admin design discussion";
- "keep game access visible, and go with the full version";
- "absolute plus percent, keep the chart, stats";
- "push it and start implementing";
- "everything works, run the mean review".

The decisions in those prompts were mine. The code and most of the prose were the AI's. I
reviewed them by:
- running the app and playing the games (✍️ **Jack:** did you test numeric on a real phone?
  Say so only if you did);
- reading the design docs;
- reading the screenshots.

**Where it helped:**
- **Working in an unfamiliar codebase fast.** The context hierarchy plus the agent reading code
  meant I could design a full vertical slice (numeric touches about 20 files across backend and
  three frontends) in one afternoon.
- **The Goldfish and mean-review steps found real bugs.** For example the stacked-branch
  problem, the iOS keypad, the percent-mode defaults, and the contrast failures. I don't think I
  would have found those by reading my own spec.
- **Mechanical work at scale.** T9's sweep changed ~720 lines in 51 files. A codemod plus a
  guardrail script that fails on any leftover raw color made it checkable rather than hopeful.

**Where it fell short.** These are specific to my logs:
- **Confident but wrong status reports.** On 2026-10-05 (`30a99440`):
  - It reported 66 ruff errors, because it ran a newer ruff than CI. CI's pinned 0.15.21 was
    clean, and it had to correct itself.
  - It told me nine MRs were "waiting for my approval" when I had already approved all of them.
    It had only looked at git branches, not GitLab. I had to tell it.
- **Plans that ignored constraints outside the code.** The T9 design called for a new CI job
  without noticing that the grading rubric checks `.gitlab-ci.yml` is unmodified. Its first
  T7 numeric branch was cut from the wrong base.
- **Silent tool failures.** During T9's type-scale step, a `sed` command using `\b` did nothing
  on macOS (BSD sed) and reported no error. It only noticed when the screenshots didn't change.
- **The Goldfish critic is not always right.** G2's "must-fix" for T4 was wrong (see §2).
- **It writes a lot.** The design docs are thorough but long. Reviewing them properly took real
  time, and I didn't always read every line.

> ✍️ **Jack:** Add your own honest assessment here: how much of the code you could explain
> line by line at the TA review, and where you trusted the AI without checking. Also say what
> you'd do differently: ask for shorter docs, check git and GitLab state yourself, etc.

---

## 4. Best Practices Learned

- **Branch-per-task with merge requests and a required reviewer** kept two people from
  overwriting each other in a shared codebase. Examples:
  - T4 admin was branched off Bill's host branch because it depended on his schema change;
  - T7 numeric was stacked on his map_pin MR;
  - T9 merged T8 in so one sweep covered both.

  Merging with merge commits (not squash) kept the design → Goldfish → implementation order
  visible in history, which is also evidence for grading.
- **CI checks what humans forget.** For example, pinned linter versions mean the same command
  can give different answers locally and in CI. I learned to run the *pinned* version before
  trusting a result.
- **Role-based design means the server is the check.** For example:
  - admin's `RequireAdmin` decodes the token's role only to show a friendlier page;
  - `require_admin` and the course-access checks on the backend are what actually protect data.

  Hiding a button is UX, not security.
- **Tests should verify behavior, not just that endpoints respond.** The numeric integration
  test plays a 4-guest socket game and checks exact bucket counts and points. It also checks that
  a malformed payload doesn't use up the answer, and that import/export round-trips.
- **Guardrails beat good intentions.** T9's `check_theme_tokens.sh` makes "no raw colors" a
  failing command instead of a convention. The CSS design makes a missed class visibly
  unstyled rather than subtly wrong.
- **Effective AI use:**
  - give it context (the context hierarchy);
  - make it write the plan down before coding;
  - test the plan on a reader with no context;
  - verify its claims against the code and the real system (CI, GitLab) before acting on them.

> ✍️ **Jack:** Pick the one or two of these that actually changed how you work, and say why in
> a sentence or two of your own. Delete or shorten the rest. Graders value specific over
> exhaustive.
