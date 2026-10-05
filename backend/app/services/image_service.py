"""Game images stored in the database (T8, docs/design-t8-images.md).

Shared by the admin and host routers, question_service and game import/export.
Callers authorize first and pass the already-loaded game id or image.
  D5 — replace/delete are blocked during a live room; delete is blocked while a
       question uses the image; a map_pin map keeps its shape and can't change
       once that question has answers.
  D7 — map_pin config.aspectRatio is always filled in by the server.
  D8 — upload rules: PNG/JPEG/GIF/WebP, at most 2 MB and 25 megapixels, the
       mime detected from the bytes.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import re
import secrets
import warnings
from io import BytesIO

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from ..common.exceptions import ConflictError, NotFoundError, UnprocessableError
from ..models.game import Question
from ..models.image import QuestionImage
from . import question_service
from .image_refs import OPTION_TYPES, map_image_id, referenced_ids

MAX_BYTES = 2 * 1024 * 1024
MAX_PIXELS = 25_000_000
FORMATS = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "GIF": "image/gif",
    "WEBP": "image/webp",
}
WORLD_MAP_ASPECT = 2.0
ASPECT_TOLERANCE = 0.01
REF_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
_EXIF_ORIENTATION = 0x0112

MSG_TOO_BIG = "Image is larger than 2 MB"
MSG_UNSUPPORTED = "Unsupported image type; use PNG, JPEG, GIF or WebP"
MSG_TOO_MANY_PIXELS = "Image is larger than 25 megapixels"
MSG_INVALID = "File is not a valid image"


# ---------------------------------------------------------------------------
# Upload checks (D8)
# ---------------------------------------------------------------------------


def inspect(data: bytes) -> tuple[str, int, int]:
    """(mime, width, height) of an uploaded image, or a 422 with one message.

    width/height are the displayed size: an EXIF orientation of 5-8 is a
    90-degree rotation, so they are swapped (Goldfish 3).
    """
    if len(data) > MAX_BYTES:
        raise UnprocessableError(MSG_TOO_BIG)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            img = Image.open(BytesIO(data))
            fmt = img.format
            width, height = img.size
            try:
                orientation = img.getexif().get(_EXIF_ORIENTATION)
            except Exception:  # malformed EXIF is not worth rejecting the image
                orientation = None
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise UnprocessableError(MSG_TOO_MANY_PIXELS) from None
    except UnidentifiedImageError:
        raise UnprocessableError(MSG_UNSUPPORTED) from None
    except Exception:
        raise UnprocessableError(MSG_INVALID) from None

    if fmt not in FORMATS:
        raise UnprocessableError(MSG_UNSUPPORTED)
    if width * height > MAX_PIXELS:
        raise UnprocessableError(MSG_TOO_MANY_PIXELS)
    try:
        Image.open(BytesIO(data)).verify()
    except Exception:
        raise UnprocessableError(MSG_INVALID) from None

    if orientation in (5, 6, 7, 8):
        width, height = height, width
    return FORMATS[fmt], width, height


async def read_upload(file: UploadFile) -> bytes:
    """Read at most MAX_BYTES + 1 bytes, so an oversized upload is never fully read."""
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise UnprocessableError(MSG_TOO_BIG)
    return data


def etag_matches(if_none_match: str | None, sha256: str) -> bool:
    """True if an If-None-Match header matches this image (D2)."""
    if not if_none_match:
        return False
    for part in if_none_match.split(","):
        tag = part.strip()
        if tag == "*":
            return True
        if tag.startswith("W/"):
            tag = tag[2:]
        if tag.strip('"') == sha256:
            return True
    return False


# ---------------------------------------------------------------------------
# Who uses an image
# ---------------------------------------------------------------------------


async def _game_questions(db: AsyncSession, game_id: int) -> list[Question]:
    result = await db.execute(
        select(Question)
        .where(Question.game_id == game_id)
        .order_by(Question.order_index, Question.id)
    )
    return list(result.scalars().all())


def _positions(questions: list[Question], image_id: str) -> list[int]:
    """1-based positions of the questions that use the image."""
    return [
        pos
        for pos, q in enumerate(questions, start=1)
        if image_id in referenced_ids(q.type, q.config)
    ]


def _response(img: QuestionImage, questions: list[Question]) -> dict:
    return {
        "id": img.id,
        "game_id": img.game_id,
        "filename": img.filename,
        "mime": img.mime,
        "width": img.width,
        "height": img.height,
        "size_bytes": img.size_bytes,
        "sha256": img.sha256,
        "updated_at": img.updated_at,
        "used_by": _positions(questions, img.id),
    }


def _join(positions: list[int]) -> str:
    return ", ".join(str(p) for p in positions)


# ---------------------------------------------------------------------------
# Question references (config reference rules, D7)
# ---------------------------------------------------------------------------


async def assert_refs_in_game(
    db: AsyncSession, game_id: int, q_type: str, config: dict
) -> None:
    """422 unless every image the question references belongs to this game."""
    ids = referenced_ids(q_type, config)
    if not ids:
        return
    result = await db.execute(
        select(QuestionImage.id).where(
            QuestionImage.game_id == game_id, QuestionImage.id.in_(ids)
        )
    )
    found = set(result.scalars().all())
    missing = sorted(ids - found)
    if missing:
        raise UnprocessableError(f"Image {missing[0]} does not belong to this game")


async def fill_map_aspect(db: AsyncSession, q_type: str, config: dict) -> dict:
    """map_pin: aspectRatio from the map image, or the built-in map's 2.0."""
    if q_type != "map_pin":
        return config
    image_id = map_image_id(q_type, config)
    aspect = WORLD_MAP_ASPECT
    if image_id:
        img = await db.get(QuestionImage, image_id)
        if img is not None:
            aspect = img.width / img.height
    return {**config, "aspectRatio": aspect}


