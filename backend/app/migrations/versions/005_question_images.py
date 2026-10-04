"""Add question_images: per-game images stored in the database (T8)

Revision ID: 005
Revises: 004
Create Date: 2026-10-04

docs/design-t8-images.md D1. Bytes live in a MEDIUMBLOB (16 MB max; uploads are
capped at 2 MB). Deleting a game deletes its images via ON DELETE CASCADE.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "question_images",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "game_id",
            sa.Integer(),
            sa.ForeignKey(
                "games.id",
                name="fk_question_images_game_id_games",
                ondelete="CASCADE",
            ),
            nullable=False,
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("mime", sa.String(32), nullable=False),
        sa.Column(
            "data",
            sa.LargeBinary().with_variant(mysql.MEDIUMBLOB(), "mysql"),
            nullable=False,
        ),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_question_images_game_id", "question_images", ["game_id"])


def downgrade() -> None:
    op.drop_table("question_images")
