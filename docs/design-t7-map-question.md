# Design: T7 Map Pin Question Type (`map_pin`)

**Owner:** Bill Zhang (yyzhang). This is one of the two T7 types. Jack Mayerhofer owns the
other one (non-Canvas, classroom style); it is out of scope here.
**Status:** Revised after Goldfish test (fresh session `buzzer-72-a6`, 2026-10-03). The
pre-Goldfish draft is commit `c9faa4d`. See *§8 Goldfish revision log*.
**Builds on:** `docs/design-t4-host.md`. The branch `feature/t7-map-question` is stacked on
`feature/t4-host` and uses its `services/question_service.py` and host question editor.
**Context docs:** backend `backend/app/**/CLAUDE.md`. For the frontend, `frontend/*/src/**/CLAUDE.md`
from Jack's MR !3 (read them from `origin/docs/t3-frontend-context` until it merges).

---

## 1. Problem

T7 (see `instructions.md`) requires two new question types. Each one is a full vertical slice:
- schema/validation;
- scoring;
- the player, host and admin UIs;
- import/export;
- tests and sample games.

One type must use an **HTML Canvas** as the player's interaction surface; one suits a
classroom and the other a party.

This type is the **Canvas, party** one: *"Where on the map?"* The host's screen shows a clue,
for example "Where is the Camp Nou?". Each player taps a spot on a world map on their phone.
The closer the tap is to the target, the more points. This is the model of MapTap and
GeoGuessr: the interaction *is* the geography.

Constraints from the codebase:
- **Players never see the prompt on their phone.** The host's big screen shows it, and the
  phone shows only answer controls (`frontend/player/src/pages/game/CLAUDE.md`).
- **`config` is sent verbatim to every player** in `new_question`
  (`backend/app/websocket/CLAUDE.md`). Anything secret, such as the target, must be in
  `answer_data`.
- **Per-type answer logic is copied in many places** (`backend/app/CLAUDE.md`, "Adding a
  question type"). This doc lists every one of them.
- **No image upload yet.** T8 (images) is not built.

## 2. Technical Plan (summary)

- **Type id:** `map_pin`, label "Map Pin". Grading: ACCURACY (distance-based) or COMPLETENESS.
- **Coordinates:** a point is `{x, y}`, fractions of the map *image* in [0, 1] with the origin
  at the top left. It is independent of screen size.
- **Shapes:**
  - `config`: `{"aspectRatio": 2}`. Later T8 may add an image reference; absent means the
    built-in world map.
  - `answer_data`: `{"target": {"x": .., "y": ..}, "fullRadius": .., "zeroRadius": ..}`. The
    radii are fractions of the image width.
  - Player payload: `{"point": {"x": .., "y": ..}}`.
- **Scoring:** linear falloff between two radii.
- **Map:** one bundled, public-domain equirectangular world map image. T8 can later supply a
  per-question image without changing answers or scoring.
- **Results:** the big screen shows the map with the target, the full-credit circle and every
  guess (bucketed into grid cells, reusing the existing answer-distribution counter). Each
  phone shows the player's pin vs the target and their distance.

### Design decisions

**D1 — Built-in world map now; T8 can swap the image later.**
- The image is equirectangular, 2:1, rendered once from Natural Earth 110m land data, which
  is public domain.
- It is committed as `world-map.svg` in each app's `public/` folder. (Changed from PNG during
  implementation: an SVG is smaller, needs no imaging library to render, and canvas
  `drawImage` accepts it.)
- Coordinates are image fractions, so a future uploaded map (a campus, a floor plan) needs no
  scoring change.

**D2 — Linear falloff between two radii, set per question.**
- **Distance**, in image-width units: `d = sqrt(dx² + (dy / aspect)²)`, where
  `aspect = config.aspectRatio` (width / height; 2 for the world map). Dividing `dy` by the
  aspect ratio puts both axes in the same unit.
