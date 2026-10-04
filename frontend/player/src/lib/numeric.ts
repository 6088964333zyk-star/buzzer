// numeric question helpers (docs/design-t7-numeric.md N5, N6, N7).
// Mirrors backend/app/services/numeric.py; the server computes points, the
// client parses input, formats numbers and shows the "Spot on!" verdict.
import type { NumericReveal } from '../types/game';

const NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const EPS_SCALE = 1e-9;

/** Plain or scientific notation, no commas. Returns null if it doesn't parse to a finite number. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!NUMBER_RE.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Display only — never use it to fill an editable field (it rounds). */
export function formatNumber(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6 || (a > 0 && a < 1e-3)) {
    const [mantissa, exponent] = n.toExponential(3).split('e');
    return `${mantissa.replace(/\.?0+$/, '')}e${exponent}`;
  }
  return String(Number(n.toPrecision(6)));
}

export function withUnit(n: number, unit: string | null | undefined): string {
  return unit ? `${formatNumber(n)} ${unit}` : formatNumber(n);
}

/** (full, zero) in the answer's unit, after applying toleranceMode. */
export function effectiveTolerances(r: NumericReveal): [number, number] {
  if (r.toleranceMode === 'percent') {
    const scale = Math.abs(r.answer) / 100;
    return [r.fullTolerance * scale, r.zeroTolerance * scale];
  }
  return [r.fullTolerance, r.zeroTolerance];
}

/** Same rule and epsilon as the server's score_numeric (design N2). */
export function isFullCredit(value: number, r: NumericReveal): boolean {
  const [full] = effectiveTolerances(r);
  const eps = EPS_SCALE * Math.max(1, Math.abs(r.answer));
  return Math.abs(value - r.answer) <= full + eps;
}

/** "17 m/s" or, in percent mode, "17 m/s (5.0%)". */
export function describeOffBy(value: number, r: NumericReveal): string {
  const d = Math.abs(value - r.answer);
  const base = withUnit(d, r.unit);
  if (r.toleranceMode === 'percent' && r.answer !== 0) {
    return `${base} (${((d / Math.abs(r.answer)) * 100).toFixed(1)}%)`;
  }
  return base;
}
