from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, deferred, mapped_column

from ..database import Base


class QuestionImage(Base):
    """An image owned by one game, stored in the database (docs/design-t8-images.md D1).

    No relationship() from Game on purpose: the FK's ON DELETE CASCADE removes
    a game's images, and an ORM relationship without passive_deletes would try
    to null game_id first. `data` is deferred so listings never load the bytes.
    """

    __tablename__ = "question_images"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    game_id: Mapped[int] = mapped_column(
        ForeignKey("games.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[str] = mapped_column(String(32), nullable=False)
    data: Mapped[bytes] = deferred(
        mapped_column(
            LargeBinary().with_variant(mysql.MEDIUMBLOB(), "mysql"), nullable=False
        )
    )
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