- **Points:**
  - `d ≤ fullRadius` → `points_value`;
  - `d ≥ zeroRadius` → `0`;
  - otherwise `points_value × (zeroRadius − d) / (zeroRadius − fullRadius)`.
- **`is_correct`** = `d ≤ fullRadius`.
- **Rounding:** points are rounded to 2 decimals, so leaderboards never show 37.48219.
- **One numeric check, used three times.** `is_unit_point(p)` lives in
  `backend/app/services/map_pin.py`. It accepts a dict whose `x` and `y` are `int`/`float`
  but **not `bool`** (`isinstance(True, int)` is true in Python), finite, and in [0, 1]. The
  schema validator, the gateway check and `calculate_score` all call it. The scoring function
  `score_map_pin(...)` and the grid key `map_pin_cell(point)` live in the same module.
- **COMPLETENESS:** any valid point earns `points_value`, matching existing types.
- **Editor defaults:** `fullRadius = 0.02`, `zeroRadius = 0.15`.
- **Known limit:** on an equirectangular map, image distance isn't kilometers; east–west
  distances near the poles are exaggerated. That's acceptable for a party game.

**D3 — The reveal shows every guess on the map.**
- `record_answer` maps each guess to a grid-cell key `f"{round(x*200)}:{round(y*100)}"` (cells
  of 0.5% of width and 1% of height). It counts the key with the existing
  `state.increment_answer_dist`.
- The host already receives that hash as `answer_dist` in `question_results`.
- The host results page draws a dot per cell, sized by count with a capped size, plus the
  target pin and the full-credit circle.

**D4 — Phone interaction: tap to place, tap again to move, then Submit.**
- A real `<canvas>`, sized to the container width at the image's aspect ratio and redrawn on
  resize.
- Pointer events, which cover touch and mouse, are converted to image fractions using
  `getBoundingClientRect()`. The canvas backing store is scaled by `devicePixelRatio`.
- Submit stays disabled until a pin exists. No zoom in v1.

**D5 — Admin editing is a small, isolated change by Bill.**
- One self-contained `MapPicker.tsx` component (canvas, click to set the target, radius
  circles preview) is copied into the host and admin apps.
- Admin `QuestionEditorPage.tsx` gets only:
  - the type option;
  - form fields;
  - one `questionToForm` / `formToPayload` branch;
  - one form branch;
  - one list-preview branch.
- Jack is told exactly which lines changed.

## 3. Alternatives considered

| Decision | Alternative | Why rejected |
|---|---|---|
| D1 | Wait for T8 and require an uploaded image | T7 couldn't be finished or tested until T8 exists; too risky this close to the deadline. |
| D1 | Latitude/longitude with kilometer scoring | Locks the type to world maps, and makes T8's "image on a canvas question" harder. |
| D2 | Fixed tiers (full within 5%, half within 10%) | Score cliffs, and difficulty can't be tuned per question. |
| D2 | Smooth exponential decay | Never exactly 0, "correct" is fuzzy, and it's harder to explain. |
| D3 | Only the target plus stats on the big screen | Loses the fun of seeing everyone's guesses; party value is the point of this type. |
| D3 | Store exact points in a new Redis structure | New storage and cleanup paths. Grid cells reuse the existing counter. |
| D4 | First tap submits | Fat-finger taps can't be undone. |
| D4 | Zoom/pan | Real complexity (touch math); generous default radii compensate. Future work. |
| D5 | Jack wires admin | Shifts Bill's T7 work onto Jack and depends on his availability. |
| D5 | Admin only via JSON import | Arguably fails "Admin interface: creating and editing questions of the new type". |

## 4. Detailed implementation

