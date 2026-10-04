"""map_pin question type helpers (docs/design-t7-map-question.md).

A point is {"x": float, "y": float}: fractions of the map image, origin top
left. The schema validator, the gateway's payload check and scoring all use
``is_unit_point`` so the three can't drift apart.
"""

from __future__ import annotations

import math

DEFAULT_ASPECT_RATIO = 2.0  # built-in equirectangular world map
GRID_X, GRID_Y = 200, 100  # answer-distribution cells (0.5% x 1% of the map)


def _is_number(v: object) -> bool:
    # bool is a subclass of int in Python; {"x": True} must not count as 1.0.
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def is_unit_point(p: object) -> bool:
    """True if p is {"x": n, "y": n} with both numbers (not bool) in [0, 1]."""
    if not isinstance(p, dict):
        return False
    x, y = p.get("x"), p.get("y")
    return _is_number(x) and _is_number(y) and 0 <= x <= 1 and 0 <= y <= 1


def is_valid_radii(full: object, zero: object) -> bool:
    return _is_number(full) and _is_number(zero) and 0 <= full < zero <= 1


def aspect_ratio(config: dict) -> float:
    a = config.get("aspectRatio", DEFAULT_ASPECT_RATIO)
    return float(a) if _is_number(a) and a > 0 else DEFAULT_ASPECT_RATIO


def distance(point: dict, target: dict, aspect: float) -> float:
    """Distance in map-width units; y is divided by the aspect ratio so both
    axes use the same unit (on a 2:1 map, 0.1 of height = 0.05 of width)."""
    dx = point["x"] - target["x"]
    dy = (point["y"] - target["y"]) / aspect
    return math.hypot(dx, dy)


def score_map_pin(
    point: dict, answer_data: dict, config: dict, points_value: float
) -> tuple[float, bool]:
    """Linear falloff: full points within fullRadius, 0 beyond zeroRadius.

    Returns (points rounded to 2 decimals, is_correct = within fullRadius).
    """
    d = distance(point, answer_data["target"], aspect_ratio(config))
    full, zero = answer_data["fullRadius"], answer_data["zeroRadius"]
    if d <= full:
        return round(points_value, 2), True
    if d >= zero:
        return 0.0, False
    return round(points_value * (zero - d) / (zero - full), 2), False


def map_pin_cell(point: dict) -> str:
    """Grid-cell key for the answer distribution, e.g. "102:28"."""
    return f"{round(point['x'] * GRID_X)}:{round(point['y'] * GRID_Y)}"


def reveal(answer_data: dict, config: dict) -> dict:
    """The exact client-facing reveal (design Step 3)."""
    return {
        "type": "map_pin",
        "target": answer_data.get("target"),
        "fullRadius": answer_data.get("fullRadius"),
        "zeroRadius": answer_data.get("zeroRadius"),
        "aspectRatio": aspect_ratio(config),
    }
