# Design: T7 Numeric Estimate Question Type (`numeric`)

**Owner:** Jack Mayerhofer (jmayerhofer). The team's other T7 type is `map_pin` (Bill Zhang,
`docs/design-t7-map-question.md`, MR !6): Canvas-based, party. This one is the **classroom**
type and is not Canvas-based.
**Status:** Revised after Goldfish rounds 1 and 2 (2026-10-04, two fresh Claude Code sessions).
The pre-Goldfish draft is commit `9d5994c`; the round-1 revision is `ee0ff9b`. See *§7 Goldfish
revision log*.
**Branch:** `feature/t7-numeric`, **stacked on `feature/t7-map-question` (MR !6)**. Every
touch point below sits next to a `map_pin` branch, and "next to map_pin's" refers to the code on
that branch. The MR targets `feature/t7-map-question` until !6 merges, then `main`.
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
  Python), and `math.isfinite(float(v))` succeeds. That excludes NaN and ±Infinity, and also
  integers too large for a float (e.g. a crafted `10**400`), where `float(v)` raises
  `OverflowError`. That exception is caught and means "not finite". Without this, arithmetic on
  such a value would raise inside scoring (breaking N2's "never raises").
- **Error messages**, checked in this order. `numeric.validate` returns the first that applies:
  1. `"numeric answer_data.answer must be a finite number"`
  2. `"numeric answer_data.toleranceMode must be 'absolute' or 'percent'"`
  3. `"numeric tolerances must be finite numbers with 0 <= fullTolerance < zeroTolerance"`
  4. `"numeric percent tolerance needs a non-zero answer; use absolute"`
  5. `"numeric config.unit must be a string of at most 20 characters"`
- **Unknown keys** in `config` and `answer_data` are ignored, as for the existing types.
  `config` defaults to `{}` in `QuestionCreate`; a missing `unit` (or `""`) means no unit.

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
- **COMPLETENESS questions bucket too.** The answer is always revealed (N7), and the chart is
  just as useful when everyone gets participation points.
- **No new Redis keys and no new events.**

**N4 — The gateway rejects malformed answers.**
In `on_submit_answer`, for `numeric`, if `answer_data.get("value")` is not a finite number (N1),
emit `error` `"numeric answer must include a finite number 'value'"` and return before scoring.
This is the same pattern as map_pin's point check, and it goes **right after it**.

- **Order matters.** In `on_submit_answer` the "already answered?" read (`state.has_answered`)
  comes before the type checks, and an answer is only *marked* answered inside
  `game_service.record_answer`, which runs after them.
- **So a rejected payload does not use up the player's answer:** they can correct it and submit
  again. Integration test 3 checks this.

**N5 — Player input accepts plain and scientific notation.**

- **Field.** A single text field with `inputmode="decimal"` (numeric keypad on phones), the unit
  as a suffix label, and a Submit button. Enter also submits.
- **Sign and exponent buttons.** iOS's decimal keypad has only digits and `.`: no `-`, no `e`.
  So two buttons sit beside the field, usable on every platform:
  - **"±"** toggles a leading `-` on the current text (adds it if absent, removes it if present);
  - **"×10ⁿ"** appends `e` if the text has no `e`/`E` yet (otherwise it does nothing). The player
    then types the exponent digits.
  - "±" only flips the *leading* sign, never the exponent's. A negative exponent (`1e-4`) can be
    typed only where the keyboard has `-` (desktop, Android). On iOS it isn't reachable; that's
    an accepted limit, since tiny classroom quantities can be typed as plain decimals
    (`0.0004`).
- **Accepted syntax** (after trimming):
  - the full regex is `^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$`;
  - so: an optional leading `-`, digits with an optional `.` (`.5` is allowed), and an optional
    exponent (`6.02e23`, `1E-3`).
  - **Commas are rejected**, because `1,000` vs `1,5` is ambiguous across locales. Error under the
    field: "Use digits and a dot, e.g. 0.62 or 6.02e23".
- Parsed with `Number(...)`; the result must be finite. The payload sends the **number**.
- Submit is disabled until the input parses. One submission per question, as for other types.
- **No prompt on the phone.** Following the existing convention
  (`player/src/pages/game/CLAUDE.md`), the prompt is shown only on the host's big screen; the
  phone shows the input, the unit, the two buttons and Submit.

**N6 — Displaying numbers.** One formatter, `formatNumber(n)`, in each frontend's `lib/numeric.ts`:

- `|n| ≥ 1e6`, or `0 < |n| < 1e-3` → `n.toExponential(3)` with trailing zeros stripped from the
  mantissa (`6.022e+23`, `1e-4` rather than `1.000e-4`);
- otherwise → `String(Number(n.toPrecision(6)))` (e.g. `0.62`, `343`, `2.33333`).
- The unit, when present, is appended with a space.
- **Display only.** `formatNumber` is never used to fill an editable field (Step 7).
- **Python mirror** for the HTML report: `numeric.format_number(n)` with the same two branches
  (`f"{n:.3e}"` with the mantissa zeros stripped; else `str(float(f"{n:.6g}"))`, dropping a
  trailing `.0`), and `numeric.with_unit(n, unit)`.

**N7 — What each screen shows.**

| Screen | Shows |
|---|---|
| Player question | Input with unit suffix, "±" and "×10ⁿ" buttons, Submit. No prompt (convention, N5) |
| Host question | Type label "Numeric Estimate" and the hint "🔢 Type your estimate on your phone" (like map_pin's hint) |
| Player results | "You: 0.58 · Answer: 0.62 · off by 0.04" and the points earned. "Spot on!" only when the client-computed verdict is full credit (see below); never "Correct!" for partial credit. COMPLETENESS: "Recorded" plus the answer |
| Host results | The answer (large), the five-bar chart (N3), and "N of M within full credit" |
| Player game over | Per-question card: your value, the answer, points |
| Host game over | The answer and unit, plus the **same five-bar chart** at card size. The generic option/True-False distribution is not shown for numeric |
| HTML report | Badge "Numeric", and a one-line summary **instead of** a bar chart (like map_pin): "Answer A · T guesses · F within full credit · median guess G · U under / O over", e.g. "Answer 0.62 · 24 guesses · 9 within full credit · median guess 0.58 · 11 under / 4 over". Numbers via `format_number`, the answer and median with the unit |

Definitions for the numbers above:

- **"Spot on!" on the player's phone.** The personalised `question_results` has `yourPoints` but
  no `isCorrect` (only `answer_received` has it, and the UI hides that).
  - The phone therefore computes the verdict itself: `|value − answer| ≤ full + eps`, using the
    reveal's tolerances and N2's rule (mode applied, same eps).
  - It needs the player's own value, which is held in memory. If that's missing (after a reload),
    show the answer and points with no verdict and no "off by".
- **"N of M within full credit"**: N = the `full` bucket count; M = the sum of all five buckets
  (= players who answered). Shown in both grading modes.
- **Report letters:** T = valid stored guesses; F = guesses whose `_extract_answer_key` bucket
  is `"full"` (not `is_correct`, which is always true under COMPLETENESS); U = `zero_low` +
  `partial_low`; O = `partial_high` + `zero_high`. Full-credit answers count in neither U nor O.
  The host screen's "N of M" uses the same F and T.
- **"Median guess"**: the median of valid stored values (the lower middle value when the count is
  even, as map_pin's report does). Omitted when there are 0 guesses.
- **"off by"**: `formatNumber(|value − answer|)` plus the unit. In percent mode, followed by the
  relative error to one decimal, e.g. "off by 17 m/s (5.0%)".
- **Empty chart** (0 answers): all bars at zero height, the counts show 0, and the text reads
  "No answers". No division by zero.

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
- **Parsing.** All four numeric fields are text inputs parsed with `parseNumber` (N5), so `e`
  notation works in the editor too. The admin app gets its own `lib/numeric.ts` with
  `parseNumber`, `formatNumber` and `withUnit`, the same as the host copy (the preview line
  needs formatting: 343 × 5% is `17.150000000000002`, shown as `17.15`).
- **Client checks** mirror N1. The server's 422 is still the real check, and admin's `toError`
  shows it.
- **Preview line** under the fields:
  - absolute: "Full credit within ±0.05; nothing beyond ±0.15";
  - percent: "Full credit within ±5% (±17.15 m/s); nothing beyond ±20% (±68.6 m/s)", with the
    absolute part computed from the typed answer and omitted while the answer is empty or 0.
  - This is how a teacher notices a tiny effective range near zero (§6).

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
- `validate(config, answer_data) -> str | None`: returns the first N1 error message (in N1's
  order), or `None`.
- `format_number(n) -> str` and `with_unit(n, unit) -> str`: the N6 Python mirror.
- `EPS_SCALE = 1e-9`, used as `eps = EPS_SCALE × max(1, |answer|)` in both `score_numeric` and
  `bucket`.

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
  Add `elif q.type == "numeric": chart = _render_numeric_summary(q, q_scores)` to the chart
  `if/elif` chain that already has `elif q.type == "map_pin": chart = _render_map_summary(...)`.
  The bucket keys are therefore never drawn as bars.

### Step 5 — Player app (`frontend/player/src`)

- `types/game.ts`, all four places a type appears (`player/src/types/CLAUDE.md`):
  1. `'numeric'` in `QuestionType`;
  2. `unit?: string` in the `config` type, in **both** `QuestionPayload.config` and
     `QuestionSummaryItem.config`;
  3. a `NumericReveal` interface matching Step 1's `reveal` exactly (`unit: string | null`),
     added to `PlayerAnswerReveal`;
  4. `value?: number` in `QuestionSummaryItem.playerAnswer`.
- `lib/numeric.ts` (new): `parseNumber(text): number | null` (N5), `formatNumber(n)` (N6),
  `withUnit(n, unit)`, and `isFullCredit(value, reveal)` (the N7 verdict, mirroring N2 with the
  same eps).
- `pages/game/QuestionPage.tsx`: the N5 input for `type === 'numeric'`; it submits
  `{ value: n }` through the existing `submit(...)`.
- `pages/game/ResultsPage.tsx`: a numeric branch per N7. It reads the player's value from the
  in-memory last answer, as the other types do. If it isn't available (after a reload), show only
  the answer and points.
- `pages/game/GameOverPage.tsx`: `describePlayerAnswer` branch per N7.

### Step 6 — Host app (`frontend/host/src`)

- `types/game.ts`: the same additions as the player app wherever the host has the matching
  types (`QuestionType`, the `config` types, `NumericReveal` in the reveal union).
- `lib/numeric.ts`: copy `parseNumber` / `formatNumber` / `withUnit` (apps share no code; the
  editor needs `parseNumber`).
- `components/NumericBuckets.tsx` (new): the five-bar chart from N3, with a `size` prop
  (`"large"` for results, `"card"` for game over). Both pages use it.
- `pages/game/QuestionPage.tsx`: the label `numeric: 'Numeric Estimate'` and the N7 hint.
- `pages/game/ResultsPage.tsx`: a numeric branch rendering the N3 chart.
  - Five bars in order: `zero_low`, `partial_low`, `full`, `partial_high`, `zero_high`.
  - Labels: "Way under", "Close (under)", "Spot on", "Close (over)", "Way over".
  - Bar heights are proportional to the counts, and each count is printed on its bar.
  - "Spot on" uses the success color, the partial bars a neutral color, and the zero bars a muted
    color.
  - Above the chart: the answer (`withUnit`), large. Below: "N of M within full credit".
  - Plain divs, no chart library, readable from the back of a classroom: bar labels at least 18px.
- `pages/game/GameOverPage.tsx`: the label; a `type === 'numeric'` branch showing the answer
  and `<NumericBuckets size="card">`. Its generic option distribution is skipped for numeric.
- `pages/manage/QuestionEditorPage.tsx`: N8 (Step 7's list).

### Step 7 — Question editors (admin and host, same changes in both)

In each `QuestionEditorPage.tsx`, following the map_pin branches:

- the `QuestionType` union;
- `FormState` fields (`numAnswer`, `numMode`, `numFull`, `numZero`, `numUnit`) with N8 defaults;
- `questionToForm` and `formToPayload` (`numeric` → `config: {unit?}`, `answer_data` per §2).
  `questionToForm` fills the numeric text fields with `String(n)`, which round-trips exactly
  (`0.123456789`, `6.02214076e+23`); **not** `formatNumber`, which would silently round on
  re-save;
- the `points_value` condition (numeric uses the form's points field, like map_pin);
- the type `<option>` "Numeric Estimate (type a number)";
- the form section;
- the list preview: absolute "≈ 0.62 (±0.05 / ±0.15)"; percent "≈ 343 m/s (±5% / ±20%)";
- the type label map.

### Step 8 — Simulator (`scripts/simulate_players.py`)

- Document `numeric` in the docstring.
- If `--game-json` provides `answer_data`: with probability `p.accuracy` (the existing
  per-profile field) a player answers `answer + gauss(0, full_eff / 2)`. Otherwise they answer
  uniformly in `[answer − 3·zero_eff, answer + 3·zero_eff]`. `full_eff` and `zero_eff` are the
  effective tolerances (N1).
- Without it: a uniform value in [−1, 1].

### Step 9 — Context docs

Update the CLAUDE.md files of every directory touched:

- `backend/app/services` (new module; the touch list now includes numeric);
- `backend/app/schemas` (shapes and payload `value`);
- `backend/app/websocket`;
- `frontend/{player,host}/src/{lib,types,pages/game}`;
- the admin and host `pages` editor notes. (If `frontend/host/src/pages/CLAUDE.md` is still the
  pre-T4 version on this branch, i.e. it says there is no game editor, take !8's version when
  rebasing rather than editing it here.)

### Files touched

| File | Change |
|---|---|
| `backend/app/services/numeric.py` | **new** |
| `backend/app/schemas/admin.py` | regex ×2, validator |
| `backend/app/services/game_service.py` | score, distribution, both summaries |
| `backend/app/services/report_service.py` | reveal, key, badge, summary line |
| `backend/app/websocket/gateway.py` | reveal, payload check |
| `frontend/player/src/types/game.ts`, `lib/numeric.ts` (**new**), `pages/game/{Question,Results,GameOver}Page.tsx` | N5–N7 |
| `frontend/host/src/types/game.ts`, `lib/numeric.ts` (**new**), `components/NumericBuckets.tsx` (**new**), `pages/game/{Question,Results,GameOver}Page.tsx`, `pages/manage/QuestionEditorPage.tsx` | N3, N7, N8 |
| `frontend/admin/src/lib/numeric.ts` (**new**: `parseNumber`, `formatNumber`, `withUnit`), `pages/QuestionEditorPage.tsx` | N8 |
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
5. Invalid values (`None`, `"0.6"`, `True`, NaN, Infinity, `10**400`) → 0, no exception; the
   same values make `is_finite_number` false.
8. `format_number`: `0.1 + 0.2` → `"0.3"`; `6.02214076e23` → `"6.022e+23"`; `0.0001` →
   `"1e-04"` (Python's exponent keeps two digits; the TS `formatNumber` gives `"1e-4"`, and the
   difference is only cosmetic); `343.0` → `"343"`.
6. Rounding to 2 decimals.
7. `numeric.validate`: each N1 rule produces its exact N1 message; when two rules fail, the
   earlier one's message wins; a valid absolute and a valid percent question → `None`.

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
   an `error` event and no `answer_received`. The same guest then sends a valid `{value: 0.62}`
   and gets `answer_received` with full points (N4: rejected payloads don't use up the answer).
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
   - **on an iPhone (or Safari's iOS simulator):** a negative value can be entered with "±",
     and `6.02e23` with "×10ⁿ";
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
- **Edited tolerances re-bucket old sessions.** Summaries and the report recompute buckets from
  the question's *current* `answer_data`, so editing tolerances after a session (allowed when no
  game is live) makes that session's chart disagree with its stored points. This is the existing
  "exports read the current questions" limit (T4 host design D5); stored points never change.
- **Reload loses "your answer"** on the player results screen. That's existing behavior for all
  types (`player/src/pages/game/CLAUDE.md`).

---

## 7. Goldfish revision log

Round 1: a fresh Claude Code session given only this doc and the context hierarchy. Its claims
were checked against the code before acting on them.

| ID | Finding | Resolution |
|---|---|---|
| A | Branch was cut from `main`, which has no map_pin code, so every "next to map_pin" anchor pointed at nothing | Branch rebased onto `feature/t7-map-question`; header states it's stacked on !6 |
| B | Host GameOver would show bucket keys through the generic distribution | Shared `NumericBuckets` chart at card size; generic distribution skipped (N7, Step 6) |
| C | HTML report might draw bucket keys as bars | The numeric summary line replaces the chart, via the same `elif` chain as map_pin (Step 4) |
| D | A malformed payload might use up the player's one answer | Checked: "already answered" is only read before the type check and set in `record_answer`, after it, so it doesn't. Placement stated in N4; test 3 extended |
| E | Validation messages unspecified; unknown keys / missing config unclear | Exact messages in check order; extra keys ignored; config defaults to `{}` (N1) |
| F | Player types list incomplete (config, summary item, player answer) | All four places listed for both apps (Steps 5–6) |
| G | The player's `question_results` has no `isCorrect` | The verdict is computed client-side from the reveal with N2's rule; omitted after a reload (N7, `isFullCredit`) |
| H | Numbers undefined: M, under/over, COMPLETENESS charting, "off by" in percent mode, editor preview, empty chart | Defined in N7, N3 and N8 |
| I | Simulator accuracy source, editor field parsing | `p.accuracy` named; editors use `parseNumber`; admin gets `lib/numeric.ts` (Steps 7–8) |

### Round 2

A second fresh Claude Code session, given the round-1 revision. Claims about the code were
verified (the phone never shows the prompt; `10**400` raises `OverflowError` in float arithmetic
and in `math.isfinite`).

| ID | Finding | Resolution |
|---|---|---|
| R1 | iOS decimal keypad has no `-` or `e`: negative correlations and `6.02e23` can't be typed | "±" and "×10ⁿ" buttons beside the field (N5); iOS manual check added. Negative exponents need the full keyboard (accepted limit) |
| R2 | Report number formatting unspecified in Python | `numeric.format_number` / `with_unit` mirror N6 (N6, Step 1) |
| R3 | Report letters swapped vs host; "within full credit" source unstated | Report line uses T/F/G/U/O; F = bucket `"full"`, not `is_correct` (N7) |
| R4 | Editor re-save could round stored numbers | `questionToForm` uses `String(n)`; `formatNumber` is display only (Step 7, N6) |
| R5 | Admin preview needs formatting, but admin lib was "parseNumber only" | Admin `lib/numeric.ts` gets the formatter too (N8, files table) |
| R6 | Huge JSON integers pass the "finite" check and then raise | Finite = `math.isfinite(float(v))` succeeds; overflow means not finite; unit test adds `10**400` (N1) |
| R7 | Spec showed the prompt on the phone, against convention | No prompt on the phone (N5, N7) |
| R8 | Percent-mode list preview missing | Added (Step 7) |
| R9 | Edited tolerances re-bucket old sessions | Known limit (§6) |
| R10 | `1.000e-4` trailing zeros | Mantissa zeros stripped (N6) |
