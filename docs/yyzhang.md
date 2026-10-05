# Bill Zhang (yyzhang) — Individual Document

## Repository and Codebase Organization

### How the repository is organized

Buzzer is split into a Python backend and three separate React frontends that share no code.

- `backend/app/` is a FastAPI application with a Socket.IO server wrapped around it.
  - `routers/` holds the REST endpoints.
  - `services/` holds the business logic: access checks, scoring, Redis state, exports.
  - `models/` holds the MySQL tables.
  - `schemas/` holds the Pydantic request and response shapes, including the only per-type
    validation of question `config` and `answer_data`.
  - `websocket/` holds the real-time game gateway.
  - `common/` holds authentication, error types and logging.
- `frontend/host/` is the big-screen app, `frontend/player/` is the phone app and
  `frontend/admin/` is the admin console. Each is its own Vite build, so shared components
  are copied, not imported.
- `tests/` has unit tests and an integration suite that runs against the live Docker stack.
  `scripts/` has tools such as the player simulator. `sample_games/` holds game JSON files,
  `docs/` holds the design documents and `ai_log/` holds the AI session logs.

MySQL is the record of truth. Redis holds the live state of a room while a game is running.

### Data flow during one round

1. The host clicks Next on the big screen. The host app sends `host_advance` over Socket.IO.
2. The gateway loads the question from MySQL and stores the room's current question in Redis.
   Then it sends `new_question` to every player. The payload includes the question's `config`
   but **never** its `answer_data`, which is where the correct answer lives.
3. A player answers on the phone, which sends `submit_answer` with an `answer_data` payload.
4. The gateway checks the payload's shape, then `game_service.record_answer` scores it with
   `calculate_score`. It writes a `SessionScore` row to MySQL and updates the player's score,
   the "answered" set and the answer distribution in Redis.
5. The player gets `answer_received` with their points. The host gets `answer_status` with the
   new answered count.
6. When the timer ends or the host closes the question, `question_results` goes out. The host
   gets the whole answer distribution and the correct-answer reveal; each player gets their own
   result and rank.

### The context files I wrote

Our team built the context hierarchy as nested `CLAUDE.md` files. I wrote the six backend ones
(`backend/app/{models,schemas,common,routers,services,websocket}/CLAUDE.md`) and the
`backend/app/CLAUDE.md` rollup. Jack wrote the nine frontend ones. Later, as T4, T7 and T8
changed the code, I kept them in sync.

The backend was the hardest part for me to understand at first, mostly because many of the
terms (routers, schemas, Redis state, Socket.IO events) were unfamiliar. Writing these files
forced me to learn what each directory is responsible for. They then guided the rest of my
work in concrete ways:

- **Where answers may live.** The docs record that a question's `config` is sent to every
  player. When we designed the T7 map question, the correct location went into `answer_data`
  from the start.
- **What the phone shows.** The docs record that players never see the prompt on their phone.
  So the map question's clue stays on the big screen, and in T8 the prompt image is shown only
  on the big screen.
- **Goldfish tests.** The Goldfish sessions read only the docs, not the code, so the accuracy of
  these files decided whether a Goldfish test could find real problems.
- **Real bugs.** While writing them I found that deleting an answered question returned 204
  without deleting anything, and that Redis `session:*` keys never expire. The first was fixed
  in T4; the second was documented first; its fix is in merge request !18.

One lesson from this step is that AI-written documentation is not reliable on its own. When a
separate subagent fact-checked our first draft against the code, it found 14 claims that were
wrong or misleading, and we fixed all of them before committing.

## Design Process (Elephant/Goldfish)

I followed the full process three times, once for each feature I designed:

| Feature | Design doc | Goldfish session log | Findings | Draft → revision commits |
|---|---|---|---|---|
| T4 host capabilities | [design-t4-host.md](design-t4-host.md) | `ai_log/2026-10-03_18-01-04_df920eff.md` | 13, verdict "not ready" | `d032fd2` → `540f714` |
| T7 map question | [design-t7-map-question.md](design-t7-map-question.md) | `ai_log/2026-10-03_19-14-45_b2c5d430.md` | 10 (A–J), "mostly ready" | `f500ce5` → `c7b9129` |
| T8 images | [design-t8-images.md](design-t8-images.md) | `ai_log/2026-10-04_18-22-08_20617f8f.md` | 12 | `a2c4c6a` → `e3fb75e` |

Each time, the steps were:

1. **Elephant.** In my main Claude Code session (`ai_log/*_98750d13.md`), in plan mode, I
   discussed the design without writing code. Claude loaded only the relevant `CLAUDE.md` files
   and proposed each decision with its own critique. I answered the decisions one at a time,
   for example "images belong to a game, not a course" (T8 D1).
2. **Write it down.** The agreed design was written to `docs/design-<feature>.md` and
   committed before any code.
3. **Goldfish.** A brand-new session, with no memory of the discussion, read only the design
   doc and the context hierarchy and ran `/goldfish-test`: a comprehension check, a critic
   pass and a readiness verdict.
4. **Revise.** Every finding was resolved in the doc and logged in its section 8 table, then
   committed separately, before implementation started.

The Goldfish results did not surprise me. By the third run I expected it to find problems,
because it almost always did. What it caught were the things the Elephant session "knew" but
never wrote down. The T7 map question is the one I remember best, because these problems
only came to light after the test:

- A COMPLETENESS map question could have been saved without a correct location, which would
  have broken every screen that reveals the answer. The fix was to require the target for both
  grading types.
- A player with partial points would have seen "Correct!". The results screen now shows the
  distance and points, and "Bullseye!" only for full credit.

In T8 it found that a portrait phone photo would report the wrong aspect ratio because of
EXIF rotation, which would have placed every map answer in the wrong spot. It also raised a
real design question: should an answered map question be allowed to change its map? I decided
no (409), and that decision went into the doc before any code was written.

The process did change how I implemented. Because the revised docs already named every file,
error message and test case, the implementation was smooth: I mostly worked down the steps in
order. Bugs that remained were small, for example two images uploaded in the same second
sorting out of order, which the planned export test caught.

## AI Tools Used

I used only Claude Code (Anthropic), in four kinds of separate sessions. I did not use ChatGPT,
Gemini, Copilot or any other AI tool.

### 1. Claude Code, main session (the "Elephant")

- **Log:** `ai_log/*_98750d13.md`, from `2026-09-25_11-55-25_98750d13.md` onward. The repository
  hook commits a log file on every prompt.
- **What I asked:**
  - the T0 setup and T3 backend context docs;
  - the design discussions for T4, T7 and T8 (in plan mode);
  - writing the design docs, the implementation, the tests (T5) and my sample games (T6);
  - reviewing Jack's merge requests !7 and !10 before I approved them;
  - walking me through every manual UI test one step at a time.
- **How I used the output:** I made the design decisions myself, one question at a time, and
  ran every manual test in the browser myself. Claude wrote the code and ran ruff, `tsc`, the
  unit tests and the integration suite before each push.

### 2. Claude Code, Goldfish sessions

Fresh sessions with no memory of the design discussion, used only to run `/goldfish-test` on a
design doc: `ai_log/2026-10-03_18-01-04_df920eff.md` (T4), `ai_log/2026-10-03_19-14-45_b2c5d430.md`
(T7) and `ai_log/2026-10-04_18-22-08_20617f8f.md` (T8). I pasted their findings back into the
main session, which revised the doc. See the Design Process section.

### 3. Claude Code subagent (fact-check)

During T3 the main session started a separate subagent to check every claim in our backend
`CLAUDE.md` drafts against the source. It found 14 wrong or misleading claims. Its work is
recorded inside the main session's log.

### 4. Claude Code, GitLab session (held the access token)

