# Design: T8 Image Support in Questions

**Owner:** Bill Zhang (yyzhang). T9 (theming) is Jack's. This doc follows the T3/T4 process:
design doc commit → Goldfish test in a fresh session → revision commit → implementation.
Branch: `feature/t8-images`, from main after T4, `map_pin` (T7, Bill) and `numeric` (T7, Jack)
merged.

## 1. Problem

`instructions.md` T8: upload images and use them in questions, **stored in the database** (not
on disk or in a file store). Required:

| # | Requirement | Where this doc covers it |
|---|---|---|
| R1 | Upload through the admin **or** host interface, stored in the DB | D1, Steps 1–3, 6 |
| R2 | An image in a question prompt, alongside text | D3, Step 6 |
| R3 | An image as a question option | D4, Step 6 |
| R4 | Images on a Canvas question (T7), e.g. click a region of an image | D7, Step 6 |
| R5 | View, replace and delete through the interface | D5, Step 6 |

Facts about the current code that constrain the design:
- Nothing image-related exists. Prompts are sanitized with `bleach` (only `b/i/br/u`), so an
  `<img>` in a prompt is silently stripped. Image references must not live in the prompt.
- `Question.config` is free-form JSON, **sent to every player** at question start
  (`websocket/CLAUDE.md`). `answer_data` is never sent. Image ids in `config` are therefore
  visible to players. That is acceptable, because an image is never the answer key.
- Players never see the prompt on their phone (player `pages/game/CLAUDE.md`). The host's big
  screen shows it.
- nginx (`nginx/nginx.dev.conf`) sets no `client_max_body_size`, so the default 1 MB applies.
- No image library is installed (`backend/requirements.txt` has no Pillow).
- Game JSON import/export is admin-only (`routers/admin.py`), and accepts only `"version": 1`.
- `map_pin` (docs/design-t7-map-question.md) stores coordinates as fractions of the image, and
  sizes its canvas from `config.aspectRatio`. `MapCanvas` loads one module-level
  `world-map.svg`.
- `question_service` (T4) holds the shared create/update/delete rules for the admin and host
  question routes, including `_assert_no_live_session` (409 while a room is live).

## 2. Technical Plan (summary)

A new table `question_images` holds image bytes, owned by a **game**. Whoever may edit the game's
questions may manage its images, through new host and admin routes that share one
`image_service`. A public route `GET /api/images/{id}` serves the bytes under an unguessable id,
so a plain `<img src>` works for guests on phones. Questions refer to images by id in three
`config` keys: `imageId` (prompt), `optionImages` (options) and `mapImageId` (map_pin
background). The server checks that every referenced image belongs to the same game. Game
export embeds the images (format version 2); import accepts versions 1 and 2.

### Design decisions

