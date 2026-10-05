"""
Unit tests for multi_select in the HTML session report. Before this fix the
report had no multi_select branch: no reveal, no distribution, no chart.
"""

from __future__ import annotations

from types import SimpleNamespace

from app.services import report_service as rs

# The report writes "✓ Correct" with a narrow no-break space; match the mark only.
CORRECT_MARK = '<span class="bar-correct-mark">✓'


def _question(**overrides):
    q = {
        "type": "multi_select",
        "grading_type": "ACCURACY",
        "points_value": 2.0,
        "config": {"options": ["Red", "Green", "Blue"]},
        "answer_data": {"answer_points": [1, -1, 1]},
    }
    q.update(overrides)
    return SimpleNamespace(**q)


def test_keys_count_each_ticked_option():
    assert rs._multi_select_keys({"selectedIndices": [0, 2]}) == ["0", "2"]
    assert rs._multi_select_keys({"selectedIndices": [True, "1", 1]}) == ["1"]
    assert rs._multi_select_keys({"selectedIndices": "0"}) == []
    assert rs._multi_select_keys(None) == []


def test_reveal_matches_the_live_game():
    assert rs._answer_reveal(_question()) == {
        "type": "multi_select",
        "answerPoints": [1, -1, 1],
    }
    assert rs._answer_reveal(_question(grading_type="COMPLETENESS")) == {
        "type": "completeness"
    }


def test_chart_has_one_bar_per_option_with_correct_marks():
    q = _question()
    html = rs._render_bar_chart(q, {"0": 3, "2": 1}, rs._answer_reveal(q), 4)
    assert html.count('class="bar-row"') == 3
    assert "Red" in html and "Green" in html and "Blue" in html
    # Options worth points (Red, Blue) are marked correct; Green is not.
    assert html.count(CORRECT_MARK) == 2
    assert '<span class="bar-count">3</span>' in html


def test_completeness_chart_has_no_correct_marks():
    q = _question(grading_type="COMPLETENESS")
    html = rs._render_bar_chart(q, {"1": 2}, rs._answer_reveal(q), 2)
    assert html.count('class="bar-row"') == 3 and CORRECT_MARK not in html
