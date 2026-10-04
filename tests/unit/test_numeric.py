"""
Unit tests for numeric scoring, bucketing, validation and formatting
(docs/design-t7-numeric.md, section 5).

Run with:
    PYTHONPATH=backend pytest tests/unit/test_numeric.py
"""

from __future__ import annotations

import math
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.admin import QuestionCreate
from app.services import numeric
from app.services.game_service import calculate_score


def _answer_data(answer=0.62, mode="absolute", full=0.05, zero=0.15):
    return {
        "answer": answer,
        "toleranceMode": mode,
        "fullTolerance": full,
        "zeroTolerance": zero,
    }


def _question(grading="ACCURACY", points=10.0, **kw):
    return SimpleNamespace(
        type="numeric",
        grading_type=grading,
        config={},
        answer_data=_answer_data(**kw),
        points_value=points,
    )


def _score(q, value):
    return calculate_score(q, {"value": value})


# ---------------------------------------------------------------------------
# 1. Absolute tolerance
# ---------------------------------------------------------------------------


def test_exact_answer_scores_full():
    r = _score(_question(), 0.62)
    assert r.points_awarded == 10.0 and r.is_correct is True


def test_exactly_at_full_tolerance_scores_full_despite_float_error():
    # 0.62 - 0.57 == 0.05000000000000004; the epsilon keeps it full credit.
    q = _question()
    r = _score(q, 0.57)
    assert r.points_awarded == 10.0 and r.is_correct is True
    assert numeric.bucket(0.57, q.answer_data) == "full"


def test_midway_scores_half():
    # full 0.05, zero 0.15: d = 0.10 is halfway.
    r = _score(_question(), 0.72)
    assert r.points_awarded == pytest.approx(5.0, abs=0.01)
    assert r.is_correct is False


def test_exactly_at_zero_tolerance_scores_zero():
    q = _question()
    r = _score(q, 0.77)
    assert r.points_awarded == 0.0 and r.is_correct is False
    assert numeric.bucket(0.77, q.answer_data) == "zero_high"


# ---------------------------------------------------------------------------
# 2. Percent tolerance
# ---------------------------------------------------------------------------


def test_percent_mode_uses_share_of_answer():
    q = _question(answer=343, mode="percent", full=5, zero=20)
    assert _score(q, 360).points_awarded == 10.0  # ~4.96% off
    assert _score(q, 412).points_awarded == 0.0  # ~20.1% off


def test_percent_mode_uses_absolute_value_of_negative_answer():
    q = _question(answer=-40, mode="percent", full=10, zero=50)
    assert _score(q, -43).points_awarded == 10.0  # 3 <= 4
    assert _score(q, -60).points_awarded == 0.0  # 20 >= 20


# ---------------------------------------------------------------------------
# 3. Bucket direction
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value, expected",
    [
        (0.30, "zero_low"),
        (0.52, "partial_low"),
        (0.62, "full"),
        (0.72, "partial_high"),
        (0.95, "zero_high"),
    ],
)
def test_bucket_sign_and_band(value, expected):
    assert numeric.bucket(value, _answer_data()) == expected


def test_bucket_agrees_with_points():
    ad = _answer_data()
    q = _question()
    for v in (0.3, 0.47, 0.5, 0.57, 0.62, 0.67, 0.74, 0.77, 0.9):
        key = numeric.bucket(v, ad)
        pts = _score(q, v).points_awarded
        if key.startswith("zero"):
            assert pts == 0.0
        elif key.startswith("partial"):
            assert 0 < pts < 10.0
        else:
            assert pts == 10.0


# ---------------------------------------------------------------------------
# 4. COMPLETENESS
# ---------------------------------------------------------------------------


def test_completeness_gives_full_points_for_any_valid_value():
    r = _score(_question(grading="COMPLETENESS"), -999)
    assert r.points_awarded == 10.0 and r.is_correct is True


# ---------------------------------------------------------------------------
# 5. Invalid values never raise
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value", [None, "0.6", True, math.nan, math.inf, -math.inf, 10**400]
)
def test_invalid_values_score_zero_without_raising(value):
    assert numeric.is_finite_number(value) is False
    r = _score(_question(), value)
    assert r.points_awarded == 0 and r.is_correct is False


def test_missing_value_scores_zero():
    r = calculate_score(_question(), {"other": 1})
    assert r.points_awarded == 0 and r.is_correct is False


# ---------------------------------------------------------------------------
# 6. Rounding
# ---------------------------------------------------------------------------


def test_points_rounded_to_two_decimals():
    pts = _score(_question(points=1.0), 0.6533333).points_awarded
    assert pts == round(pts, 2)


# ---------------------------------------------------------------------------
# 7. Validation messages, in order
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "config, answer_data, message",
    [
        ({}, _answer_data(answer="x"), "answer must be a finite number"),
        ({}, _answer_data(answer=True), "answer must be a finite number"),
        ({}, _answer_data(mode="relative"), "toleranceMode must be"),
        ({}, _answer_data(full=0.2, zero=0.1), "0 <= fullTolerance < zeroTolerance"),
        ({}, _answer_data(full=0.1, zero=0.1), "0 <= fullTolerance < zeroTolerance"),
        ({}, _answer_data(full=-1), "0 <= fullTolerance < zeroTolerance"),
        ({}, _answer_data(answer=0, mode="percent", full=5, zero=20), "non-zero"),
        ({"unit": "x" * 21}, _answer_data(), "config.unit"),
        ({"unit": 5}, _answer_data(), "config.unit"),
    ],
)
def test_validate_messages(config, answer_data, message):
    assert message in numeric.validate(config, answer_data)


def test_earlier_rule_wins():
    # Bad answer and bad mode: the answer message comes first.
    bad = _answer_data(answer="x", mode="nope")
    assert "answer must be a finite number" in numeric.validate({}, bad)


def test_valid_questions_pass():
    assert numeric.validate({}, _answer_data()) is None
    assert (
        numeric.validate(
            {"unit": "m/s"}, _answer_data(answer=343, mode="percent", full=5, zero=20)
        )
        is None
    )


def test_schema_rejects_invalid_numeric_question():
    with pytest.raises(ValidationError, match="non-zero"):
        QuestionCreate(
            type="numeric",
            grading_type="ACCURACY",
            prompt="p",
            answer_data=_answer_data(answer=0, mode="percent", full=5, zero=20),
        )


def test_schema_accepts_valid_numeric_question_both_gradings():
    for grading in ("ACCURACY", "COMPLETENESS"):
        q = QuestionCreate(
            type="numeric",
            grading_type=grading,
            prompt="Estimate r",
            answer_data=_answer_data(),
        )
        assert q.type == "numeric"


# ---------------------------------------------------------------------------
# 8. Formatting (Python mirror of the frontends' formatNumber)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "n, expected",
    [
        (0.1 + 0.2, "0.3"),
        (6.02214076e23, "6.022e+23"),
        (0.0001, "1e-04"),
        (343.0, "343"),
        (0.62, "0.62"),
        (7 / 3, "2.33333"),
        (0, "0"),
    ],
)
def test_format_number(n, expected):
    assert numeric.format_number(n) == expected


def test_with_unit():
    assert numeric.with_unit(343, "m/s") == "343 m/s"
    assert numeric.with_unit(0.62, None) == "0.62"


def test_reveal_shape():
    r = numeric.reveal(_answer_data(), {"unit": ""})
    assert r == {
        "type": "numeric",
        "answer": 0.62,
        "toleranceMode": "absolute",
        "fullTolerance": 0.05,
        "zeroTolerance": 0.15,
        "unit": None,
    }