# ---------------------------------------------------------------------------
# Create / list / replace / delete (D5)
# ---------------------------------------------------------------------------


def _fields(filename: str | None, data: bytes) -> dict:
    mime, width, height = inspect(data)
    return {
        "filename": (filename or "image")[:255],
        "mime": mime,
        "data": data,
        "size_bytes": len(data),
        "width": width,
        "height": height,
        "sha256": hashlib.sha256(data).hexdigest(),
    }


async def get(db: AsyncSession, image_id: str) -> QuestionImage:
    """The image row (bytes still deferred), or 404."""
    img = await db.get(QuestionImage, image_id)
    if img is None:
        raise NotFoundError(f"Image {image_id} not found")
    return img


async def list_for_game(db: AsyncSession, game_id: int) -> list[dict]:
    result = await db.execute(
        select(QuestionImage)
        .where(QuestionImage.game_id == game_id)
        .order_by(QuestionImage.created_at, QuestionImage.id)
    )
    questions = await _game_questions(db, game_id)
    return [_response(img, questions) for img in result.scalars().all()]


async def create(
    db: AsyncSession, game_id: int, filename: str | None, data: bytes
) -> dict:
    """Upload: allowed even during a live room, since no question uses it yet."""
    img = QuestionImage(
        id=secrets.token_hex(16), game_id=game_id, **_fields(filename, data)
    )
    db.add(img)
    await db.flush()
    await db.refresh(img)
    return _response(img, [])


async def replace(
    db: AsyncSession,
    redis: Redis,
    img: QuestionImage,
    filename: str | None,
    data: bytes,
) -> dict:
    """Swap the bytes, keeping the id, so every question using it updates."""
    await question_service.assert_no_live_session(db, redis, img.game_id)
    fields = _fields(filename, data)

    questions = await _game_questions(db, img.game_id)
    map_users = [
        (pos, q)
        for pos, q in enumerate(questions, start=1)
        if map_image_id(q.type, q.config) == img.id
    ]
    answered = [
        pos
        for pos, q in map_users
        if await question_service.answered_session_count(db, q.id) > 0
    ]
    if answered:
        raise ConflictError(
            f"Image is the map of answered question(s) {_join(answered)}"
        )
    new_aspect = fields["width"] / fields["height"]
    old_aspect = img.width / img.height
    if map_users and abs(new_aspect / old_aspect - 1) > ASPECT_TOLERANCE:
        raise ConflictError(
            f"Image is the map of question(s) {_join([p for p, _ in map_users])}; "
            "the new image must keep its shape"
        )

    for key, value in fields.items():
        setattr(img, key, value)
    for _, q in map_users:
        q.config = {**q.config, "aspectRatio": new_aspect}
    await db.flush()
    await db.refresh(img)
    return _response(img, questions)