**D1 — Images belong to a game.** Table `question_images`:

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(32)` PK | `secrets.token_hex(16)`, 128 random bits |
| `game_id` | `INT` FK → `games.id`, `ON DELETE CASCADE`, indexed | owner |
| `filename` | `VARCHAR(255)` | the uploaded name, for display only |
| `mime` | `VARCHAR(32)` | from the **detected** format, never the client header |
| `data` | `MEDIUMBLOB` (16 MB max) | the bytes |
| `size_bytes`, `width`, `height` | `INT` | from Pillow |
| `sha256` | `CHAR(64)` | the ETag; changes on replace |
| `created_at`, `updated_at` | `DATETIME` | |

- Access: host routes call `game_service.assert_host_can_manage_game` (the same check as the
  host question routes). Admin routes are `require_admin`. The public GET has no auth (D2).
- Deleting a game deletes its images through the FK cascade. `delete_game` needs no change,
  because it ends in `db.delete(game)`.
- Self-critique:
  - The same picture used in two games is stored twice. That's acceptable at classroom scale,
    and it keeps export, import and delete simple.
  - The alternative was a per-course library (§3).

**D2 — Public, unguessable URL.** `GET /api/images/{id}`, no authentication.
- 200 response headers:
  - `Content-Type: <mime>`;
  - `ETag: "<sha256>"`;
  - `Cache-Control: no-cache` (the browser keeps a copy but revalidates every time, so a
    replaced image shows at once);
  - `X-Content-Type-Options: nosniff`.
- A request with `If-None-Match` equal to the ETag gets 304 with no body.
- An unknown id gets 404.
- Self-critique:
  - Anyone holding the link can view the image without logging in. Ids are 128-bit random and
    only reach people who can see the question, so this is acceptable for quiz images.
  - Requiring auth would mean fetching every image as a blob with a Bearer header in three apps
    and on the canvas (§3).

**D3 — The prompt image shows on the host big screen only.** It appears above the prompt on
host `QuestionPage` and `ResultsPage`. It does not appear on the phone, which matches the
existing "no prompt on the phone" convention.
- Self-critique: small details in a photo may be hard to read from the back of a room. The
  editor hint says "use large, clear images".

**D4 — Option images: an image plus a required short text.** This applies to
`multiple_choice` and `multi_select` only. `true_false`, `fill_in_the_blank`, `map_pin` and
`numeric` have no options to attach images to.
- `config.optionImages` is a list the same length as `config.options`. Each entry is an image
  id or `null`. Option text stays required, as today.
- Reports, CSV, the results bars and the answer reveal keep using the text, unchanged. The text
  is also the image's `alt`.
- Phone: when any option has an image, the options render as a 2-column grid of tiles (image on
  top, text below), and selection works exactly as now.
- Host results: a thumbnail appears next to each option's bar.
- Self-critique: four tiles on a 360 px phone are about 160 px wide. The editor hint says "use
  simple, high-contrast images".

**D5 — Management rules (view, replace, delete).**
- **Upload:** always allowed, even during a live room, since a new image affects no question.
- **Replace** keeps the id and swaps the bytes, so every question using the image updates
  (the sha256 and ETag change).
  - It is refused with **409** while the game has a live room (`assert_no_live_session`).
  - It is also refused with **409** when a `map_pin` question uses the image as its map and the
    new image's aspect ratio differs by more than 1%. The target coordinates are image
    fractions, so a different shape would move the answer.
  - Otherwise the replace succeeds. Each `map_pin` question using the image gets its
    `config.aspectRatio` rewritten to the new exact ratio.
- **Delete:**
  - refused with **409** while the game has a live room;
  - refused with **409** while any question references the image. The message lists the
    questions as 1-based positions: `Image is used by question(s) 2, 5`.
  - The editor shows the same "used by" list on each image, so the host knows what to change
    first.
- Self-critique: auto-removing references on delete was rejected (§3), because a `map_pin`
  question that loses its map would silently move its target onto the world map.

**D6 — Export embeds images (format version 2); import accepts 1 and 2.**
- A game **with at least one image** exports as `"version": 2`, with a top-level `images` array.
  Inside question configs, ids are replaced by the image's `ref`. A game without images
  still exports `"version": 1`, byte-identical to today's output.
- Import accepts `"version": 1` (unchanged) and `"version": 2`. For version 2:
  1. decode and validate every image (D8 rules; the first bad one → 422
     `Image <ref> invalid: <reason>`);
  2. create the game, then the images, mapping each `ref` → new id;
  3. replace refs in each question's config (an unknown ref → 422 `Question <n> uses unknown
     image ref <ref>`);
  4. validate the question with `QuestionCreate` as today;
  5. apply the `map_pin` aspect fill (D7).

Version 2 file shape:

```json
{
  "format": "buzzer/game",
  "version": 2,
  "game": { "title": "…", "description": "…", "max_players": 150 },
  "images": [
    { "ref": "img1", "filename": "campus.png", "mime": "image/png", "data": "<base64>" }
  ],
  "questions": [
    { "type": "map_pin", "grading_type": "ACCURACY", "prompt": "Where is the library?",
      "config": { "aspectRatio": 1.5, "mapImageId": "img1" },
      "answer_data": { "target": { "x": 0.4, "y": 0.6 }, "fullRadius": 0.03, "zeroRadius": 0.2 },
      "time_limit_seconds": 30, "points_value": 1.0 }
  ]
}
```

- `ref` matches `^[A-Za-z0-9_-]{1,32}$` and is unique within the file. Export uses `img1`,
  `img2`, … in upload order.
- Self-critique:
  - A file with several 2 MB images is large: base64 adds a third. nginx gets
    `client_max_body_size 12m`.
  - Import itself does not cap the image count, only the size of each image (D8). A cap could
    be added later if needed.

**D7 — Canvas integration: `map_pin` on any image.** `config.mapImageId` (optional) replaces
the built-in world map for that question.
- **Aspect fill:** on create, update and import, the server sets `config.aspectRatio`:
  - with a `mapImageId`, the image's `width / height`;
  - without one, `2.0`, the built-in map.
  
  This overrides whatever the client sent, so the canvas and the scoring always use the real
  shape. `aspectRatio` stays a required key for the validator (T7), and only its value is
  replaced.
- Scoring, reveal, distribution keys and the gateway check are unchanged. Everything is
  already expressed in image fractions (T7 D1). A "click a region of an image" question is a
  `map_pin` on that image, with the radii as the region size.
- `MapCanvas` (in all three apps) takes an optional `imageUrl`. Its image cache becomes keyed by
  URL, falling back to `world-map.svg`.
- Self-critique: a very tall image, such as a 1:3 portrait, makes a tall canvas on the big
  screen. The host pages already cap the canvas width; Step 6 also caps the canvas height.

**D8 — Upload rules.**
- Accepted: PNG, JPEG, GIF and WebP. **No SVG**, because an SVG can carry script.
- Max size 2 MB, enforced by reading at most 2 MB + 1 byte.
- Max 25 megapixels (`width*height`), which guards against decompression bombs.
- The format is detected by Pillow (`Image.open(BytesIO(data))`, then `.verify()`, then reopen
  for size). `mime` comes from the detected `format` (`PNG→image/png`, `JPEG→image/jpeg`,
  `GIF→image/gif`, `WEBP→image/webp`). The client's `Content-Type` and file extension are
  ignored.
- Errors are **422** with messages:
  - `Unsupported image type; use PNG, JPEG, GIF or WebP`;
  - `Image is larger than 2 MB`;
  - `Image is larger than 25 megapixels`;
  - `File is not a valid image`.
- New dependency: `Pillow>=10` in `backend/requirements.txt`.

**Config reference rules (all question types).**
- Keys:
  - `config.imageId`: a 32-hex string or absent/null;
  - `config.optionImages`: MC/MS only, a list of (32-hex | null), same length as `options`;
  - `config.mapImageId`: `map_pin` only, a 32-hex string or absent/null.
- The **shape** is checked in `schemas/admin.py` `QuestionCreate` (→ 422 on create, or 422 via
  merge-then-validate on update). Those keys on other types → 422.
- **Ownership** needs the DB, so it is checked in `question_service.create/update` and in
  import: every referenced id must exist in `question_images` with this `game_id`, else 422
  `Image <id> does not belong to this game`.

## 3. Alternatives considered

| Alternative | Why it lost |
|---|---|
| Per-course image library | Reuse across games is nice. But export/import, delete and "who may edit" all need "is another game still using it?" logic. Per-game keeps every rule local. |
| Auth-protected image URLs | `<img>` can't send a Bearer header. Every app (and the canvas) would need fetch-as-blob plus object-URL lifecycle handling. The unguessable id gives the protection that matters. |
| Base64 images inside `config` | Bloats every `new_question` event sent to every player, and the T8 "view/replace/delete" would have no single object to manage. |
| `<img>` tags inside the prompt | Breaks the bleach sanitizer contract, and lets hosts inject arbitrary URLs. |
| Auto-clear references on delete | Silently breaks `map_pin` targets (D5). |
| Image-only options (no text) | Reports, CSV and the results bars would show only "Option A". |
| Store files on disk / object store | Explicitly forbidden by T8. |

## 4. Detailed implementation

### Step 1 — Model and migration
- `backend/app/models/image.py`: `QuestionImage` per D1. `data` is
  `LargeBinary().with_variant(mysql.MEDIUMBLOB(), "mysql")`. Import it in `models/__init__.py`
  after `game`.
- `backend/app/migrations/versions/005_question_images.py`: create the table, the index on
  `game_id`, and the FK with `ondelete="CASCADE"`. The downgrade drops the table.

### Step 2 — `backend/app/services/image_service.py`
- Constants: `MAX_BYTES = 2 * 1024 * 1024`, `MAX_PIXELS = 25_000_000`,
  `FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "GIF": "image/gif", "WEBP": "image/webp"}`,
  `WORLD_MAP_ASPECT = 2.0`, `ID_RE = ^[0-9a-f]{32}$`.
- `inspect(data: bytes) -> tuple[mime, width, height]`: the D8 rules, raising
  `UnprocessableError`.
- `async def read_upload(file: UploadFile) -> bytes`: reads `MAX_BYTES + 1` bytes; if more →
  422 `Image is larger than 2 MB`.
- `referenced_ids(q_type, config) -> set[str]`: collects `imageId`, the non-null
  `optionImages` and `mapImageId`.
- `async def used_by(db, game_id, image_id) -> list[int]`: 1-based positions (by
  `order_index`) of the game's questions whose `referenced_ids` contain the id.
- `async def assert_refs_in_game(db, game_id, q_type, config)`: the 422 rule above.
- `async def fill_map_aspect(db, q_type, config) -> dict`: returns the config with
  `aspectRatio` set per D7 (no-op for other types).
- `create(db, game, filename, data)`, `replace(db, redis, image, filename, data)`,
  `delete(db, redis, image)`, `list_for_game(db, game_id)`: each returns `ImageResponse`
  items. `replace` and `delete` call `question_service.assert_no_live_session` (renamed from
  `_assert_no_live_session`; its four call sites in `question_service` are updated) and the D5 rules.
- `export_images(db, game_id) -> tuple[list[dict], dict[id, ref]]` and
  `import_images(db, game, images_raw) -> dict[ref, id]` for D6.

### Step 3 — Schemas and routes
- `schemas/admin.py`:
  - `ImageResponse {id, game_id, filename, mime, width, height, size_bytes, updated_at,
    used_by: list[int]}`;
  - in `QuestionCreate.validate_structure`, the shape checks for the three config keys.
- `routers/host.py` (each calls `assert_host_can_manage_game` on the image's game):
  - `GET /api/host/games/{game_id}/images` → list;
  - `POST /api/host/games/{game_id}/images` (`file: UploadFile`) → 201;
  - `PUT /api/host/images/{image_id}` (`file`) → 200;
  - `DELETE /api/host/images/{image_id}` → 204.
- `routers/admin.py`: the same four routes under `/api/admin/...`, `require_admin`.
- `routers/images.py`: public `GET /api/images/{image_id}` per D2, mounted in `main.py`.
- `nginx/nginx.dev.conf`: `client_max_body_size 12m;` in the server block.

### Step 4 — `question_service`
- `create` and `update`: after Pydantic validation, call
  `image_service.assert_refs_in_game(...)`, then `config = await
  image_service.fill_map_aspect(...)`. In `update` this runs on the merged, validated config.

### Step 5 — Export / import (`routers/admin.py`)
- `export_game`: if the game has images, write version 2 with `images` and refs (D6);
  otherwise version 1, unchanged.
- `import_game`: accept versions 1 and 2. For version 2, follow the D6 order inside the existing
  transaction. Any failure → 422, with nothing committed.
- A new admin game created by import still gets its course assigned afterwards (Jack's T4 admin
  flow). This step does not change that.

### Step 6 — Frontends (copies per app; no shared code)
- `lib/images.ts` (host, player, admin): `imageUrl(id) = `/api/images/${id}``.
- **Host** (`frontend/host/src`):
  - `lib/api.ts`: add `postForm` and `putForm`, which send `FormData` without the JSON
    `Content-Type`.
  - `components/ImageLibrary.tsx`: a grid of the game's images with a thumbnail, filename,
    size, "Used by Q2, Q5", **Replace** (file input → `PUT`) and **Delete** (confirm →
    `DELETE`; the server's 409 message is shown), plus an **Upload** button.
  - `components/ImagePicker.tsx`: a "Choose image" button opening a small grid of the library
    plus "None". It returns an id or null.
  - `pages/manage/QuestionEditorPage.tsx`:
    - the library panel above the question list;
    - in the form:
      - a prompt image picker (all types);
      - a per-option picker (MC/MS) that keeps `optionImages` aligned when options are added
        or removed;
      - for `map_pin`, a map image picker. `MapPicker` takes `imageUrl` and `aspectRatio`,
        and the client computes the ratio from the loaded image for the preview, though the
        server's value wins.
    - Payload: send the keys only when set.
  - `components/MapCanvas.tsx`, `MapPicker.tsx`: an `imageUrl` prop and a URL-keyed image
    cache. The canvas height is capped at 70vh on the host pages.
  - `pages/game/QuestionPage.tsx` and `ResultsPage.tsx`:
    - the prompt image above the prompt (`max-h-[40vh] object-contain`);
    - option thumbnails on Results;
    - `map_pin` passes `imageUrl` when `config.mapImageId` is set.
  - `types/game.ts`: `config` gets `imageId?`, `optionImages?`, `mapImageId?`.
- **Admin** (`frontend/admin/src`): the same `api.ts`, `ImageLibrary`, `ImagePicker`,
  `MapCanvas`/`MapPicker` and `QuestionEditorPage` changes against `/api/admin`. They are
  additive branches, as with map_pin.
- **Player** (`frontend/player/src`):
  - `pages/game/QuestionPage.tsx`: the MC/MS tile grid (D4) when any `optionImages` entry is
    non-null; `map_pin` passes `imageUrl`.
  - `ResultsPage.tsx` / `GameOverPage.tsx`: `map_pin` passes `imageUrl`.
  - `components/MapCanvas.tsx` per above; `types/game.ts`.

### Step 7 — Report (`services/report_service.py`)
Text only: append ` (image)` after a prompt that has `imageId`, and after each option label that
has an image. A `map_pin` question on a custom image says `on a custom image` in its summary
line.

### Step 8 — Context docs and README
Sync the `CLAUDE.md` files of `models`, `schemas`, `routers`, `services` and the backend root,
and the frontend `src`, `pages`, `components` and `lib` files of all three apps. Add the
version 2 format to README "Quiz import and export".

### Step 9 — Tests (T5)
- **Unit** `tests/unit/test_image_service.py`:
  - `inspect` accepts tiny generated PNG/JPEG/GIF/WebP (made with Pillow in the test) and
    returns the right mime and size;
  - rejects SVG text, plain text and a truncated PNG with the D8 messages;
  - the mime comes from the content (a PNG named `x.jpg` → `image/png`);
  - `referenced_ids` and `fill_map_aspect` (with and without `mapImageId`).
- **Integration** `tests/integration/test_images.py` (reuses `World` from `test_host_api.py`):
  - host upload → list → public GET returns the bytes, `Content-Type` and `ETag`, and
    `If-None-Match` → 304;
  - replace changes the ETag and the bytes;
  - delete unused → 204, then GET → 404;
  - delete used → 409 with the question numbers;
  - an MC question with `optionImages` round-trips; a wrong-length `optionImages` → 422;
  - referencing another game's image → 422;
  - a host of another course → 403 on all four routes;
  - `map_pin` with `mapImageId` gets `aspectRatio` from the image; replacing it with a
    different-ratio image → 409, and with the same ratio → 200;
  - replace/delete during a live room → 409;
  - admin export of a game with images → version 2 → import → the images are re-created and
    the refs are remapped; a version-1 sample game still imports.

### Step 10 — Sample games (T6, optional)
Not required: T6 only demands that version-1 files keep importing. If time allows, add one
version-2 file under `sample_games/` with an image-option question and a custom-image
`map_pin`.

## 5. Coordination (Jack)
- **T9 theming touches the same frontend files.** New components (`ImageLibrary`,
  `ImagePicker`) use the existing palette classes, so his theme pass can include them. Tell him
  the file list before he starts.
- The admin `QuestionEditorPage.tsx` gets additive image branches, like map_pin did.
- Jack's `numeric` type has no options and no canvas, so the only image it can use is the
  prompt image (`imageId`), which works for every type.

## 6. Out of scope / future work
- Cropping or resizing in the browser; image reuse across games; a cap on the image count per
  game; images in the downloaded HTML report (text markers only).
- Showing the prompt image on phones (D3).

## 7. Verification
- `pytest` (unit + integration), `ruff check` / `ruff format --check`, and `tsc --noEmit` in
  all 3 apps.
- Manual, in the host editor:
  1. Upload 4 images; see them in the library.
  2. Make an MC question with 4 image options and a prompt image.
  3. Make a `map_pin` on a custom image (e.g. a campus map).
  4. Play with the simulator plus a phone-width window: image tiles on the phone; the prompt
     image and thumbnails on the big screen; the custom map on both screens.
  5. Replace an image and see it update; delete a used image and get the 409 message.
  6. Admin: export the game (version 2) and re-import it.
