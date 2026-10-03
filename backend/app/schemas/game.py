from __future__ import annotations


from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ---------------------------------------------------------------------------
# Client-safe question — answer_data and grading_type never exposed
# ---------------------------------------------------------------------------


class QuestionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    type: str
    prompt: str
    config: dict
    time_limit_seconds: int
    points_value: float
    order_index: int


# ---------------------------------------------------------------------------
# Room / session
# ---------------------------------------------------------------------------


class RoomCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    game_id: int
    course_id: int

    @field_validator("game_id", "course_id")
    @classmethod
    def positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("must be a positive integer")
        return v


class RoomCreateResponse(BaseModel):
    room_code: str
    session_id: str


class ActiveSessionItem(BaseModel):
    session_id: str
    room_code: str
    status: str
    game_title: str
    course_name: str
    course_semester: str


class RoomInfoResponse(BaseModel):
    session_id: str
    room_code: str
    status: str
    game_title: str
    course_id: int
    course_name: str
    course_semester: str
    question_count: int


# ---------------------------------------------------------------------------
# Host resource lists
# ---------------------------------------------------------------------------


class MyCourseItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    semester: str
    role: str  # HOST (always, for this endpoint)


class MyGameItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    description: str
    max_players: int
    course_id: int | None


# ---------------------------------------------------------------------------
# Scoring result (internal, not a response schema)
# ---------------------------------------------------------------------------


class ScoreResult(BaseModel):
    points_awarded: float
    is_correct: bool


# ---------------------------------------------------------------------------
# Host management (/api/host) — docs/design-t4-host.md
# ---------------------------------------------------------------------------


class HostGameCreate(BaseModel):
    """The course comes from the URL; hosts never pick or change it."""

    model_config = ConfigDict(extra="forbid")
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field("", max_length=5000)
    max_players: int = Field(150, ge=1, le=500)


class HostGameUpdate(BaseModel):
    """No course_id: a game's course is set once at creation (D1)."""

    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=5000)
    max_players: int | None = Field(None, ge=1, le=500)


class HostRosterActivePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: bool


class HostSessionItem(BaseModel):
    session_id: str
    room_code: str
    status: str
    game_id: int
    game_title: str
    created_at: datetime
    completed_at: datetime | None
    # Distinct players with at least one answer — same rule as the CSV rows.
    player_count: int