### Step 1 — Validation (`backend/app/schemas/admin.py`)
- Add `map_pin` to the type regex in **both** `QuestionCreate.type` and `QuestionUpdate.type`.
- In `QuestionCreate.validate_structure`, add a `map_pin` branch:
  - `config.aspectRatio`, if present, must be a number > 0.
  - **Both ACCURACY and COMPLETENESS** (Goldfish B): `answer_data.target` must satisfy
    `is_unit_point`. `fullRadius` and `zeroRadius` are non-bool numbers with
    `0 ≤ fullRadius < zeroRadius ≤ 1`. Anything else raises `ValueError` with a clear message.
    A target is always present, so every reveal can draw it. For COMPLETENESS the target is
    shown, but scoring ignores distance.
  - `config.aspectRatio` is required, and the editors always write it (Goldfish I; 2 for the
    world map). The frontend sizes the canvas from `config.aspectRatio`, never from the image's
    natural size, so drawing and scoring can't disagree.
- Updates are covered automatically: `question_service.update` re-validates the merged
  question with `QuestionCreate` (T4 D7).

### Step 2 — Scoring and distribution (`backend/app/services/game_service.py`)
- **`calculate_score`:** a `map_pin` branch implementing D2.
  - The player's `answer_data.point` must be a dict with numeric `x`, `y` in [0, 1].
  - Otherwise return 0 / not correct. Never raise.
  - Read `aspectRatio` with `config.get("aspectRatio", 2)`.
