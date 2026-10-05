import { useGame } from './GameLayout';
import { MapCanvas } from '../../components/MapCanvas';
import { imageUrl } from '../../lib/images';
import { formatPct, mapDistance, type MapPoint } from '../../lib/mapPin';
import { describeOffBy, isFullCredit, withUnit } from '../../lib/numeric';
import type { MapPinReveal, NumericReveal } from '../../types/game';

/** map_pin results: distance + points, no Correct/Incorrect (design Goldfish F). */
function MapPinResult({ reveal, point, points, completeness, mapImageId }: {
  reveal: MapPinReveal; point: MapPoint | null; points: number; completeness: boolean;
  /** T8 D7: custom map image, if the question has one. */
  mapImageId?: string | null;
}) {
  const d = point ? mapDistance(point, reveal.target, reveal.aspectRatio) : null;
  return (
    <div className="w-full max-w-md flex flex-col gap-3">
      {completeness ? (
        <p className="text-accent-fg text-3xl font-black">Thanks for playing!</p>
      ) : d !== null && d <= reveal.fullRadius ? (
        <p className="text-success-fg text-4xl font-black">Bullseye!</p>
      ) : d !== null ? (
        <p className="text-fg text-2xl font-bold">You were {formatPct(d)} of the map away</p>
      ) : (
        <p className="text-fg-subtle text-xl">No pin placed</p>
      )}
      <MapCanvas
        aspectRatio={reveal.aspectRatio}
        imageUrl={mapImageId ? imageUrl(mapImageId) : null}
        point={point}
        target={reveal.target}
        fullRadius={reveal.fullRadius}
      />
      <p className="text-fg text-3xl font-bold">+{points.toLocaleString()} pts</p>
    </div>
  );
}

/**
 * numeric results (docs/design-t7-numeric.md N7). question_results has no
 * isCorrect, so "Spot on!" is computed here with the server's rule. Without the
 * player's own value (after a reload) there's no verdict and no "off by".
 */
function NumericResult({ reveal, value, points, completeness }: {
  reveal: NumericReveal; value: number | null; points: number; completeness: boolean;
}) {
  return (
    <div className="w-full max-w-md flex flex-col gap-3">
      {completeness ? (
        <p className="text-accent-fg text-4xl font-black">Recorded!</p>
      ) : value !== null && isFullCredit(value, reveal) ? (
        <p className="text-success-fg text-4xl font-black">Spot on!</p>
      ) : null}
      {value !== null && (
        <p className="text-fg-muted text-lg">
          You: <span className="font-semibold text-fg">{withUnit(value, reveal.unit)}</span>
        </p>
      )}
      <p className="text-fg-muted text-lg">
        Answer: <span className="font-semibold text-success-fg">{withUnit(reveal.answer, reveal.unit)}</span>
      </p>
      {value !== null && (
        <p className="text-fg-subtle text-base">off by {describeOffBy(value, reveal)}</p>
      )}
      <p className="text-fg text-3xl font-bold">+{points.toLocaleString()} pts</p>
    </div>
  );
}

function describeAnswer(
  lastAnswerData: Record<string, unknown> | null,
  type: string,
  options: string[] | undefined,
): string | null {
  if (!lastAnswerData) return null;
  if (type === 'multiple_choice') {
    const idx = lastAnswerData.selectedIndex;
    if (typeof idx === 'number' && options && options[idx] !== undefined) {
      return `${String.fromCharCode(65 + idx)} — ${options[idx]}`;
    }
  }
  if (type === 'true_false') {
    return lastAnswerData.selectedValue ? 'True' : 'False';
  }
  if (type === 'fill_in_the_blank') {
    return typeof lastAnswerData.text === 'string' ? lastAnswerData.text : null;
  }
  return null;
}

