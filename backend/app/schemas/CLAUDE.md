# backend/app/schemas/

## Purpose
Pydantic v2 models for API request validation and response shapes — the contract between the
REST routers and the three frontends. Grouped by router.

## Contents
- `__init__.py` — empty.
- `auth.py` — `LoginRequest` (username+password, or `netid` as a dev-only fallback), token
  responses (`TokenResponse`, `TempTokenResponse` for onboarding, `RefreshResponse`), and
  `GuestJoinRequest` (display name + email + room code).
- `game.py` — host/player-facing shapes: `QuestionPublic` (a question **without**
  `answer_data`/`grading_type`), `RoomCreateRequest`/`Response`, `RoomInfoResponse`,
  `ActiveSessionItem`, `MyCourseItem`/`MyGameItem` for the host's pickers, internal
  `ScoreResult`, and the `/api/host` shapes: `HostGameCreate`/`HostGameUpdate` (no
  `course_id` — the course comes from the URL and never changes), `HostRosterActivePatch`,
  `HostSessionItem`.
- `admin.py` — admin CRUD shapes: courses, roster (upload result, row patch, JSON import),
  games, questions (`QuestionCreate`/`QuestionUpdate`/`QuestionResponse`/`QuestionReorder`),
  local users, course/game access grants, `CourseAccessEntry` (per-course access list),
  admin session listings, and `ImageResponse` (T8: image metadata + `used_by` question
  positions, never the bytes).

## How it fits in
Routers declare these as request bodies and `response_model`s; FastAPI returns 422 on
validation failure (formatted by `common/exceptions.py`). The per-type question structure —
what `config` and `answer_data` must contain — is defined only here, in
`QuestionCreate.validate_structure`. The game JSON importer reuses `QuestionCreate`, so the
file format and the API share one validator.

## Gotchas
- **`QuestionUpdate` has no structural validator of its own.** The check happens in
  `services/question_service.update`, which merges the update onto the stored question and
  re-runs `QuestionCreate` (422 on failure). New question types (T7) only need validation in
  `QuestionCreate.validate_structure`.
- `map_pin` (T7): `config.aspectRatio` > 0 is required; `answer_data` needs `target {x, y}` in
  [0, 1] and `0 ≤ fullRadius < zeroRadius ≤ 1` for **both** grading types. Player payload
  `{point: {x, y}}`. See `services/map_pin.py` and `docs/design-t7-map-question.md`.
- `numeric` (T7): `config.unit` optional (string ≤ 20); `answer_data` needs a finite `answer`,
  `toleranceMode` `absolute`|`percent`, and `0 ≤ fullTolerance < zeroTolerance`; percent mode
  needs `answer ≠ 0`. Required for **both** grading types. Player payload `{value: n}`. The
  checks and their exact messages live in `services/numeric.validate`
  (`docs/design-t7-numeric.md`).
- **Image keys (T8)** in `config`, any type: `imageId` (prompt), `optionImages` (MC/multi-select
  only, same length as `options`, entries id or null) and `mapImageId` (`map_pin` only). The
  validator checks only their **shape** (`services/image_refs.shape_error`); that the images
  belong to the same game needs the DB and is checked in `question_service`.
- The allowed question types are a regex **duplicated** in `QuestionCreate.type` and
  `QuestionUpdate.type`. Adding a type means editing both, plus the validator.
- Key naming is inconsistent by type and must be matched exactly: multiple_choice /
  multi_select / true_false use `answer_points` (snake_case); fill_in_the_blank uses
  `acceptedAnswers`, `answerPoints`, `editDistance` (camelCase).
- `extra="forbid"` is on most request models: unknown fields are a 422, not ignored.
- `QuestionPublic` is defined but **not used anywhere**. The real player-facing question
  shape is `websocket/gateway.py` `_question_payload`, which *does* include `gradingType` and
  (for fill-in-the-blank) `editDistance` from `answer_data` — despite the "never exposed"
  comment in `game.py`. Never return `QuestionResponse` to players; it contains answers.
- The answer payload players send is not defined here either; it's implicit in
  `game_service.calculate_score`: `selectedIndex` (multiple_choice), `selectedValue`
  (true_false), `text` (fill_in_the_blank), `selectedIndices` (multi_select), `point`
  (map_pin), `value` (numeric).
- `UserUpdate.role` only allows `USER`/`ADMIN`; `GUEST` is created by the guest-join flow only.
