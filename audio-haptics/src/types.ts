/**
 * Types for the audio + haptic engine.
 *
 * The first half mirrors `contracts/graph-data.schema.json` and
 * `contracts/extraction-response.schema.json`. Those schema files are the
 * source of truth for the whole team -- if these interfaces drift from them,
 * that is a bug here, not there.
 *
 * The second half is Person 3's own surface: the speech/haptic commands and
 * the event stream Person 4 codes against. The team brief notes the shared
 * schema deliberately says nothing about audio/haptic commands, so these are
 * defined here and documented in `contracts/haptic-patterns.md`.
 */

// ---------------------------------------------------------------------------
// Mirrored from contracts/ -- do not change without changing the schema
// ---------------------------------------------------------------------------

/** Scoped to line graphs for now; other chart types are future scope. */
export type GraphType = 'line';

export interface XAxis {
  label: string;
  values: string[];
}

export interface YAxis {
  label: string;
  /** null when the unit could not be read from the image. */
  unit?: string | null;
}

export interface Series {
  name: string;
  /** Aligned with xAxis.values by index. null means the value could not be read. */
  values: (number | null)[];
}

export interface GraphData {
  graphType: GraphType;
  title: string;
  xAxis: XAxis;
  yAxis: YAxis;
  series: Series[];
  summary?: string | null;
  /** Overall extraction confidence, 0-1. Illustrative, not a verified probability. */
  confidence: number;
}

export type ExtractionStatus = 'ok' | 'low_confidence' | 'error';

/** Per-field confidence, 0-1, used to decide which fields need a spoken caveat. */
export interface FieldConfidence {
  graphType: number;
  title: number;
  xAxis: number;
  yAxis: number;
  series: number;
}

export interface ExtractionResponse {
  status: ExtractionStatus;
  /** Present when status is 'ok' or 'low_confidence'. */
  graph?: GraphData | null;
  fieldConfidence?: FieldConfidence | null;
  /** Human-readable reason for a low_confidence or error status. */
  message?: string | null;
}

// ---------------------------------------------------------------------------
// Person 3's surface
// ---------------------------------------------------------------------------

/**
 * `interrupt` cancels whatever is speaking -- used for point readouts during
 * arrow-key exploration, which must respond to the current keypress rather
 * than queue behind the previous one.
 * `normal` queues. `background` is dropped if anything else is pending.
 */
export type SpeechPriority = 'interrupt' | 'normal' | 'background';

export type HapticPatternName = 'short' | 'double' | 'long' | 'rising' | 'falling';

/** How the simulator should render intensity across the pattern. */
export type HapticRamp = 'none' | 'up' | 'down';

export interface HapticPatternSpec {
  name: HapticPatternName;
  /**
   * navigator.vibrate() format: even indices are vibration durations in ms,
   * odd indices are the silent gaps between them.
   */
  timings: number[];
  ramp: HapticRamp;
  /** The agreed meaning, so the simulator can label what it is showing. */
  meaning: string;
}

export interface PointRef {
  series: number;
  index: number;
}

/**
 * A simple spoken answer. Person 2's `/reason` uses the richer
 * `ReasoningAnswer` below; this remains for ad-hoc or free-form answers that do
 * not come from that endpoint.
 */
export interface AnswerPayload {
  text: string;
  highlightPoints?: PointRef[];
  seriesRefs?: number[];
}

export type SonifyMode = 'continuous' | 'discrete';

export interface SonifyOptions {
  mode?: SonifyMode;
  /** Total playback length in ms for the whole series. */
  durationMs?: number;
  minFreq?: number;
  maxFreq?: number;
  /** Snap pitches to a pentatonic scale -- easier to compare than a raw glide. */
  quantise?: boolean;
  /** Pan left-to-right across the x-axis to give position a spatial cue. */
  pan?: boolean;
  /** Which series to play. Defaults to all of them, simultaneously. */
  seriesIndices?: number[];
}

