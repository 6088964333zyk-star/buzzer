"""Image references inside a question's config (docs/design-t8-images.md).

Pure helpers, no DB, so ``schemas/admin.py`` can check the shape and
``image_service`` can find references without importing each other.

  config.imageId       prompt image, any type
  config.optionImages  multiple_choice / multi_select, list of (id | null)
                       the same length as config.options
  config.mapImageId    map_pin background; absent means the built-in world map
"""

from __future__ import annotations

import re

ID_RE = re.compile(r"^[0-9a-f]{32}$")
OPTION_TYPES = ("multiple_choice", "multi_select")


def _is_id(v: object) -> bool:
    return isinstance(v, str) and bool(ID_RE.match(v))


def shape_error(q_type: str, config: dict) -> str | None:
    """First shape problem with the three image keys, or None. A null value
    counts as absent."""
    image_id = config.get("imageId")
    if image_id is not None and not _is_id(image_id):
        return "config.imageId must be an image id"

    option_images = config.get("optionImages")
    if option_images is not None:
        if q_type not in OPTION_TYPES:
            return "config.optionImages is only allowed on multiple_choice and multi_select"
        options = config.get("options")
        if not isinstance(option_images, list) or (
            isinstance(options, list) and len(option_images) != len(options)
        ):
            return "config.optionImages must be a list the same length as options"
        if any(v is not None and not _is_id(v) for v in option_images):
            return "config.optionImages entries must be image ids or null"

    map_image_id = config.get("mapImageId")
    if map_image_id is not None:
        if q_type != "map_pin":
            return "config.mapImageId is only allowed on map_pin"
        if not _is_id(map_image_id):
            return "config.mapImageId must be an image id"
    return None


def referenced_ids(q_type: str, config: dict | None) -> set[str]:
    """Every image id a question uses (call after shape_error passed)."""
    config = config or {}
    ids: set[str] = set()
    if _is_id(config.get("imageId")):
        ids.add(config["imageId"])
    if q_type in OPTION_TYPES and isinstance(config.get("optionImages"), list):
        ids.update(v for v in config["optionImages"] if _is_id(v))
    if q_type == "map_pin" and _is_id(config.get("mapImageId")):
        ids.add(config["mapImageId"])
    return ids


def map_image_id(q_type: str, config: dict | None) -> str | None:
    """The map_pin background image id, or None for the built-in map."""
    if q_type != "map_pin":
        return None
    value = (config or {}).get("mapImageId")
    return value if _is_id(value) else None
