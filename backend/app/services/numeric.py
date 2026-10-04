"""numeric question type helpers (docs/design-t7-numeric.md).

A numeric question hides {"answer", "toleranceMode", "fullTolerance",
"zeroTolerance"} in answer_data; players send {"value": n}. The schema
validator, the gateway's payload check, scoring and bucketing all use
``is_finite_number`` and ``effective_tolerances`` so they can't drift apart.
"""

from __future__ import annotations

import math

EPS_SCALE = 1e-9  # eps = EPS_SCALE * max(1, |answer|), design N2
MAX_UNIT_LENGTH = 20
TOLERANCE_MODES = ("absolute", "percent")
BUCKETS = ("zero_low", "partial_low", "full", "partial_high", "zero_high")


def is_finite_number(v: object) -> bool:
    """int/float, not bool, and representable as a finite float (design N1).

    bool is a subclass of int in Python, and a huge int (10**400) passes
    isinstance but raises OverflowError in float arithmetic.
    """
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        return False
    try:
        return math.isfinite(float(v))
    except OverflowError:
        return False


def validate(config: dict, answer_data: dict) -> str | None:
    """First N1 error message, in N1's order, or None if valid."""
    answer = answer_data.get("answer")
    if not is_finite_number(answer):
        return "numeric answer_data.answer must be a finite number"
    if answer_data.get("toleranceMode") not in TOLERANCE_MODES:
        return "numeric answer_data.toleranceMode must be 'absolute' or 'percent'"
    full, zero = answer_data.get("fullTolerance"), answer_data.get("zeroTolerance")
    if not (is_finite_number(full) and is_finite_number(zero) and 0 <= full < zero):
        return (
            "numeric tolerances must be finite numbers with "
            "0 <= fullTolerance < zeroTolerance"
        )
    if answer_data["toleranceMode"] == "percent" and answer == 0:
        return "numeric percent tolerance needs a non-zero answer; use absolute"
    unit = config.get("unit")
    if unit is not None and not (
        isinstance(unit, str) and len(unit) <= MAX_UNIT_LENGTH
    ):
        return "numeric config.unit must be a string of at most 20 characters"
    return None


def effective_tolerances(answer_data: dict) -> tuple[float, float]:
    """(full, zero) in the answer's unit, after applying toleranceMode."""
    full = float(answer_data["fullTolerance"])
    zero = float(answer_data["zeroTolerance"])
    if answer_data.get("toleranceMode") == "percent":
        scale = abs(float(answer_data["answer"])) / 100
        return full * scale, zero * scale
    return full, zero


def _eps(answer: float) -> float:
    return EPS_SCALE * max(1.0, abs(answer))


def score_numeric(
    value: float, answer_data: dict, points_value: float
) -> tuple[float, bool]:
    """Linear falloff: full points within fullTolerance, 0 beyond zeroTolerance.

    Returns (points rounded to 2 decimals, is_correct = within full credit).
    """
    answer = float(answer_data["answer"])
    full, zero = effective_tolerances(answer_data)
    eps = _eps(answer)
    d = abs(float(value) - answer)
    if d <= full + eps:
        return round(points_value, 2), True
    if d >= zero - eps:
        return 0.0, False
    return round(points_value * (zero - d) / (zero - full), 2), False


def bucket(value: float, answer_data: dict) -> str:
    """Direction-of-error bucket for the host chart (design N3).

    Boundaries match score_numeric: "zero_*" scored 0, "partial_*" scored > 0.
    """
    answer = float(answer_data["answer"])
    full, zero = effective_tolerances(answer_data)
    eps = _eps(answer)
    diff = float(value) - answer
    if abs(diff) <= full + eps:
        return "full"
    side = "low" if diff < 0 else "high"
    if abs(diff) < zero - eps:
        return f"partial_{side}"
    return f"zero_{side}"


def reveal(answer_data: dict, config: dict) -> dict:
    """The exact client-facing reveal (design Step 1). Tolerances are the
    stored values; the frontends apply the mode for display."""
    return {
        "type": "numeric",
        "answer": answer_data.get("answer"),
        "toleranceMode": answer_data.get("toleranceMode"),
        "fullTolerance": answer_data.get("fullTolerance"),
        "zeroTolerance": answer_data.get("zeroTolerance"),
        "unit": config.get("unit") or None,
    }


def format_number(n: float) -> str:
    """Python mirror of the frontends' formatNumber (design N6)."""
    a = abs(n)
    if a >= 1e6 or 0 < a < 1e-3:
        mantissa, exponent = f"{n:.3e}".split("e")
        return f"{mantissa.rstrip('0').rstrip('.')}e{exponent}"
    s = str(float(f"{n:.6g}"))
    return s[:-2] if s.endswith(".0") else s


def with_unit(n: float, unit: str | None) -> str:
    return f"{format_number(n)} {unit}" if unit else format_number(n)
