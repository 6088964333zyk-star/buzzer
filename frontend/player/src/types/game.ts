export interface SyncStatePayload {
  status: 'LOBBY' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
  playerCount: number;
  questionLocked?: boolean;
}

export interface PlayerJoinedPayload {
  playerCount: number;
}

export type QuestionType =
  | 'multiple_choice' | 'true_false' | 'fill_in_the_blank' | 'multi_select' | 'map_pin' | 'numeric';

export interface MapPinReveal {
  type: 'map_pin';
  target: { x: number; y: number };
  fullRadius: number;
  zeroRadius: number;
  aspectRatio: number;
}

/** Matches backend services/numeric.reveal exactly (docs/design-t7-numeric.md Step 1). */
export interface NumericReveal {
  type: 'numeric';
  answer: number;
  toleranceMode: 'absolute' | 'percent';
  fullTolerance: number;
  zeroTolerance: number;
  unit: string | null;
}

export interface QuestionPayload {
  questionId: number;
  questionNumber: number;
  totalQuestions: number;
  type: QuestionType;
  prompt: string;
  gradingType?: 'ACCURACY' | 'COMPLETENESS';
  config: QuestionConfig;
  timeLimitSeconds: number;
  pointsValue: number;
}

export interface AnswerResultPayload {
  questionId: number;
  isCorrect: boolean;
  pointsAwarded: number;
  totalScore: number;
  alreadyAnswered?: boolean;
}

export type PlayerAnswerReveal =
  | { type: 'multiple_choice'; correctIndices: number[] }
  | { type: 'true_false'; correctValue: boolean }
  | { type: 'fill_in_the_blank'; acceptedAnswers: string[]; editDistance: number }
  | { type: 'completeness' }
  | { type: 'multi_select'; answerPoints: number[] }
  | MapPinReveal
  | NumericReveal;

export interface PlayerResultsPayload {
  questionId: number;
  answerReveal: PlayerAnswerReveal;
  yourPoints: number;
  yourScore: number;
  yourRank: number;
  playerCount: number;
}

export interface QuestionSummaryItem {
  questionId: number;
  prompt: string;
  type: QuestionType;
  gradingType: 'ACCURACY' | 'COMPLETENESS';
  config: QuestionConfig;
  pointsAwarded: number;
  maxPoints: number;
  answerTimeMs: number | null;
  playerAnswer: {
    selectedIndex?: number;
    selectedValue?: boolean;
    text?: string;
    selectedIndices?: number[];
    point?: { x: number; y: number };
    value?: number;
  } | null;
  answerReveal: PlayerAnswerReveal;
}

export interface PlayerGameOverPayload {
  yourFinalScore: number;
  yourFinalRank: number;
  playerCount: number;
  questionSummary: QuestionSummaryItem[];
}

export type PlayerPhase = 'lobby' | 'question' | 'feedback' | 'results' | 'gameover';

/** Question config as sent to clients. T8 image keys: docs/design-t8-images.md. */
export interface QuestionConfig {
  options?: string[];
  maxLength?: number;
  aspectRatio?: number;
  unit?: string;
  /** Prompt image: shown on the big screen only, never on the phone (D3). */
  imageId?: string | null;
  /** One entry per option (MC / multi-select). */
  optionImages?: (string | null)[];
  /** map_pin background; absent = built-in world map. */
  mapImageId?: string | null;
}
