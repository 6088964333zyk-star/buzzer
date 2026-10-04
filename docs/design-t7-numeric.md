# Design: T7 Numeric Estimate Question Type (`numeric`)

**Owner:** Jack Mayerhofer (jmayerhofer). The team's other T7 type is `map_pin` (Bill Zhang,
`docs/design-t7-map-question.md`, MR !6): Canvas-based, party. This one is the **classroom**
type and is not Canvas-based.
**Status:** Draft, pre-Goldfish.
**Branch:** cut from `main` after !6 (map_pin) merges, because both types edit the same per-type
branches. If !6 hasn't merged when implementation starts, cut from `origin/feature/t7-map-question`
and target that branch.
**Process:** Written after the T3 context docs and committed before any implementation code.

---

## 1. Problem

T7 (`instructions.md`) asks each team for two new question types with a defined scoring
approach, one suited to a classroom. The built-in types are all right/wrong or option-based.
None can ask "estimate this quantity" and give **partial credit for being close**, which is how
statistics and science teachers actually check intuition:

- "Estimate the correlation coefficient of this scatter plot." (answer 0.62)
- "What's the standard deviation of {2, 4, 4, 4, 5, 5, 7, 9}?" (answer 2)
- "Roughly how many people in a room of 23 before a shared birthday is more likely than not?"

The model is *Guess the Correlation* from the T7 instructions: one number, scored immediately by
how close it is.

**Subject:** statistics. Editor defaults and the T6 classroom game are tuned for
correlation-style answers (values in [−1, 1], tolerance ±0.05).

### What a new type touches today

Per `backend/app/CLAUDE.md` and `backend/app/services/CLAUDE.md`, per-type logic is copied, not
shared. `map_pin` (on `main` once !6 merges) is the most recent example, and every place it
added a branch, `numeric` needs one too. §4 lists them.

- **Players see `config`.** `config` is sent verbatim to every player in `new_question`, so the
  answer and tolerances must live in `answer_data`.
- **`calculate_score` must not raise.** A malformed payload that raises inside the gateway gives
  the player no reply (`services/CLAUDE.md`), so bad input must score 0 or be rejected first.

---

## 2. Technical Plan (summary)

- **Type id:** `numeric`, label "Numeric Estimate". Grading: ACCURACY (distance-based partial
  credit) or COMPLETENESS (any valid number earns full points).
- **Shapes:**
  - `config`: `{"unit": "m/s"}`. Optional; shown next to the input and in reveals.
  - `answer_data`:
    `{"answer": 0.62, "toleranceMode": "absolute", "fullTolerance": 0.05, "zeroTolerance": 0.15}`.
  - Player payload: `{"value": 0.58}`. A JSON number, never a string.
- **Scoring:** linear falloff between two tolerances, the same shape as map_pin's D2.
- **Reveal:** always includes the answer, even for COMPLETENESS, like map_pin.
- **Host results:** a five-bar "way under → spot on → way over" chart from the existing answer
  distribution hash.
- **Helpers:** one backend module, `backend/app/services/numeric.py`, used by the validator, the
  gateway and scoring so they can't drift (the same pattern as `services/map_pin.py`).

### Design decisions

**N1 — Two tolerance modes: absolute and percent.**

- **`toleranceMode: "absolute"`:** tolerances are in the question's unit.
  `fullTolerance: 0.05` means within ±0.05 of the answer.