A separate Claude Code session held my GitLab personal access token and did all GitLab API work:
- opening merge requests (!5, !6, !8, !9, !11, and the bug fixes and this document, !13–!19);
- reading their status for me;
- approving and merging (!3, !5, !6, !7, !8, !10, !12).

**It has no `ai_log` file.** It ran outside this repository on purpose, so that the token could
never be committed with a session log (see Best Practices). Its actions are recorded instead in
each merge request's history on GitLab (the system notes for review requests, approvals and
merges). I asked it only for those actions, never for code.

### Assessment

**Where it helped.** AI writes code very fast. A feature like T8 (a new table, upload rules,
nine routes, three frontends, 31 new tests) took one evening instead of days. It was also good
at following a written spec, and at checking its own work by running the tests.

**Where it fell short.**

- **Visual decisions still need a person.** In T8 the phone's image options were far too large
  in my test window. Claude had followed the design, but it could not see the screen. I spotted
  it during the manual test, and the fix was a one-line height cap.
- **I can't trust what it writes 100%.**
  - The subagent found 14 errors in our first AI-written context docs.
  - Earlier in the project Claude deleted a demo question while testing, based on a wrong
    assumption about the data, and had to restore it.
  - While helping me write this document, it first gave the wrong number of T4 Goldfish
    findings (8 instead of 13) and used commit hashes from before a rebase. Both were caught
    only because it checked the repository again.

My rule became: let AI do the typing, but verify against the code, the tests or the screen
before believing it.

## Best Practices Learned

### Working in an unfamiliar codebase

I started this project without knowing FastAPI, Socket.IO or Redis. AI helped me understand
the codebase and get productive quickly, but the method mattered more than the tool:

- **Build understanding bottom-up and write it down.** The per-directory `CLAUDE.md` files
  turned "read the whole codebase" into "read one short file per directory". Writing them myself
  was how I learned the backend.
- **Load only what the task needs.** For each design discussion, Claude read the context files
  for the affected directories and their parents, not the entire repository. That kept the
  discussion focused, and it is what makes a Goldfish test possible at all.
- **Verify the map against the territory.** The docs are a summary, and summaries go stale.
  The 14 errors in our first drafts showed that every claim has to be checked against the source,
  and the context-sync rule keeps the docs updated whenever the code changes.

### Security, and splitting work across separate AI sessions

Every Claude Code prompt in this repository is logged to `ai_log/` and pushed, where staff and
my teammate can read it. So anything secret must never appear in a logged session. We handled
this by splitting the work across sessions with different jobs:

- The **main session** did the code, docs and commits. It never saw the GitLab access token, and
  it never printed `.env` passwords or JWT keys. Before every push it scanned the diff for
  secrets.
- A **separate session held the GitLab token** and did only GitLab actions: opening merge
  requests, approving and merging. Until October 5 it acted only after I confirmed in its own
  window, and a message from another session was never treated as my approval. After that I
  changed the rule: it acts on the main session's requests without asking me, but only after
  reviewing the diff itself, and it reports every action to me. The main session still sends an
  approve or merge request only when I ask for one in its window.
- **Goldfish sessions** were deliberately fresh, so they could judge a design doc without the
  Elephant's memory.

Splitting the roles this way keeps credentials out of the logs. It also builds in a check
before any action that is hard to undo. When the main session's force-push was blocked by a
safety check, it stopped and asked me rather than asking another session to do it.

### Also worth keeping

- **Version control as evidence.** We used merge commits, not squash, so the commit order
  (context docs → design doc → Goldfish revision → code) stays visible in history.
  Retargeting a merge request in GitLab resets its approvals.
- **CI is not the whole test suite.** Our pipeline runs ruff, `tsc` and secret detection, but
  not pytest, so the unit and integration tests had to be run locally before every push.
- **Test the tests.** Temporarily disabling a rule (for example the image ownership check)
  and watching a test fail proved the test actually guards it. Manual testing still caught
  what automation could not, such as the oversized image tiles.
