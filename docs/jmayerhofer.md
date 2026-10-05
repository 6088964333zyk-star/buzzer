# Jack Mayerhofer (jmayerhofer): Individual Document

Team: Jack Mayerhofer (jmayerhofer) and Bill Zhang (yyzhang).

**What I owned:**
- T3: the frontend context docs
- T4: the admin restructure
- T7: the `numeric` question type
- T6: my two sample games
- T9: theming

**What Bill owned:** the backend context docs, the host half of T4, `map_pin` and T8.

<!--
DRAFTING NOTE (delete before merging): Claude drafted the factual parts from the repo, design
docs and ai_log. The ✍️ blocks are mine to write in my own words.
-->

## 1. Repository and Codebase Organization

- **`backend/app/`** is FastAPI plus Socket.IO:
  - `routers/` (REST)
  - `services/` (logic and scoring)
  - `websocket/` (the live game)
  - `models/` and `schemas/`
- **`frontend/host`, `player`, `admin`** are three separate React/Vite apps that **share no
  code**, so shared pieces are copied:
  - the `ui/` primitives
  - `MapCanvas`
  - `numeric.ts`
  - `theme.css`
- **nginx** serves the apps at `/host/`, `/player/`, `/admin/` and proxies `/api` and
  `/socket.io` to the backend.
- **MySQL** holds durable data (users, courses, games, scores). **Redis** holds the live room
  state (current question, phase, lock, who answered, the answer distribution).
- **Access is enforced on the server** (`require_admin`, `authorise_player`, HOST checks on
  `/api/host/*`). The frontends only hide things.

**A game round:**
1. **Start.** The host emits `host_advance`. The gateway moves the room to `QUESTION` in Redis
   and broadcasts `new_question` with the question's `config`, never `answer_data`, so the
   answer never reaches a browser.
2. **Answer.** The player emits `submit_answer`. The gateway checks the phase, the lock, the
   question id, duplicates and the payload shape. Then `record_answer` / `calculate_score`
   scores it and saves it.
3. **Feedback.** The player gets `answer_received`. The host gets `answer_status` ("N / M
   answered"), and then `answer_phase_ended` when everyone has answered or the timer runs out.
4. **Results.** The host advances. `question_results` goes to each player's own `user:{id}` room
   (their personal score and rank) and to the host. `game_over` follows the last question.

**My context files:** the 16 frontend `CLAUDE.md` files (`8c24256`, !3), written bottom-up from
the leaf directories. Bill's review caught three errors, fixed in `dca9617`. I updated the files
again with T4, T7 and T9.

> ✍️ **Jack:** One or two things writing these taught you (e.g. the apps share nothing;
> `new_question` must never carry the answer).

## 2. Design Process (Elephant/Goldfish)

For each feature I used the same steps:
1. A design discussion (`design-discussion`).
2. A spec, committed before any code (`write-spec`).
3. A Goldfish test in a fresh session (`goldfish-test`).
4. Revise the doc.
5. Implement, then a mean review.

| Design | What the Goldfish caught that the Elephant missed |
|---|---|
| [T4 admin](design-t4-admin.md) | Admin shows `[object Object]` for validation errors, plus dead ends a real user would hit (no courses, no back link, non-admins seeing the full UI). One "must-fix" was **wrong**: a PLAYER grant *does* work for NetID users (checked in `authorise_player`), so I rejected it and recorded why. |
| [T7 numeric](design-t7-numeric.md) | The branch was cut from `main`, which had no `map_pin` code, so every "next to map_pin" instruction pointed at nothing. Round 2 found that the iOS keypad has no `-` or `e`, which led to the "±" and "×10ⁿ" buttons. The mean review then found two bugs (`0eb0d3a`). |
| [T9 theming](design-t9-theming.md) | The draft's own colors failed its contrast requirements. Implementation then found two more problems: `tsc -b` refuses `noEmit`, and a new CI job would break the grader's "unmodified `.gitlab-ci.yml`" check. I updated the doc before the code. |

My takeaway: a Goldfish review is a list of claims to verify, not changes to accept blindly.

> ✍️ **Jack:** Did the process change how you implemented? Would you have caught these without
> it? What would you skip next time?

## 3. AI Tools Used

Only **Claude Code**, with the repo's skills. Logs are in `ai_log/`:

| Session | Date | Used for |
|---|---|---|
| `9de0c965` | 09-29 | T0, first look, starting the context docs |
| `f2697df3` | 09-30 | T3 context docs, running the app, MR !3 |
| `816e9da9` | 10-04 | T4 admin, T7 numeric, T6 games, T9 design |
| `bada2f1d` | 10-04 | The fresh session for the T4 Goldfish test |
| `30a99440` | 10-05 | T9 implementation, this draft |

I gave short direction prompts ("keep game access visible, and go with the full version",
"absolute plus percent, keep the chart, stats", "run the mean review"). The agent wrote most of
the code and prose. I checked it by running the app, reading the docs and checking screenshots.

**Where it helped:**
- learning the codebase quickly through the context docs;
- Goldfish and mean-review runs that found real bugs;
- large mechanical changes made checkable (the T9 sweep, ~720 lines, plus a guardrail script).

**Where it fell short:**
- **Confident but wrong status reports.** It reported 66 ruff errors because it ran a newer
  ruff than CI, and it said my MRs were waiting for approval when I had already approved them.
- **Plans that ignored outside constraints:** the wrong branch base for T7, and the CI job in T9.
- **A silent failure:** a macOS `sed` command that did nothing and gave no error.
- **Verbose docs** that took real time to review.

> ✍️ **Jack:** Your honest take: what you trusted without checking, and what you'd do
> differently.

## 4. Best Practices Learned

- **A branch and an MR per task, with a required reviewer.** It made stacked work with a partner
  possible, and merge commits keep the design → implementation order visible.
- **Pinned CI versions.** Run the same version locally before trusting a result.
- **The server enforces access.** Hiding a button is UX, not security.
- **Tests check behavior**, e.g. exact bucket counts in a real socket game.
- **Guardrails beat conventions.** The T9 token check turns "no raw colors" into a failing
  command.
- **Using AI well:** give it context, make it write the plan first, test the plan on a fresh
  reader, and verify its claims.

> ✍️ **Jack:** Keep the one or two that actually changed how you work, and say why.