async def delete(db: AsyncSession, redis: Redis, img: QuestionImage) -> None:
    await question_service.assert_no_live_session(db, redis, img.game_id)
    used = _positions(await _game_questions(db, img.game_id), img.id)
    if used:
        raise ConflictError(f"Image is used by question(s) {_join(used)}")
    await db.delete(img)
    await db.flush()


# ---------------------------------------------------------------------------
# Export / import (D6)
# ---------------------------------------------------------------------------


def remap(q_type: str, config: dict, mapping: dict[str, str]) -> tuple[dict, list[str]]:
    """Replace image ids (or refs) in a config via `mapping`.

    Returns (new config, values that had no mapping). Works on raw values, so
    it handles both ids (export) and refs (import).
    """
    out = dict(config)
    missing: list[str] = []

    def swap(value: object) -> object:
        if isinstance(value, str):
            if value in mapping:
                return mapping[value]
            missing.append(value)
        return value

    for key in ("imageId", "mapImageId"):
        if out.get(key) is not None:
            out[key] = swap(out[key])
    if q_type in OPTION_TYPES and isinstance(out.get("optionImages"), list):
        out["optionImages"] = [v if v is None else swap(v) for v in out["optionImages"]]
    return out, missing


async def export_images(
    db: AsyncSession, game_id: int
) -> tuple[list[dict], dict[str, str]]:
    """The game's images as file entries, plus the id -> ref mapping."""
    result = await db.execute(
        select(QuestionImage)
        .options(undefer(QuestionImage.data))
        .where(QuestionImage.game_id == game_id)
        .order_by(QuestionImage.created_at, QuestionImage.id)
    )
    entries: list[dict] = []
    id_to_ref: dict[str, str] = {}
    for n, img in enumerate(result.scalars().all(), start=1):
        ref = f"img{n}"
        id_to_ref[img.id] = ref
        entries.append(
            {
                "ref": ref,
                "filename": img.filename,
                "mime": img.mime,
                "data": base64.b64encode(img.data).decode("ascii"),
            }
        )
    return entries, id_to_ref


async def import_images(
    db: AsyncSession, game_id: int, images_raw: object
) -> dict[str, str]:
    """Validate and create a version-2 file's images; returns ref -> new id.

    Every image is validated before any row is created. Errors are
    UnprocessableError; the import route turns them into its detail shape.
    """
    if not isinstance(images_raw, list):
        raise UnprocessableError("'images' must be a list")
    decoded: list[tuple[str, str | None, bytes]] = []
    seen: set[str] = set()
    for entry in images_raw:
        ref = entry.get("ref") if isinstance(entry, dict) else None
        if not isinstance(ref, str) or not REF_RE.match(ref) or ref in seen:
            raise UnprocessableError(f"Image ref {ref!r} is invalid or duplicated")
        seen.add(ref)
        try:
            data = base64.b64decode(entry.get("data") or "", validate=True)
        except (binascii.Error, ValueError, TypeError):
            raise UnprocessableError(f"Image {ref} invalid: {MSG_INVALID}") from None
        if not data:
            raise UnprocessableError(f"Image {ref} invalid: {MSG_INVALID}")
        try:
            inspect(data)
        except UnprocessableError as exc:
            raise UnprocessableError(f"Image {ref} invalid: {exc.message}") from None
        filename = entry.get("filename")
        decoded.append((ref, filename if isinstance(filename, str) else None, data))

    ref_to_id: dict[str, str] = {}
    for ref, filename, data in decoded:
        created = await create(db, game_id, filename, data)
        ref_to_id[ref] = created["id"]
    return ref_to_id
