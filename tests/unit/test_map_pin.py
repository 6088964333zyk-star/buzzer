"""
Unit tests for map_pin scoring and validation (docs/design-t7-map-question.md).

Run with:
    PYTHONPATH=backend pytest tests/unit/test_map_pin.py
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.schemas.admin import QuestionCreate
from app.services import map_pin
from app.services.game_service import calculate_score

TARGET = {"x": 0.5, "y": 0.5}


def _question(grading="ACCURACY", full=0.02, zero=0.12, points=10.0):
    return SimpleNamespace(
        type="map_pin",
        grading_type=grading,
        config={"aspectRatio": 2},
        answer_data={"target": TARGET, "fullRadius": full, "zeroRadius": zero},
        points_value=points,
    )


def _score(q, point):
    return calculate_score(q, {"point": point})


def test_inside_full_radius_scores_full_and_is_correct():
    r = _score(_question(), {"x": 0.51, "y": 0.5})
    assert r.points_awarded == 10.0 and r.is_correct is True


def test_exactly_at_zero_radius_scores_zero():
    r = _score(_question(), {"x": 0.62, "y": 0.5})
    assert r.points_awarded == 0 and r.is_correct is False


def test_midway_between_radii_scores_about_half():
    # d = 0.07, halfway between 0.02 and 0.12
    r = _score(_question(), {"x": 0.57, "y": 0.5})
    assert r.points_awarded == pytest.approx(5.0, abs=0.01)
    assert r.is_correct is False


def test_y_offset_is_scaled_by_aspect_ratio():
    # On a 2:1 map a 0.10 vertical offset is 0.05 of map width,
    # so it must score the same as a 0.05 horizontal offset.
    vertical = _score(_question(), {"x": 0.5, "y": 0.6})
    horizontal = _score(_question(), {"x": 0.55, "y": 0.5})
    assert vertical.points_awarded == horizontal.points_awarded
    assert map_pin.distance({"x": 0.5, "y": 0.6}, TARGET, 2) == pytest.approx(0.05)


def test_points_are_rounded_to_two_decimals():
    r = _score(_question(points=7.0), {"x": 0.5333333, "y": 0.5})
    assert r.points_awarded == round(r.points_awarded, 2)


def test_completeness_gives_full_points_for_any_valid_point():
    r = _score(_question(grading="COMPLETENESS"), {"x": 0.0, "y": 1.0})
    assert r.points_awarded == 10.0 and r.is_correct is True


@pytest.mark.parametrize(
    "point",
    [
        None,
        {},
        {"x": 0.5},
        {"x": "0.5", "y": 0.5},
        {"x": True, "y": 0},  # bool is an int subclass in Python
        {"x": 1.5, "y": 0.5},
        {"x": -0.1, "y": 0.5},
        {"x": float("nan"), "y": 0.5},
        [0.5, 0.5],
    ],
)
def test_malformed_points_score_zero_without_raising(point):
    r = _score(_question(), point)
    assert r.points_awarded == 0 and r.is_correct is False


def test_grid_cell_key():
    assert map_pin.map_pin_cell({"x": 0.512, "y": 0.281}) == "102:28"


def _create(**answer_overrides):
    answer = {"target": TARGET, "fullRadius": 0.02, "zeroRadius": 0.15, **answer_overrides}
    return QuestionCreate(
        type="map_pin",
        grading_type="ACCURACY",
        prompt="Where?",
        config={"aspectRatio": 2},
        answer_data=answer,
    )


def test_validator_accepts_a_well_formed_question():
    assert _create().type == "map_pin"


@pytest.mark.parametrize(
    "override",
    [
        {"target": {"x": 1.2, "y": 0.5}},
        {"target": {"x": True, "y": 0.5}},
        {"target": None},
        {"fullRadius": 0.2, "zeroRadius": 0.1},
        {"fullRadius": 0.1, "zeroRadius": 0.1},
        {"zeroRadius": 1.5},
    ],
)
def test_validator_rejects_bad_targets_and_radii(override):
    with pytest.raises(ValueError):
        _create(**override)


def test_validator_requires_target_for_completeness_too():
    with pytest.raises(ValueError):
        QuestionCreate(
            type="map_pin",
            grading_type="COMPLETENESS",
            prompt="Where would you travel?",
            config={"aspectRatio": 2},
            answer_data={},
        )


def test_validator_requires_positive_aspect_ratio():
    with pytest.raises(ValueError):
        QuestionCreate(
            type="map_pin",
            grading_type="ACCURACY",
            prompt="Where?",
            config={},
            answer_data={"target": TARGET, "fullRadius": 0.02, "zeroRadius": 0.15},
        )
