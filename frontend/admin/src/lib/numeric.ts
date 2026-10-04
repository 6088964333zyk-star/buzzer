// numeric question helpers for the question editor (docs/design-t7-numeric.md N5, N6, N8).
// Copied from frontend/player/src/lib/numeric.ts (apps share no code); the editor
// needs only parsing and display formatting.

const NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

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
