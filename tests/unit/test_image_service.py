"""
Unit tests for T8 image helpers (docs/design-t8-images.md D2, D7, D8 and the
config reference rules). Images are generated in memory with Pillow.
"""

from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from PIL import Image

from app.common.exceptions import UnprocessableError
from app.services import image_refs, image_service

ID_A = "a" * 32
ID_B = "b" * 32


def _image(fmt: str, size=(40, 20), mode="RGB", **save_kwargs) -> bytes:
    buf = BytesIO()
    Image.new(mode, size, "white").save(buf, fmt, **save_kwargs)
    return buf.getvalue()


def _message(data: bytes) -> str:
    with pytest.raises(UnprocessableError) as exc:
        image_service.inspect(data)
    return exc.value.message


# ---------------------------------------------------------------------------
# inspect (D8)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fmt", "mime"),
    [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("GIF", "image/gif"), ("WEBP", "image/webp")],
)
def test_accepted_formats_report_mime_and_size(fmt, mime):
    assert image_service.inspect(_image(fmt)) == (mime, 40, 20)


def test_mime_comes_from_the_bytes_not_the_name():
    # The caller never passes a name or Content-Type; a PNG is a PNG.
    assert image_service.inspect(_image("PNG"))[0] == "image/png"


def test_svg_and_text_are_unsupported():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    assert _message(svg) == image_service.MSG_UNSUPPORTED
    assert _message(b"just some text") == image_service.MSG_UNSUPPORTED


def test_known_but_unsupported_format():
    assert _message(_image("BMP")) == image_service.MSG_UNSUPPORTED


def test_truncated_png_is_not_a_valid_image():
    data = _image("PNG", size=(200, 200), mode="RGB")
    assert _message(data[: len(data) // 2]) == image_service.MSG_INVALID


def test_too_many_pixels():
    # 6000 x 5000 = 30 MP of a 1-bit image compresses to a few KB.
    assert _message(_image("PNG", size=(6000, 5000), mode="1")) == image_service.MSG_TOO_MANY_PIXELS


def test_too_many_bytes():
    assert _message(b"\0" * (image_service.MAX_BYTES + 1)) == image_service.MSG_TOO_BIG


def test_exif_rotation_swaps_width_and_height():
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 degrees when displayed
    data = _image("JPEG", size=(40, 20), exif=exif.tobytes())
    assert image_service.inspect(data) == ("image/jpeg", 20, 40)


# ---------------------------------------------------------------------------
# If-None-Match (D2)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (f'"{ID_A}"', True),
        (f'W/"{ID_A}"', True),
        (f'"{ID_B}", "{ID_A}"', True),
        ("*", True),
        (f'"{ID_B}"', False),
        ("", False),
        (None, False),
    ],
)
def test_etag_matches(header, expected):
    assert image_service.etag_matches(header, ID_A) is expected


# ---------------------------------------------------------------------------
# Config references
# ---------------------------------------------------------------------------


def test_shape_errors():
    mc = {"options": ["a", "b"]}
    assert image_refs.shape_error("multiple_choice", {**mc, "optionImages": [ID_A, None]}) is None
    assert image_refs.shape_error("multiple_choice", {**mc, "optionImages": [ID_A]}) is not None
    assert image_refs.shape_error("multiple_choice", {**mc, "optionImages": ["x", None]}) is not None
    assert image_refs.shape_error("true_false", {"optionImages": [None, None]}) is not None
    assert image_refs.shape_error("multiple_choice", {**mc, "mapImageId": ID_A}) is not None
    assert image_refs.shape_error("numeric", {"imageId": ID_A}) is None
    assert image_refs.shape_error("numeric", {"imageId": "not-an-id"}) is not None
    assert image_refs.shape_error("map_pin", {"imageId": None, "mapImageId": None}) is None


def test_referenced_ids():
    config = {"imageId": ID_A, "optionImages": [ID_B, None], "options": ["x", "y"]}
    assert image_refs.referenced_ids("multiple_choice", config) == {ID_A, ID_B}
    assert image_refs.referenced_ids("map_pin", {"mapImageId": ID_B}) == {ID_B}
    assert image_refs.referenced_ids("true_false", {}) == set()


def test_remap_ids_to_refs_and_back():
    config = {"imageId": ID_A, "optionImages": [None, ID_B], "options": ["x", "y"]}
    out, missing = image_service.remap("multiple_choice", config, {ID_A: "img1", ID_B: "img2"})
    assert out["imageId"] == "img1" and out["optionImages"] == [None, "img2"] and not missing
    back, missing = image_service.remap("multiple_choice", out, {"img1": ID_A})
    assert back["imageId"] == ID_A and missing == ["img2"]


# ---------------------------------------------------------------------------
# map_pin aspect fill (D7)
# ---------------------------------------------------------------------------


async def test_fill_map_aspect_uses_the_image_or_the_world_map():
    db = AsyncMock()
    db.get.return_value = SimpleNamespace(width=300, height=200)
    filled = await image_service.fill_map_aspect(db, "map_pin", {"aspectRatio": 9, "mapImageId": ID_A})
    assert filled["aspectRatio"] == 1.5

    filled = await image_service.fill_map_aspect(db, "map_pin", {"aspectRatio": 9})
    assert filled["aspectRatio"] == image_service.WORLD_MAP_ASPECT

    config = {"options": ["a", "b"]}
    assert await image_service.fill_map_aspect(db, "multiple_choice", config) is config