- **`record_answer`:** for `map_pin`, `dist_key` is the D3 grid key.
- **Summaries:** `get_player_question_summary` and `get_host_question_summary` use the reveal
  below as `answerReveal`. The player's `playerAnswer` is their stored answer, unchanged:
  `{"point": {"x": .., "y": ..}}`. **Distance is not sent.** Both frontends compute it with
  the same formula from `point`, `target` and `aspectRatio` (helper `mapDistance` in each
  app's `lib/mapPin.ts`). The server sends points; the client only displays distance.

### Step 3 — Gateway (`backend/app/websocket/gateway.py`)
- **`on_submit_answer`:** before scoring, for `map_pin` require `answer_data.point` with
  numeric `x`, `y` in [0, 1]. Otherwise `_emit_error(sid, "map_pin answer must include
  point {x, y} in [0, 1]")` and return, as the `multi_select` check does.
- **`_answer_reveal`:** a `map_pin` branch, placed **before** the existing
  `if q.grading_type == "COMPLETENESS": return {"type": "completeness"}` early return, so
  participation map questions still reveal the target. It returns exactly:
  ```json
  {"type": "map_pin", "target": {"x": 0.512, "y": 0.281},
   "fullRadius": 0.02, "zeroRadius": 0.15, "aspectRatio": 2}
  ```
  The same object is the `answerReveal` in both summaries, and in `report_service`'s copy.
  `types/game.ts` in the player and host apps gets a matching
  `MapPinReveal { type: 'map_pin'; target: {x: number; y: number}; fullRadius: number;
  zeroRadius: number; aspectRatio: number }`. The answer type is
  `MapPinAnswer { point: {x: number; y: number} }`.

### Step 4 — HTML report (`backend/app/services/report_service.py`)
- **`_answer_reveal`, `_extract_answer_key`** (return the grid key) and the type badge
  ("Map Pin").
- **Per-question section: a text summary only** (Goldfish D). The backend can't see the
  frontend's map image, and a second copy of the image isn't worth it. The summary reads: "Target
  (51.2%, 28.1%) · N guesses · M within full credit · median distance P% of map width".

### Step 5 — Map asset
- `scripts/render_world_map.py` (one-off; dependencies only in the dev venv):
  1. Download Natural Earth `ne_110m_land.geojson`, which is public domain.
  2. Project equirectangular, with `x = (lon + 180) / 360` and `y = (90 − lat) / 180`.
  3. Draw land on a light-blue ocean at 1200×600.
  4. Save `world-map.svg`. `--geojson PATH` reads a local copy when downloading fails.
- The header comment names the source and states the license (public domain).
- Commit the SVG to `frontend/{player,host,admin}/public/world-map.svg`. Apps reference it as
  `${import.meta.env.BASE_URL}world-map.svg`.

### Step 6 — Player app (`frontend/player/src`)
- `types/game.ts`: add `map_pin` to the type union and the `point` answer shape.
- `components/MapCanvas.tsx` (new): props `point`, `onPoint?`, `target?`, `fullRadius?` and
  `readOnly`. It owns the D4 canvas logic and the drawing.
- `pages/game/QuestionPage.tsx`: a `map_pin` branch renders `MapCanvas` plus a Submit button,
  then `emitAnswer({point})`.
- `pages/game/ResultsPage.tsx`: show `MapCanvas` read-only with your point and the target.
  **No Correct/Incorrect verdict** (Goldfish F; the generic branch treats any points > 0 as
  correct). Show "You were 4.2% of the map away · +63 pts", and "Bullseye!" only when
  `isCorrect`. For COMPLETENESS: "Thanks for playing · +N pts".
- `MapCanvas` draws only after the map image's `onload`. It redraws on load, on resize and
  on prop changes.
- `pages/game/GameOverPage.tsx`: `map_pin` branches in `describePlayerAnswer` and in the reveal
  text.

### Step 7 — Host app (`frontend/host/src`)
- `types/game.ts`: the type union and the reveal shape.
- `pages/game/QuestionPage.tsx`: for `map_pin`, show the prompt plus "Tap the map on your
  phone". No map, so the answer isn't hinted.
- `pages/game/ResultsPage.tsx`: for `map_pin`, a large canvas with the world map, guess dots
  from `answer_dist` keys (`"cx:cy"` → `(cx/200, cy/100)`), the target pin and the full-credit
  circle.
- `pages/game/GameOverPage.tsx`: for `map_pin`, the per-question card shows a **small map**
  (the same canvas component as results) with the target and guess dots, instead of the bar
  chart that would otherwise render dozens of `"113:42"` bars (Goldfish E).
- Every `typeLabel` / badge map in the host and player pages gains `map_pin: 'Map'`.
- `components/MapPicker.tsx` (new): click to set the target, number inputs for the radii, and
  circles drawn live.
- `pages/manage/QuestionEditorPage.tsx`:
  - the `map_pin` option;
  - `FormState` fields `mapTarget`, `mapFullRadius` and `mapZeroRadius`;
  - `questionToForm` / `formToPayload` branches. Today's form shows a "Points value" input
    only for COMPLETENESS. For `map_pin` it must show it for **ACCURACY too**, since map
    points don't come from per-option values (Goldfish C). The default is 1, matching other
    types. The `map_pin` branch in `formToPayload` is explicit, and the host copy already
    throws on unknown types (T4 D6). In the **admin** copy the final `else` still falls
    through to fill-in-the-blank, so the `map_pin` branch must sit **before** that `else`;
  - a form branch with `MapPicker`;
  - a list preview line.

### Step 8 — Admin app (`frontend/admin/src`)
- Copy `components/MapPicker.tsx`. Make the same five editor additions as in Step 7, in admin
  `pages/QuestionEditorPage.tsx`. Record the exact lines in the MR description, for Jack.

### Step 9 — Simulator (`scripts/simulate_players.py`)
- In `_make_answer`, for `map_pin`, return a random point. With `--game-json` (an existing
  option), fast and normal players aim near `answer_data.target`.

### Step 10 — Sample games (T6)
- Add 2–3 `map_pin` questions to `sample_games/yyzhang_football_party.json`, for example
  stadium locations. This happens on `feature/t6-yyzhang-games` after this branch merges.
- Files stay `"version": 1`, because a new type value doesn't break old files.

### Step 11 — Context docs
- Update `backend/app/{schemas,services,websocket}/CLAUDE.md` and `backend/app/CLAUDE.md` for
  the new type.
- After !3 merges, update the frontend `CLAUDE.md` files for the player, host and admin pages
  touched.

### Step 12 — Tests (T5)
- **Unit** (`tests/unit/test_map_pin.py`, run with `PYTHONPATH=backend`), for `calculate_score`:
  - inside `fullRadius` → full;
  - exactly `zeroRadius` → 0;
  - midway → half (±0.01);
  - a pure-y offset of 0.05 on a 2:1 map scores like `d = 0.025`;
  - COMPLETENESS → full;
  - a missing, non-numeric, boolean or out-of-range point → 0, with no exception;
  - points are rounded to 2 decimals.
- **Integration** (`tests/integration/test_map_pin.py`):
  1. Host API: create a valid `map_pin` → 201. `fullRadius ≥ zeroRadius` → 422. A target with
     x > 1 → 422. An update that breaks the radii → 422, and the stored question is unchanged.
  2. Play over Socket.IO with three guests:
     - on target → `pointsAwarded == points_value`;
     - midway → about half;
     - beyond `zeroRadius` → 0;
     - the host's `question_results` `answer_dist` contains the three grid keys.
  3. A guest sends `{point: {x: 2, y: 0.5}}`, then `{point: {x: true, y: 0}}` → an `error`
     event each time, no `answer_received`, and the CSV export shows no score for that guest.
  4. Import/export round trip (Goldfish H): import a game JSON containing a `map_pin` question
     through `POST /api/admin/games/import`, export it, and assert that the question's
     `config` and `answer_data` are unchanged.

## 5. Coordination (Jack)
- **Split:** Jack owns the other T7 type (non-Canvas, classroom).
- **Admin editor:** this work touches `frontend/admin/src/pages/QuestionEditorPage.tsx` (five
  small, additive branches) and adds `frontend/admin/src/components/MapPicker.tsx`.

## 6. Out of scope / future work
- Zoom/pan.
- Per-question uploaded maps (T8 will add the image reference).
- Kilometer-accurate scoring.
- Showing exact (unbucketed) guesses.

## 7. Verification
- CI parity:
  - `ruff check` / `ruff format --check` on `backend/` and `scripts/`;
  - `tsc --noEmit` in all three apps.
- Tests: `pytest tests/integration` (plus `--fast`), and
  `PYTHONPATH=backend pytest tests/unit`.
- Manual:
  1. In the host editor, create a map question by clicking Barcelona.
  2. Start a room. Run `simulate_players.py --game-json …` and also join on a phone (or a
     narrow browser) at `localhost:8080/player/`.
  3. Tap and submit, then check the big-screen dots and the phone result.
  4. Download the HTML summary.


## 8. Goldfish revision log

Goldfish test run on 2026-10-03 by a fresh Claude Code session (`buzzer-72-a6`). It was given
only this doc (pre-Goldfish commit `c9faa4d`) plus the context docs, and no source. Its
verdict: *mostly ready, but A–F would force questions during implementation*.

| # | Finding | Resolution |
|---|---|---|
| A | Reveal/summary JSON shapes not pinned; hand-written TS types can drift | Exact `answerReveal` JSON and TS types given. `playerAnswer` = stored `{point}`; distance computed client-side (Steps 2–3). |
| B | COMPLETENESS questions might lack a target, breaking every reveal | Target required for both grading types. The reveal branch runs before the COMPLETENESS early return (Steps 1, 3). |
| C | Editor has no points input for ACCURACY; admin `formToPayload` falls through to FITB | Points input shown for `map_pin` ACCURACY. The branch goes before admin's `else` (Step 7). |
| D | Backend can't read the frontend PNG for the report | Report uses a text summary only (Step 4). |
| E | Host Game Over would draw grid keys as bars | Map card with target and dots (Step 7). |
| F | Player results call any partial score "Correct!" | Distance + points, no verdict; "Bullseye!" only if `isCorrect` (Step 6). |
| G | `bool` passes numeric checks; three validators could drift | One `is_unit_point` helper in `services/map_pin.py`, used by the schema, gateway and scoring (D2). |
| H | Import/export only implicit | Round-trip integration test (Step 12). |
| I | `aspectRatio` source ambiguous | Required in `config`; editors always write it; the frontend reads only `config` (Step 1). |
| J | Rounding, type labels, image `onload`, simulator flag | 2-decimal rounding (D2); `typeLabel` entries (Step 7); draw after `onload` (Step 6); `--game-json` confirmed to exist (Step 9). |
