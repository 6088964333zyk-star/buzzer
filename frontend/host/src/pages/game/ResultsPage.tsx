import { useEffect, useState } from 'react';
import { NumericBuckets } from '../../components/NumericBuckets';
import { useGame } from './GameLayout';
import { Button } from '../../components/ui/button';
import type { AnswerReveal } from '../../types/game';
import { MapCanvas } from '../../components/MapCanvas';
import { distributionDots } from '../../lib/mapPin';
import { imageUrl } from '../../lib/images';

const RESULTS_DISPLAY_SECONDS = 10;

function optionLabel(i: number): string {
  return String.fromCharCode(65 + i);
}

// ---------------------------------------------------------------------------
// Levenshtein distance — used to colour word-cloud entries for FITB questions
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ---------------------------------------------------------------------------
// Word Cloud — for fill_in_the_blank questions
// ---------------------------------------------------------------------------

interface WordCloudProps {
  distribution: Record<string, number>;
  answerReveal: AnswerReveal;
  totalAnswered: number;
  totalPlayers: number;
}

function WordCloud({ distribution, answerReveal, totalAnswered, totalPlayers }: WordCloudProps) {
  const entries = Object.entries(distribution).sort(([, a], [, b]) => b - a);
  const maxCount = Math.max(...entries.map(([, c]) => c), 1);

  const isAccuracy =
    'type' in answerReveal && answerReveal.type === 'fill_in_the_blank';
  const acceptedAnswers: string[] =
    isAccuracy && 'acceptedAnswers' in answerReveal
      ? (answerReveal as { type: 'fill_in_the_blank'; acceptedAnswers: string[]; editDistance: number }).acceptedAnswers.map(a => a.toLowerCase())
      : [];
  const editDistance: number =
    isAccuracy && 'editDistance' in answerReveal
      ? (answerReveal as { type: 'fill_in_the_blank'; acceptedAnswers: string[]; editDistance: number }).editDistance
      : 0;

  function sizeClass(count: number): string {
    const f = count / maxCount;
    if (f > 0.75) return 'text-5xl font-black';
    if (f > 0.5)  return 'text-4xl font-bold';
    if (f > 0.25) return 'text-3xl font-semibold';
    if (f > 0.1)  return 'text-2xl font-medium';
    return 'text-xl';
  }

  function isCorrectWord(word: string): boolean {
    if (!isAccuracy || acceptedAnswers.length === 0) return false;
    return acceptedAnswers.some(a => levenshtein(word.toLowerCase(), a) <= editDistance);
  }

  return (
    <div className="w-full max-w-3xl flex flex-col gap-4">
      {isAccuracy && acceptedAnswers.length > 0 && (
        <p className="text-center text-fg-subtle text-lg">
          Correct answer:{' '}
          <span className="text-success-fg font-semibold">
            {(answerReveal as { acceptedAnswers: string[] }).acceptedAnswers.join(' / ')}
            {editDistance > 0 && (
              <span className="text-fg-subtle font-normal text-lg ml-1">(±{editDistance})</span>
            )}
          </span>
        </p>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-3 justify-center items-center min-h-32 p-4 bg-surface-raised/60 rounded-2xl">
        {entries.map(([word, count]) => (
          <span
            key={word}
            title={`${count} player${count !== 1 ? 's' : ''}`}
            className={`${sizeClass(count)} transition-colors ${
              isCorrectWord(word) ? 'text-success-fg' : 'text-fg-muted'
            }`}
          >
            {word}
          </span>
        ))}
        {entries.length === 0 && (
          <p className="text-fg-subtle text-lg">No answers submitted</p>
        )}
      </div>

      <p className="text-fg-subtle text-lg text-right">
        {totalAnswered} / {totalPlayers} answered
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar Chart — for multiple_choice and true_false
// ---------------------------------------------------------------------------

interface BarChartProps {
  bars: { label: string; count: number; correct: boolean | null; image?: string | null }[];
  totalAnswered: number;
  totalPlayers: number;
}

function AnswerBarChart({ bars, totalAnswered, totalPlayers }: BarChartProps) {
  const maxCount = Math.max(...bars.map(b => b.count), 1);

  return (
    <div className="w-full max-w-2xl space-y-3">
      {bars.map((bar, i) => {
        const pct = Math.round((bar.count / maxCount) * 100);
        const barColor =
          bar.correct === true
            ? 'bg-success text-on-status'
            : bar.correct === false
            ? 'bg-surface-hover text-fg'
            : 'bg-accent text-on-accent';

        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-fg-muted font-bold font-mono w-8 text-right shrink-0">
              {bar.label}
            </span>
            {bar.image && (
              <img src={imageUrl(bar.image)} alt="" className="h-10 w-10 object-cover rounded shrink-0" />
            )}
            <div className="flex-1 bg-surface-raised rounded-full h-10 overflow-hidden">
              <div
                className={`h-full rounded-full flex items-center justify-end pr-3 transition-all duration-500 ${barColor}`}
                style={{ width: `${Math.max(pct, bar.count > 0 ? 4 : 0)}%` }}
              >
                {bar.count > 0 && (
                  <span className="font-bold text-lg">{bar.count}</span>
                )}
              </div>
            </div>
            {bar.correct === true && (
              <span className="text-success-fg text-lg font-semibold shrink-0">✓ Correct</span>
            )}
            {bar.count === 0 && bar.correct !== true && (
              <span className="text-fg-subtle text-lg shrink-0">0</span>
            )}
          </div>
        );
      })}

      <p className="text-fg-subtle text-lg text-right pt-1">
        {totalAnswered} / {totalPlayers} answered
      </p>
    </div>
  );
}

function buildBars(
  reveal: AnswerReveal,
  distribution: Record<string, number>,
  options: string[] | undefined,
): BarChartProps['bars'] {
  if (reveal.type === 'multiple_choice') {
    const opts = options ?? [];
    return opts.map((opt, i) => ({
      label: `${optionLabel(i)}  ${opt}`,
      count: distribution[String(i)] ?? 0,
      correct: reveal.correctIndices.includes(i),
    }));
  }

  if (reveal.type === 'multi_select') {
    const opts = options ?? [];
    return opts.map((opt, i) => ({
      label: `${optionLabel(i)}  ${opt}`,
      count: distribution[String(i)] ?? 0,
      correct: (reveal.answerPoints[i] ?? 0) > 0,
    }));
  }

  if (reveal.type === 'true_false') {
    return [
      { label: 'True', count: distribution['true'] ?? 0, correct: reveal.correctValue === true },
      { label: 'False', count: distribution['false'] ?? 0, correct: reveal.correctValue === false },
    ];
  }

  // completeness (non-FITB) — no right/wrong
  if (options && options.length > 0) {
    return options.map((opt, i) => ({
      label: `${optionLabel(i)}  ${opt}`,
      count: distribution[String(i)] ?? 0,
      correct: null,
    }));
  }

  if ('true' in distribution || 'false' in distribution) {
    return [
      { label: 'True', count: distribution['true'] ?? 0, correct: null },
      { label: 'False', count: distribution['false'] ?? 0, correct: null },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResultsPage() {
  const { questionResults, currentQuestion, autoAdvance, emitAdvance } = useGame();
  const [countdown, setCountdown] = useState(RESULTS_DISPLAY_SECONDS);

  const isLast = currentQuestion
    ? currentQuestion.questionNumber >= currentQuestion.totalQuestions
    : false;

  useEffect(() => {
    if (!autoAdvance) return;
    setCountdown(RESULTS_DISPLAY_SECONDS);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(interval); emitAdvance(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [autoAdvance, questionResults, emitAdvance]);

  const isFitb = currentQuestion?.type === 'fill_in_the_blank';
  const mapReveal =
    questionResults && 'type' in questionResults.answerReveal &&
    questionResults.answerReveal.type === 'map_pin'
      ? questionResults.answerReveal
      : null;

  const numericReveal =
    questionResults && 'type' in questionResults.answerReveal &&
    questionResults.answerReveal.type === 'numeric'
      ? questionResults.answerReveal
      : null;

  const optionImages =
    currentQuestion?.type === 'multiple_choice' || currentQuestion?.type === 'multi_select'
      ? currentQuestion.config.optionImages
      : undefined;
  const bars =
    !isFitb && questionResults
      ? buildBars(
          questionResults.answerReveal,
          questionResults.answerDistribution,
          currentQuestion?.config?.options,
        ).map((bar, i) => ({ ...bar, image: optionImages?.[i] ?? null }))
      : [];
  // T8 D4: thumbnails next to the bars; the text label stays.
  // (Set only for MC / multi-select, so the index lines up with the options.)

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-8">
      <h2 className="text-3xl font-bold text-fg">
        Question {currentQuestion?.questionNumber} Results
      </h2>

      {currentQuestion?.config.imageId && (
        <img
          src={imageUrl(currentQuestion.config.imageId)}
          alt=""
          className="max-h-[30vh] max-w-full object-contain rounded-xl"
        />
      )}
      {currentQuestion && (
        <p className="text-fg-muted text-3xl text-center max-w-3xl">
          {currentQuestion.prompt}
        </p>
      )}

      {questionResults && mapReveal ? (
        <div className="w-full max-w-4xl space-y-2">
          <MapCanvas
            aspectRatio={mapReveal.aspectRatio}
            imageUrl={currentQuestion?.config.mapImageId ? imageUrl(currentQuestion.config.mapImageId) : null}
            target={mapReveal.target}
            fullRadius={mapReveal.fullRadius}
            zeroRadius={mapReveal.zeroRadius}
            dots={distributionDots(questionResults.answerDistribution)}
          />
          <p className="text-fg-subtle text-center">
            {questionResults.totalAnswered} / {questionResults.totalPlayers} guessed · green pin is the answer
          </p>
        </div>
      ) : questionResults && numericReveal ? (
        <NumericBuckets
          reveal={numericReveal}
          distribution={questionResults.answerDistribution}
        />
      ) : questionResults && isFitb ? (
        <WordCloud
          distribution={questionResults.answerDistribution}
          answerReveal={questionResults.answerReveal}
          totalAnswered={questionResults.totalAnswered}
          totalPlayers={questionResults.totalPlayers}
        />
      ) : questionResults ? (
        <AnswerBarChart
          bars={bars}
          totalAnswered={questionResults.totalAnswered}
          totalPlayers={questionResults.totalPlayers}
        />
      ) : null}

      <div className="flex flex-col items-center gap-2">
        <Button size="lg" onClick={emitAdvance} className="px-10">
          {isLast ? 'Show Final Results' : 'Next Question'}
        </Button>
        {autoAdvance && (
          <p className="text-fg-subtle text-lg tabular-nums">
            Auto-advancing in {countdown}s
          </p>
        )}
      </div>
    </div>
  );
}