export interface EngineStatus {
  /** False until unlock() has run inside a user gesture. Nothing is audible before then. */
  audioUnlocked: boolean;
  speaking: boolean;
  speechPaused: boolean;
  sonifying: boolean;
  /** Speech rate, 0.5-2.0. */
  rate: number;
  /** Ids of the haptic transports actually available on this device. */
  activeTransports: string[];
  hasGraph: boolean;
  extractionStatus: ExtractionStatus | null;
  /** True once Person 2's /reason result has been supplied via setReasoning(). */
  hasReasoning: boolean;
}

export type EngineEvent =
  | { type: 'speech:start'; text: string; priority: SpeechPriority }
  | { type: 'speech:end'; text: string }
  /** Every spoken utterance, so Person 4 can mirror it into an ARIA live region. */
  | { type: 'speech:caption'; text: string; priority: SpeechPriority }
  | { type: 'sonify:start'; total: number }
  | { type: 'sonify:progress'; index: number; total: number }
  | { type: 'sonify:end' }
  | {
      type: 'haptic:pattern';
      pattern: HapticPatternName;
      timings: number[];
      ramp: HapticRamp;
      meaning: string;
      /** Which transports actually played it, for honest status labelling. */
      transports: string[];
    }
  | {
      type: 'focus:change';
      series: number;
      seriesName: string;
      index: number;
      label: string;
      value: number | null;
    }
  | { type: 'status:change'; status: EngineStatus };

export type EngineEventType = EngineEvent['type'];
export type EngineListener = (event: EngineEvent) => void;

/** A haptic output channel. Several run at once; each reports its own availability. */
export interface HapticTransport {
  readonly id: string;
  /** False when the device cannot do this (e.g. no vibration motor on a laptop). */
  readonly available: boolean;
  play(spec: HapticPatternSpec): void;
  stop(): void;
}

// ---------------------------------------------------------------------------
// Mirrored from contracts/reasoning-response.schema.json (Person 2's /reason)
// ---------------------------------------------------------------------------

/**
 * Person 2's schema carries fields designed for this engine: `normalised` is
 * computed across ALL series so they share one pitch scale, and
 * `changeStrength` is an explicit 0-1 haptic/audio intensity. When a
 * ReasoningResponse is supplied the engine prefers it over its own phrasing
 * and analysis; without one it falls back to `phrasing.ts`, so the demo still
 * works if /reason is unavailable.
 */
export interface ReasoningHighlight {
  /** Series *name*, not an index -- resolved against GraphData.series by name. */
  series: string;
  index: number;
}

export interface ReasoningAnswer {
  /** Ready-to-speak text. */
  answer: string;
  highlight: ReasoningHighlight[];
  /** Uncertainty to announce, e.g. unreadable values or low confidence. */
  caveats: string[];
}

export type PresetQuestion = 'trend' | 'max' | 'changes' | 'compare';

export interface ReasoningOverview {
  text: string;
  caveats: string[];
}

export type PointDirection = 'up' | 'down' | 'flat' | 'unknown';

export interface ReasoningPoint {
  index: number;
  x: string;
  value: number | null;
  /** (value - min) / (max - min) across every series. Drives pitch directly. */
  normalised: number | null;
  delta: number | null;
  /** |delta| / range, capped at 1. Scales haptic and audio intensity. */
  changeStrength: number | null;
  direction: PointDirection;
  isMax: boolean;
  isMin: boolean;
  isTurningPoint: boolean;
  lowConfidence: boolean;
  /** Ready-to-speak, e.g. "March, 12 degrees Celsius, up 5 from February." */
  readout: string;
}

export interface ReasoningSeries {
  name: string;
  /** Spoken when the user switches to this series. */
  intro: string;
  points: ReasoningPoint[];
}

export interface ReasoningResponse {
  overview: ReasoningOverview;
  answers: Record<PresetQuestion, ReasoningAnswer>;
  series: ReasoningSeries[];
  range: { min: number | null; max: number | null };
  lowConfidence: boolean;
  /** Whether texts were reworded by an LLM or are deterministic templates. */
  phrasing: 'template' | 'llm';
}
