"""Public image bytes: GET /api/images/{id}  (docs/design-t8-images.md D2)

No authentication, so a plain <img src> works for guests on phones. Ids are
128-bit random and only reach people who can see the question. Cache-Control
no-cache plus an ETag means browsers revalidate and pick up a replaced image.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..common.exceptions import NotFoundError
from ..database import get_db
from ..models.image import QuestionImage
from ..services import image_service

router = APIRouter(prefix="/images", tags=["images"])


@router.get("/{image_id}")
async def get_image(
    image_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    if_none_match: Annotated[str | None, Header()] = None,
) -> Response:
    img = await db.get(QuestionImage, image_id)
    if img is None:
        raise NotFoundError(f"Image {image_id} not found")
    headers = {
        "ETag": f'"{img.sha256}"',
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
    }
    if image_service.etag_matches(if_none_match, img.sha256):
        return Response(status_code=304, headers=headers)
    await db.refresh(img, attribute_names=["data"])
    return Response(content=img.data, media_type=img.mime, headers=headers)
