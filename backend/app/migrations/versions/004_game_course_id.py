"""Attach games to a course (nullable games.course_id) and backfill legacy games

Revision ID: 004
Revises: 003
Create Date: 2026-10-03

Games played in exactly one course are assigned to that course. Games never
played, or played in more than one course, stay NULL until an admin assigns
them (docs/design-t4-host.md, D1).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("games", sa.Column("course_id", sa.Integer(), nullable=True))
    op.create_index("ix_games_course_id", "games", ["course_id"])
    op.create_foreign_key(
        "fk_games_course_id_courses", "games", "courses", ["course_id"], ["id"]
    )

    # Backfill: a game whose sessions all belong to one course gets that course.
    op.execute(
        """
        UPDATE games g
        JOIN (
            SELECT game_id, MIN(course_id) AS course_id
            FROM game_sessions
            GROUP BY game_id
            HAVING COUNT(DISTINCT course_id) = 1
        ) s ON s.game_id = g.id
        SET g.course_id = s.course_id
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_games_course_id_courses", "games", type_="foreignkey")
    op.drop_index("ix_games_course_id", table_name="games")
    op.drop_column("games", "course_id")