export default function ResultsPage() {
  const { questionResults, currentQuestion, lastAnswerData } = useGame();

  if (!questionResults) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <p className="text-fg-subtle">Loading results…</p>
      </div>
    );
  }

  const { answerReveal, yourPoints, yourScore, yourRank, playerCount } = questionResults;

  if (answerReveal.type === 'map_pin') {
    const p = lastAnswerData?.point as MapPoint | undefined;
    return (
      <div className="min-h-screen pt-16 flex flex-col items-center justify-center p-6 gap-5 text-center">
        <MapPinResult
          mapImageId={currentQuestion?.config.mapImageId}
          reveal={answerReveal}
          point={p ?? null}
          points={yourPoints}
          completeness={currentQuestion?.gradingType === 'COMPLETENESS'}
        />
        <div className="mt-2 space-y-1">
          <p className="text-fg-muted text-lg">
            Total: <span className="font-bold text-fg">{yourScore.toLocaleString()}</span> pts
          </p>
          <p className="text-fg-subtle text-base">
            Rank <span className="font-bold text-fg">#{yourRank}</span> of {playerCount}
          </p>
        </div>
        <p className="text-fg-subtle text-sm mt-4">Waiting for next question…</p>
      </div>
    );
  }
  if (answerReveal.type === 'numeric') {
    const v = lastAnswerData?.value;
    return (
      <div className="min-h-screen pt-16 flex flex-col items-center justify-center p-6 gap-5 text-center">
        <NumericResult
          reveal={answerReveal}
          value={typeof v === 'number' ? v : null}
          points={yourPoints}
          completeness={currentQuestion?.gradingType === 'COMPLETENESS'}
        />
        <div className="mt-2 space-y-1">
          <p className="text-fg-muted text-lg">
            Total: <span className="font-bold text-fg">{yourScore.toLocaleString()}</span> pts
          </p>
          <p className="text-fg-subtle text-base">
            Rank <span className="font-bold text-fg">#{yourRank}</span> of {playerCount}
          </p>
        </div>
        <p className="text-fg-subtle text-sm mt-4">Waiting for next question…</p>
      </div>
    );
  }

  const answeredLabel = describeAnswer(
    lastAnswerData,
    currentQuestion?.type ?? '',
    currentQuestion?.config.options,
  );
  const isCompleteness = answerReveal.type === 'completeness';
  const isFitb = answerReveal.type === 'fill_in_the_blank';
  const isCorrect = !isCompleteness && yourPoints > 0;

  const fitbAccepted: string[] =
    isFitb && 'acceptedAnswers' in answerReveal ? answerReveal.acceptedAnswers : [];

  return (
    <div className="min-h-screen pt-16 flex flex-col items-center justify-center p-6 gap-5 text-center">

      {/* Correct / Wrong / Recorded */}
      {isCompleteness ? (
        <p className="text-accent-fg text-4xl font-black">Answer recorded!</p>
      ) : isCorrect ? (
        <p className="text-success-fg text-4xl font-black">Correct!</p>
      ) : (
        <p className="text-danger-fg text-4xl font-black">Incorrect</p>
      )}

      {/* What the player answered */}
      {answeredLabel && (
        <p className="text-fg-subtle text-base">
          You answered: <span className="text-fg font-semibold">{answeredLabel}</span>
        </p>
      )}

      {/* Correct answer for FITB ACCURACY */}
      {isFitb && fitbAccepted.length > 0 && (
        <p className="text-fg-subtle text-base">
          Correct: <span className="text-success-fg font-semibold">{fitbAccepted.join(' / ')}</span>
        </p>
      )}

      {/* Points for this question */}
      <p className="text-fg text-3xl font-bold">
        +{yourPoints.toLocaleString()} pts
      </p>

      {/* Running total and rank */}
      <div className="mt-2 space-y-1">
        <p className="text-fg-muted text-lg">
          Total: <span className="font-bold text-fg">{yourScore.toLocaleString()}</span> pts
        </p>
        <p className="text-fg-subtle text-base">
          Rank <span className="font-bold text-fg">#{yourRank}</span> of {playerCount}
        </p>
      </div>

      <p className="text-fg-subtle text-sm mt-4">Waiting for next question…</p>
    </div>
  );
}