- **`toleranceMode: "percent"`:** tolerances are percentages of `|answer|`.
  `fullTolerance: 5` means within ±5% of the answer. The effective tolerance is
  `|answer| × tolerance / 100`. This covers answers whose scale makes absolute tolerances
  awkward (Avogadro's number, populations).
- **Validation, for both grading types** (the reveal always shows the answer):
  - `answer` is a finite number.
  - `toleranceMode` ∈ {`absolute`, `percent`}.
  - `fullTolerance` and `zeroTolerance` are finite numbers with
    `0 ≤ fullTolerance < zeroTolerance`. The strict `<` avoids dividing by zero in the falloff.
  - In percent mode, `answer ≠ 0`, because a percentage of zero is zero, so nothing but an exact
    0 could score. Error: `"numeric percent tolerance needs a non-zero answer; use absolute"`.
  - `config.unit`, if present, is a string of at most 20 characters.
- "Finite number" means `int` or `float`, **not `bool`** (`isinstance(True, int)` is true in
  Python), and not NaN or ±Infinity.

**N2 — Linear falloff, rounded to 2 decimals.**

- `d = |value − answer|`; `full`, `zero` = effective tolerances (N1).
- `eps = 1e-9 × max(1, |answer|)`. Without it, floating-point error would put an exact-boundary
  guess on the wrong side (e.g. 0.62 − 0.57 is 0.05000000000000004).
- Points:
  - `d ≤ full + eps` → `points_value`, and `is_correct = true`;
  - `d ≥ zero − eps` → `0`;
  - otherwise `points_value × (zero − d) / (zero − full)`.
  - Rounded to 2 decimals.
- `is_correct` = within full credit only. Partial credit is not "correct", which matches map_pin.
- **COMPLETENESS:** any valid value → `points_value`, `is_correct = true`.
- **Invalid value in `calculate_score`** (missing, string, bool, NaN): 0 points, not correct, no
  exception. The gateway normally rejects these first (N4).

**N3 — Direction-of-error buckets drive the host chart.**

- **Buckets.** With `diff = value − answer` and the same `full`/`zero`/`eps` as N2:
  - `|diff| ≤ full + eps` → `"full"`;
  - otherwise `|diff| < zero − eps` → `"partial_low"` if `diff < 0`, else `"partial_high"`;
  - otherwise → `"zero_low"` / `"zero_high"` by the same sign rule.
  - The boundaries match scoring exactly: a value in `"zero_*"` scored 0, a value in
    `"partial_*"` scored more than 0.
- **Storage.** `record_answer` counts that key with the existing `state.increment_answer_dist`,
  so the host's `question_results.answerDistribution` arrives as e.g.
  `{"zero_low": 3, "partial_low": 5, "full": 9, "partial_high": 2}`. Missing keys mean 0.
- **Why:** a teacher learns whether the class *systematically* under- or over-estimates, which
  right/wrong can't show. This is the classroom payoff of the type.
- **No new Redis keys and no new events.**

**N4 — The gateway rejects malformed answers.**
In `on_submit_answer`, for `numeric`, if `answer_data.get("value")` is not a finite number (N1),
emit `error` `"numeric answer must include a finite number 'value'"` and return before scoring.
This is the same pattern as map_pin's point check.

**N5 — Player input accepts plain and scientific notation.**

- **Field.** A single text field with `inputmode="decimal"` (numeric keypad on phones), the unit
  as a suffix label, and a Submit button. Enter also submits.
- **Accepted syntax** (after trimming):
  - the full regex is `^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$`;
  - so: an optional leading `-`, digits with an optional `.` (`.5` is allowed), and an optional
    exponent (`6.02e23`, `1E-3`).
  - **Commas are rejected**, because `1,000` vs `1,5` is ambiguous across locales. Error under the
    field: "Use digits and a dot, e.g. 0.62 or 6.02e23".
- Parsed with `Number(...)`; the result must be finite. The payload sends the **number**.
- Submit is disabled until the input parses. One submission per question, as for other types.

**N6 — Displaying numbers.** One formatter, `formatNumber(n)`, in each frontend's `lib/numeric.ts`:

- `|n| ≥ 1e6`, or `0 < |n| < 1e-3` → `n.toExponential(3)` (e.g. `6.022e+23`);
- otherwise → `String(Number(n.toPrecision(6)))` (e.g. `0.62`, `343`, `2.33333`).
- The unit, when present, is appended with a space.

**N7 — What each screen shows.**

| Screen | Shows |
|---|---|
| Player question | Prompt, input with unit suffix, Submit |
| Host question | Type label "Numeric Estimate" and the hint "🔢 Type your estimate on your phone" (like map_pin's hint) |
| Player results | "You: 0.58 · Answer: 0.62 · off by 0.04" and the points earned. "Spot on!" only if `isCorrect`; never "Correct!" for partial credit. COMPLETENESS: "Recorded" plus the answer |
| Host results | The answer (large), the five-bar chart (N3), and "N of M within full credit" |
| Player game over | Per-question card: your value, the answer, points |
| Host game over | The answer and unit for each numeric question |
| HTML report | Badge "Numeric", and a one-line summary: "Answer 0.62 · N guesses · M within full credit · median guess 0.58 · K under / J over" |

**N8 — Both question editors get the type.**
Admin (`frontend/admin/src/pages/QuestionEditorPage.tsx`) and host
(`frontend/host/src/pages/manage/QuestionEditorPage.tsx`) are separate copies (T4 design D6), so
both need it.

- **Fields:**
  - Answer (text, parsed as in N5);
  - Tolerance mode (select: "± absolute" / "± percent of answer");
  - Full-credit tolerance;
  - Zero-credit tolerance;
  - Unit (optional, max 20);
  - Points (the question's `points_value`, as for map_pin, not per option).
- **Defaults** for a new numeric question (stats-tuned): absolute, full `0.05`, zero `0.15`,
  answer empty, unit empty.
- **Client checks** mirror N1. The server's 422 is still the real check, and admin's `toError`
  shows it.
- A one-line preview under the fields: "Full credit within ±0.05; nothing beyond ±0.15", or the
  percent equivalent.

---

## 3. Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| 1 | **Absolute tolerance only** | Simplest, but it makes wide-range answers (constants, populations) hard to set up. Percent mode is one field plus one branch. |
| 2 | **Stepped bands** (full within A, half within B, else 0), as Guess the Correlation does | Linear falloff is fairer near the boundary and matches map_pin, so the team has one partial-credit model. |
| 3 | **Store the exact guess for a histogram** | Exact values need binning chosen per question (scale-dependent) and a new reveal format. Five semantic buckets are scale-free and reuse `answer_dist`. |
| 4 | **Accept commas / locale parsing** | Ambiguous (`1,000` vs `1,5`); classroom answers rarely need it. Rejecting with a clear message is safer. |
| 5 | **`<input type="number">`** | Browser support for `e` notation and `-` differs on mobile keypads, and it silently returns `""` for invalid input. A text field with `inputmode="decimal"` plus our own parser is predictable. |
| 6 | **Treat it as fill-in-the-blank with numeric strings** | No partial credit and no direction chart: it wouldn't be a new scoring approach. |
| 7 | **Canvas number line** (drag a marker) | map_pin is already the team's Canvas type; typing is faster and exact for classroom estimates. |

---

## 4. Detailed implementation

Implement in order; run the unit tests after Step 2.

### Step 1 — Helper module `backend/app/services/numeric.py` (new)

Same style as `services/map_pin.py`. Functions:

- `is_finite_number(v) -> bool`: N1's definition.
- `effective_tolerances(answer_data) -> tuple[float, float]`: `(full, zero)` after applying
  `toleranceMode`.
- `score_numeric(value, answer_data, points_value) -> tuple[float, bool]`: N2.
- `bucket(value, answer_data) -> str`: N3.
- `reveal(answer_data, config) -> dict`: exactly
  `{"type": "numeric", "answer", "toleranceMode", "fullTolerance", "zeroTolerance", "unit"}`,
  with `unit` = `config.get("unit") or None`. The tolerances are the stored values, not the
  effective ones; the frontends apply the mode for display.
- `validate(config, answer_data) -> str | None`: returns the first N1 error message, or `None`.

### Step 2 — Validation and scoring

- `backend/app/schemas/admin.py`:
  - add `numeric` to the type regex in **both** `QuestionCreate` and `QuestionUpdate`;
  - in `validate_structure`, add `if self.type == "numeric":` that raises
    `ValueError(numeric.validate(...))` when it returns a message.
- `backend/app/services/game_service.py`:
  - **`calculate_score`:** a `numeric` branch next to map_pin's. Invalid value → 0/false;
    COMPLETENESS → full/true; else `score_numeric`.
  - **`record_answer`:** a distribution branch where `dist_key = numeric.bucket(value, ...)`
    if the value is valid.
  - **`get_player_question_summary` and `get_host_question_summary`:** a `numeric` branch
    **before** the COMPLETENESS branch, returning `numeric.reveal(...)` (as map_pin does).
  - **The summary distribution loop** (map_pin's grid-key branch near the end of
    `get_host_question_summary`): count `numeric.bucket(...)` keys.

### Step 3 — Gateway (`backend/app/websocket/gateway.py`)

- **`_answer_reveal`:** `if q.type == "numeric": return numeric.reveal(q.answer_data, q.config)`,
  before COMPLETENESS.
- **`on_submit_answer`:** the N4 check, next to map_pin's.

### Step 4 — HTML report (`backend/app/services/report_service.py`)

- `_answer_reveal`: the same branch as Step 3.
- `_extract_answer_key`: return `numeric.bucket(...)` for valid values, otherwise `None`.
- Type badge: `"numeric": ("Numeric", "badge-fitb")`.
- A new `_render_numeric_summary(q, scores)` produces the N7 report line, passed through `_esc`.
  It is called where map_pin's `_render_map_summary` is.

### Step 5 — Player app (`frontend/player/src`)

- `types/game.ts`: add `'numeric'` to `QuestionType`, and a `NumericReveal` interface matching
  Step 1's `reveal` exactly (`unit: string | null`). Add it to the reveal union.
- `lib/numeric.ts` (new): `parseNumber(text): number | null` (N5), `formatNumber(n)` (N6),
  `withUnit(n, unit)`.
- `pages/game/QuestionPage.tsx`: the N5 input for `type === 'numeric'`; it submits
  `{ value: n }` through the existing `submit(...)`.
- `pages/game/ResultsPage.tsx`: a numeric branch per N7. It reads the player's value from the
  in-memory last answer, as the other types do. If it isn't available (after a reload), show only
  the answer and points.
- `pages/game/GameOverPage.tsx`: `describePlayerAnswer` branch per N7.

### Step 6 — Host app (`frontend/host/src`)

- `types/game.ts`: the same type and `NumericReveal` as the player app.
- `lib/numeric.ts`: copy `formatNumber` / `withUnit` (apps share no code).
- `pages/game/QuestionPage.tsx`: the label `numeric: 'Numeric Estimate'` and the N7 hint.
- `pages/game/ResultsPage.tsx`: a numeric branch rendering the N3 chart.
  - Five bars in order: `zero_low`, `partial_low`, `full`, `partial_high`, `zero_high`.
  - Labels: "Way under", "Close (under)", "Spot on", "Close (over)", "Way over".
  - Bar heights are proportional to the counts, and each count is printed on its bar.
  - "Spot on" uses the success color, the partial bars a neutral color, and the zero bars a muted
    color.
  - Above the chart: the answer (`withUnit`), large. Below: "N of M within full credit".
  - Plain divs, no chart library, readable from the back of a classroom: bar labels at least 18px.
- `pages/game/GameOverPage.tsx`: the label, and the answer display per N7.
- `pages/manage/QuestionEditorPage.tsx`: N8 (Step 7's list).

### Step 7 — Question editors (admin and host, same changes in both)

In each `QuestionEditorPage.tsx`, following the map_pin branches:

- the `QuestionType` union;
- `FormState` fields (`numAnswer`, `numMode`, `numFull`, `numZero`, `numUnit`) with N8 defaults;
- `questionToForm` and `formToPayload` (`numeric` → `config: {unit?}`, `answer_data` per §2);
- the `points_value` condition (numeric uses the form's points field, like map_pin);
- the type `<option>` "Numeric Estimate (type a number)";
- the form section;
- the list preview: "≈ 0.62 (±0.05 / ±0.15)";
- the type label map.

### Step 8 — Simulator (`scripts/simulate_players.py`)

- Document `numeric` in the docstring.
- If `--game-json` provides `answer_data`: an accurate player answers
  `answer + gauss(0, full_eff / 2)`. Everyone else answers uniformly in
  `[answer − 3·zero_eff, answer + 3·zero_eff]`.
- Without it: a uniform value in [−1, 1].

### Step 9 — Context docs

Update the CLAUDE.md files of every directory touched:

- `backend/app/services` (new module; the touch list now includes numeric);
- `backend/app/schemas` (shapes and payload `value`);
- `backend/app/websocket`;
- `frontend/{player,host}/src/{lib,types,pages/game}`;
- the admin and host `pages` editor notes.

### Files touched

| File | Change |
|---|---|
| `backend/app/services/numeric.py` | **new** |
| `backend/app/schemas/admin.py` | regex ×2, validator |
| `backend/app/services/game_service.py` | score, distribution, both summaries |
| `backend/app/services/report_service.py` | reveal, key, badge, summary line |
| `backend/app/websocket/gateway.py` | reveal, payload check |
| `frontend/player/src/types/game.ts`, `lib/numeric.ts` (**new**), `pages/game/{Question,Results,GameOver}Page.tsx` | N5–N7 |
| `frontend/host/src/types/game.ts`, `lib/numeric.ts` (**new**), `pages/game/{Question,Results,GameOver}Page.tsx`, `pages/manage/QuestionEditorPage.tsx` | N3, N7, N8 |
| `frontend/admin/src/pages/QuestionEditorPage.tsx` | N8 |
| `scripts/simulate_players.py` | Step 8 |
| `tests/unit/test_numeric.py`, `tests/integration/test_numeric.py` | **new** (§5) |
| CLAUDE.md files listed in Step 9 | context sync |

**Not touched:** Redis keys, event names, models/migrations (no schema change), map_pin code.

---

## 5. Verification

### Unit tests: `tests/unit/test_numeric.py` (run with `PYTHONPATH=backend`)

For `calculate_score` and `numeric.bucket`:

1. Absolute: exactly the answer → full; `d = full` (e.g. answer 0.62, value 0.57) → full and
   `"full"` (epsilon); midway between full and zero → half ±0.01; `d = zero` → 0 and
   `"zero_*"`.
2. Percent: answer 343, full 5%, zero 20%: 360 (≈4.96%) → full; 412 (≈20.1%) → 0; a negative
   answer (−40, 10%) uses `|answer|`.
3. The bucket sign: below the answer → `_low`, above → `_high`.
4. COMPLETENESS → full for any valid value.
5. Invalid values (`None`, `"0.6"`, `True`, NaN, Infinity) → 0, no exception.
6. Rounding to 2 decimals.
7. `numeric.validate`: each N1 rule produces its message; a valid absolute and a valid percent
   question → `None`.

### Integration tests: `tests/integration/test_numeric.py`

Follow `test_map_pin.py`'s structure.

1. **Host API.** Create a valid numeric question → 201. Each of the following → 422:
   - `fullTolerance ≥ zeroTolerance`;
   - percent mode with `answer: 0`;
   - `answer: true`;
   - a 21-character unit.

   An update that breaks the tolerances → 422, and the stored question is unchanged.
2. **Play over Socket.IO with three guests.**
   - Exact → `pointsAwarded == points_value`.
   - Midway → about half.
   - Beyond zero → 0.
   - The host's `question_results.answerDistribution` contains `full`, `partial_*` and
     `zero_*` keys with the right counts.
3. **Bad payloads.** A guest sends `{value: "0.6"}`, then `{value: true}`, then `{}`. Each gets
   an `error` event and no `answer_received`.
4. **Import/export round trip.** Import a game JSON containing a numeric question (both modes);
   export it; `config` and `answer_data` are unchanged.

### Commands (CI parity)

- `ruff check backend/ scripts/` and `ruff format --check backend/ scripts/` (ruff 0.15.21).
- `npx tsc --noEmit` in all three apps.
- `python -m pytest tests/integration/ -q` (also `--fast`) and `PYTHONPATH=backend pytest tests/unit`.

### Manual

1. In the host editor, create "Estimate the correlation" (answer 0.62, absolute 0.05/0.15) and a
   percent question ("speed of sound in m/s", 343, 5%/20%, unit "m/s").
2. Start a room, run `simulate_players.py --game-json …`, and join on a phone or a narrow
   browser.
3. Check:
   - the numeric keypad appears;
   - `6.02e23` is accepted and `1,5` is rejected;
   - the phone result line;
   - the big-screen chart;
   - the HTML summary line.

---

## 6. Known limits and risks

- **Percent mode near zero.** Answers like 0.001 make percent tolerances tiny; the editor's
  preview line (N8) shows the effective range so the teacher notices.
- **Merge order with map_pin.** Every backend touch point sits next to a map_pin branch, so the
  stack must follow !6.
- **T8 (images, Bill).** It will add images to prompts and options. `numeric` has no options and
  uses only the prompt, so the only shared files are the editors. Coordinate if both are open at
  once.
- **The editors drift.** The admin and host editor copies must both get N8 (T4 design D6).
- **Reload loses "your answer"** on the player results screen. That's existing behavior for all
  types (`player/src/pages/game/CLAUDE.md`).
