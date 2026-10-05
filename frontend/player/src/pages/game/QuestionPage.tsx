import { useRef, useState, useCallback } from 'react';
import { useGame } from './GameLayout';
import { TimerBar } from '../../components/ui/TimerBar';
import { MapCanvas } from '../../components/MapCanvas';
import type { MapPoint } from '../../lib/mapPin';
import { parseNumber, withUnit } from '../../lib/numeric';
import { imageUrl } from '../../lib/images';

// Game-show answer colors (T9 design T5): token fills that pass WCAG AA with their text color
// in both themes. Hover/press brighten instead of switching shade.
const OPTION_COLORS = [
  'bg-option-1 text-on-option-1',
  'bg-option-2 text-on-option-2',
  'bg-option-3 text-on-option-3',
  'bg-option-4 text-on-option-4',
  'bg-option-5 text-on-option-5',
  'bg-option-6 text-on-option-6',
  'bg-option-7 text-on-option-7',
  'bg-option-8 text-on-option-8',
];

function optionLabel(i: number): string {
  return String.fromCharCode(65 + i); // A, B, C, … Z
}

// ---- option images (docs/design-t8-images.md D4) ----

/** Per-option image ids when any option has one (tile layout), else null (list layout). */
function tileImages(ids: (string | null)[] | undefined, count: number): (string | null)[] | null {
  if (!ids || !ids.some((id) => id)) return null;
  return Array.from({ length: count }, (_, i) => ids[i] ?? null);
}

/**
 * Square image area of a tile, capped at 20vh so two rows of tiles fit on one
 * screen; a tile without an image keeps the same height (Goldfish 12).
 */
function OptionTileImage({ id, text }: { id: string | null; text: string }) {
  return id ? (
    <img src={imageUrl(id)} alt={text} className="w-full aspect-square max-h-[20vh] object-contain rounded-xl bg-bg/25" />
  ) : (
    <span className="w-full aspect-square max-h-[20vh] rounded-xl bg-bg/25 flex items-center justify-center text-center px-2 text-base">
      {text}
    </span>
  );
}

