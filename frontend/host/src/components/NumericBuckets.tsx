import type { NumericReveal } from '../types/game';
import { withUnit } from '../lib/numeric';

/**
 * Direction-of-error chart for numeric questions (docs/design-t7-numeric.md N3, N7):
 * five bars from "way under" to "way over", from the answer-distribution hash the
 * server fills with bucket keys. Used large on the results screen and card-sized on
 * game over. Plain divs; labels stay readable from the back of a classroom.
 */
const BUCKETS = [
  { key: 'zero_low', label: 'Way under', bar: 'bg-surface-hover' },
  { key: 'partial_low', label: 'Close (under)', bar: 'bg-accent' },
  { key: 'full', label: 'Spot on', bar: 'bg-success' },
  { key: 'partial_high', label: 'Close (over)', bar: 'bg-accent' },
  { key: 'zero_high', label: 'Way over', bar: 'bg-surface-hover' },
] as const;

export function NumericBuckets({ reveal, distribution, size = 'large' }: {
  reveal: NumericReveal;
  distribution: Record<string, number>;
  size?: 'large' | 'card';
}) {
  const counts = BUCKETS.map(b => distribution[b.key] ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts); // never divide by zero
  const large = size === 'large';
  const chartHeight = large ? 220 : 96;

  return (
    <div className={`w-full ${large ? 'max-w-3xl space-y-4' : 'space-y-2'}`}>
      <p className={`text-center ${large ? 'text-fg-muted text-2xl' : 'text-fg-subtle text-lg'}`}>
        Answer:{' '}
        <span className={`font-black text-success-fg ${large ? 'text-5xl' : 'text-lg'}`}>
          {withUnit(reveal.answer, reveal.unit)}
        </span>
      </p>

      <div className="flex items-end gap-3" style={{ height: chartHeight }}>
        {BUCKETS.map((b, i) => (
          <div key={b.key} className="flex-1 flex flex-col items-center justify-end h-full">
            <span className={`font-bold text-fg ${large ? 'text-2xl' : 'text-lg'}`}>
              {counts[i]}
            </span>
            <div
              className={`w-full rounded-t-md ${b.bar}`}
              style={{ height: `${(counts[i] / max) * (chartHeight - (large ? 40 : 20))}px` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        {BUCKETS.map(b => (
          <span
            key={b.key}
            className={`flex-1 text-center text-fg-muted ${large ? 'text-lg' : 'text-lg leading-tight'}`}
          >
            {b.label}
          </span>
        ))}
      </div>

      <p className={`text-center text-fg-subtle ${large ? 'text-lg' : 'text-lg'}`}>
        {total === 0
          ? 'No answers'
          : `${distribution.full ?? 0} of ${total} within full credit`}
      </p>
    </div>
  );
}