export default function QuestionPage() {
  const { currentQuestion, questionLocked, emitAnswer } = useGame();
  const startTimeRef = useRef(Date.now());
  const [submitted, setSubmitted] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [mapPoint, setMapPoint] = useState<MapPoint | null>(null);

  const toggleIndex = useCallback((i: number) => {
    if (submitted || questionLocked) return;
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }, [submitted, questionLocked]);

  if (!currentQuestion) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <p className="text-fg-subtle">Loading question…</p>
      </div>
    );
  }

  function submit(answerData: Record<string, unknown>) {
    if (submitted) return;
    setSubmitted(true);
    emitAnswer(currentQuestion!.questionId, answerData, Date.now() - startTimeRef.current);
  }

  const questionLabel = (
    <p className="text-fg-subtle text-sm text-center tracking-wide uppercase mb-1">
      Question {currentQuestion.questionNumber} of {currentQuestion.totalQuestions}
    </p>
  );

  const lockedMsg = (
    <p className="text-center text-warning-fg text-sm mt-4 font-semibold">
      Answers locked — waiting for results…
    </p>
  );

  if (currentQuestion.type === 'multiple_choice') {
    const options = currentQuestion.config.options ?? [];
    const images = tileImages(currentQuestion.config.optionImages, options.length);
    return (
      <div className="pt-16 pb-6 px-4 flex flex-col gap-3">
        <div className="pb-2">
          {questionLabel}
          <TimerBar key={currentQuestion.questionId} totalSeconds={currentQuestion.timeLimitSeconds} paused={questionLocked} />
        </div>
        <div className={images ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-3'}>
          {options.map((opt, i) => (
            <button
              key={i}
              disabled={submitted || questionLocked}
              onClick={() => submit({ selectedIndex: i })}
              className={`w-full flex ${images ? 'flex-col p-2 gap-2' : 'items-center gap-4 px-5 py-4'} rounded-2xl text-left font-semibold text-lg border-2 border-fg/10 hover:brightness-110 transition-all
                ${submitted || questionLocked ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}
                ${OPTION_COLORS[i % OPTION_COLORS.length]}`}
            >
              {images && <OptionTileImage id={images[i]} text={opt} />}
              <span className="flex items-center gap-2">
                <span className={`${images ? 'text-lg' : 'text-2xl w-8'} font-black shrink-0`}>{optionLabel(i)}</span>
                <span>{opt}</span>
              </span>
            </button>
          ))}
        </div>
        {submitted && <p className="text-center text-fg-subtle text-sm mt-4">Answer submitted — waiting for results…</p>}
        {!submitted && questionLocked && lockedMsg}
      </div>
    );
  }

  if (currentQuestion.type === 'true_false') {
    return (
      <div className="min-h-screen pt-16 flex flex-col justify-center p-4 gap-4">
        {questionLabel}
        <TimerBar key={currentQuestion.questionId} totalSeconds={currentQuestion.timeLimitSeconds} paused={questionLocked} />
        <button
          disabled={submitted || questionLocked}
          onClick={() => submit({ selectedValue: true })}
          className={`w-full rounded-2xl py-8 text-on-status font-black text-3xl border-2 border-success transition-all
            ${submitted || questionLocked ? 'opacity-50 cursor-not-allowed bg-success' : 'bg-success hover:brightness-110 active:scale-95'}`}
        >
          True
        </button>
        <button
          disabled={submitted || questionLocked}
          onClick={() => submit({ selectedValue: false })}
          className={`w-full rounded-2xl py-8 text-on-status font-black text-3xl border-2 border-danger transition-all
            ${submitted || questionLocked ? 'opacity-50 cursor-not-allowed bg-danger' : 'bg-danger hover:brightness-110 active:scale-95'}`}
        >
          False
        </button>
        {submitted && <p className="text-center text-fg-subtle text-sm mt-2">Answer submitted — waiting for results…</p>}
        {!submitted && questionLocked && lockedMsg}
      </div>
    );
  }

  if (currentQuestion.type === 'fill_in_the_blank') {
    const maxLength = currentQuestion.config.maxLength ?? 100;
    return (
      <div className="min-h-screen pt-16 flex flex-col justify-center p-4 gap-5">
        {questionLabel}
        <TimerBar key={currentQuestion.questionId} totalSeconds={currentQuestion.timeLimitSeconds} paused={questionLocked} />

        {submitted ? (
          <div className="flex flex-col items-center gap-3">
            <div className="text-5xl">🔒</div>
            <p className="text-fg text-xl font-bold">Answer locked in!</p>
            <p className="text-fg-subtle text-base italic">"{inputValue.trim()}"</p>
            <p className="text-fg-subtle text-sm mt-2">Waiting for results…</p>
          </div>
        ) : questionLocked ? (
          <div className="flex flex-col items-center gap-3 mt-4">
            {lockedMsg}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = inputValue.trim();
              if (trimmed) submit({ text: trimmed });
            }}
            className="flex flex-col gap-4"
          >
            <input
              type="text"
              maxLength={maxLength}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type your answer…"
              autoFocus
              className="w-full rounded-xl px-4 py-4 text-fg text-xl bg-surface-raised border-2 border-border-strong placeholder:text-fg-subtle"
            />
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="w-full rounded-2xl py-5 text-on-accent font-black text-2xl bg-accent hover:bg-accent-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit
            </button>
          </form>
        )}
      </div>
    );
  }

  if (currentQuestion.type === 'multi_select') {
    const options = currentQuestion.config.options ?? [];
    const msImages = tileImages(currentQuestion.config.optionImages, options.length);
    return (
      <div className="pt-16 pb-6 px-4 flex flex-col gap-3">
        <div className="pb-2">
          {questionLabel}
          <TimerBar key={currentQuestion.questionId} totalSeconds={currentQuestion.timeLimitSeconds} paused={questionLocked} />
        </div>
        <p className="text-center text-fg-subtle text-sm">Select all that apply</p>
        <div className={msImages ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-3'}>
        {options.map((opt, i) => {
          const isSelected = selectedIndices.has(i);
          return (
            <button
              key={i}
              disabled={submitted || questionLocked}
              onClick={() => toggleIndex(i)}
              className={`w-full flex ${msImages ? 'flex-col p-2 gap-2' : 'items-center gap-4 px-5 py-4'} rounded-2xl text-left font-semibold text-lg border-2 transition-all
                ${submitted || questionLocked ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}
                ${isSelected
                  ? 'bg-accent border-accent text-on-accent'
                  : 'bg-surface-raised border-border-strong text-fg hover:bg-surface-hover'
                }`}
            >
              {msImages && <OptionTileImage id={msImages[i]} text={opt} />}
              <span className="flex items-center gap-3">
              <span className={`text-xl font-black w-8 shrink-0 flex items-center justify-center rounded-md border-2 transition-colors
                ${isSelected ? 'border-on-accent bg-on-accent text-accent' : 'border-border-strong text-fg-subtle'}`}>
                {isSelected ? '✓' : optionLabel(i)}
              </span>
              <span>{opt}</span>
              </span>
            </button>
          );
        })}
        </div>
        {!submitted && !questionLocked && (
          <button
            disabled={selectedIndices.size === 0}
            onClick={() => submit({ selectedIndices: Array.from(selectedIndices) })}
            className="w-full rounded-2xl py-5 text-on-accent font-black text-2xl bg-accent hover:bg-accent-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed mt-2"
          >
            Submit ({selectedIndices.size} selected)
          </button>
        )}
        {submitted && <p className="text-center text-fg-subtle text-sm mt-4">Answer submitted — waiting for results…</p>}
        {!submitted && questionLocked && lockedMsg}
      </div>
    );
  }

  if (currentQuestion.type === 'numeric') {
    // No prompt on the phone (convention); iOS's decimal keypad has no '-' or 'e',
    // hence the two buttons (docs/design-t7-numeric.md N5).
    const unit = currentQuestion.config.unit;
    const parsed = parseNumber(inputValue);
    const showError = inputValue.trim() !== '' && parsed === null;
    const toggleSign = () =>
      setInputValue(v => (v.startsWith('-') ? v.slice(1) : `-${v}`));
    const addExponent = () =>
      setInputValue(v => (/[eE]/.test(v) ? v : `${v}e`));
    return (
      <div className="min-h-screen pt-16 flex flex-col justify-center p-4 gap-5">
        {questionLabel}
        <TimerBar key={currentQuestion.questionId} totalSeconds={currentQuestion.timeLimitSeconds} paused={questionLocked} />

        {submitted ? (
          <div className="flex flex-col items-center gap-3">
            <div className="text-5xl">🔒</div>
            <p className="text-fg text-xl font-bold">Answer locked in!</p>
            {parsed !== null && <p className="text-fg-subtle text-base">{withUnit(parsed, unit)}</p>}
            <p className="text-fg-subtle text-sm mt-2">Waiting for results…</p>
          </div>
        ) : questionLocked ? (
          <div className="flex flex-col items-center gap-3 mt-4">
            {lockedMsg}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed !== null) submit({ value: parsed });
            }}
            className="flex flex-col gap-4"
          >
            <p className="text-center text-fg-subtle text-sm">Type your estimate</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="e.g. 0.62"
                autoFocus
                aria-invalid={showError}
                aria-label="Your estimate"
                className="flex-1 min-w-0 rounded-xl px-4 py-4 text-fg text-2xl bg-surface-raised border-2 border-border-strong placeholder:text-fg-subtle"
              />
              {unit && <span className="text-fg-muted text-xl font-semibold shrink-0">{unit}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={toggleSign}
                className="rounded-xl py-4 text-2xl font-bold bg-surface-raised text-fg hover:bg-surface-hover active:scale-95"
                aria-label="Toggle minus sign"
              >
                ±
              </button>
              <button
                type="button"
                onClick={addExponent}
                className="rounded-xl py-4 text-2xl font-bold bg-surface-raised text-fg hover:bg-surface-hover active:scale-95"
                aria-label="Times ten to the power"
              >
                ×10ⁿ
              </button>
            </div>
            {showError && (
              <p className="text-warning-fg text-sm text-center">Use digits and a dot, e.g. 0.62 or 6.02e23</p>
            )}
            <button
              type="submit"
              disabled={parsed === null}
              className="w-full rounded-2xl py-5 text-on-accent font-black text-2xl bg-accent hover:bg-accent-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit
            </button>
          </form>
        )}
      </div>
    );
  }

  if (currentQuestion.type === 'map_pin') {
    const locked = submitted || questionLocked;
    return (
      <div className="pt-16 pb-6 px-4 flex flex-col gap-3">
        <div className="pb-2">
          {questionLabel}
          <TimerBar key={currentQuestion.questionId} totalSeconds={currentQuestion.timeLimitSeconds} paused={questionLocked} />
        </div>
        <p className="text-center text-fg-subtle text-sm">
          {locked ? 'Your pin' : mapPoint ? 'Tap again to move your pin' : 'Tap the map where you think it is'}
        </p>
        <MapCanvas
          aspectRatio={currentQuestion.config.aspectRatio ?? 2}
          imageUrl={currentQuestion.config.mapImageId ? imageUrl(currentQuestion.config.mapImageId) : null}
          point={mapPoint}
          onPoint={locked ? undefined : setMapPoint}
        />
        {!locked && (
          <button
            disabled={!mapPoint}
            onClick={() => mapPoint && submit({ point: mapPoint })}
            className="w-full rounded-2xl py-5 text-on-accent font-black text-2xl bg-accent hover:bg-accent-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed mt-2"
          >
            Submit
          </button>
        )}
        {submitted && <p className="text-center text-fg-subtle text-sm mt-2">Answer submitted — waiting for results…</p>}
        {!submitted && questionLocked && lockedMsg}
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-16 flex items-center justify-center p-6">
      <p className="text-fg-subtle">Unsupported question type.</p>
    </div>
  );
}
