/**
 * @bainsa/audio-haptics -- Person 3's deliverable.
 *
 * Coordinated speech, sonification and haptic behaviour for the graph
 * accessibility copilot. Renders no UI: everything is methods to call and
 * events to subscribe to, so Person 4 owns how controls, status and the
 * simulator look.
 *
 * Minimal integration:
 *
 *   const engine = new AudioHapticEngine();
 *   engine.on((event) => { ...render status / live region... });
 *
 *   // From inside a click or keypress handler, or nothing is audible:
 *   await engine.unlock();
 *
 *   const response = await fetch('/extract/mock?scenario=ok').then((r) => r.json());
 *   engine.handleExtraction(response);   // speaks status + intro + summary
 *
 *   // Bind controls:
 *   engine.explore.next();  engine.explore.prev();  engine.explore.jumpToMax();
 *   engine.sonify.play();   engine.pause();  engine.resume();  engine.replay();
 *   engine.stopAll();       // reset path between demo runs
 */

import type {
  AnswerPayload,
  PresetQuestion,
  ReasoningResponse,
  EngineEvent,
  EngineListener,
  EngineStatus,
  ExtractionResponse,
  ExtractionStatus,
  FieldConfidence,
  GraphData,
  HapticPatternName,
  SonifyOptions,
} from './types.js';
import { SpeechQueue } from './speech.js';
import { Sonifier } from './sonification.js';
import {
  AudioTactileTransport,
  HAPTIC_PATTERNS,
  Haptics,
  SimulatorTransport,
  VibrationTransport,
  patternDuration,
} from './haptics.js';
import { Explorer } from './explorer.js';
import {
  describeExtractionStatus,
  describeFieldsNeedingConfirmation,
  describeGraphIntro,
  describePoint,
  describeSonification,
} from './phrasing.js';

export interface EngineOptions {
  /** Start with the audio-tactile buzz off (e.g. once on a real phone). */
  audioTactile?: boolean;
  /** Initial speech rate, 0.5-2.0. */
  rate?: number;
}

export class AudioHapticEngine {
  readonly speech: SpeechQueue;
  readonly sonifier: Sonifier;
  readonly haptics: Haptics;
  readonly explore: Explorer;

  private listeners = new Set<EngineListener>();
  private graph: GraphData | null = null;
  private fieldConfidence: FieldConfidence | null = null;
  private extractionStatus: ExtractionStatus | null = null;
  private reasoning: ReasoningResponse | null = null;
  private lastSonifyOptions: SonifyOptions = {};

  constructor(options: EngineOptions = {}) {
    const emit = (event: EngineEvent) => this.dispatch(event);

    this.speech = new SpeechQueue(emit);
    this.sonifier = new Sonifier(emit);
    this.haptics = new Haptics(emit, [
      new VibrationTransport(),
      new SimulatorTransport(),
      new AudioTactileTransport(this.sonifier),
    ]);

    if (options.audioTactile === false) this.haptics.setEnabled('audio-tactile', false);
    if (options.rate !== undefined) this.speech.setRate(options.rate);

    this.explore = new Explorer({
      speech: this.speech,
      sonifier: this.sonifier,
      haptics: this.haptics,
      emit,
      getGraph: () => this.graph,
      getFieldConfidence: () => this.fieldConfidence,
      getReasoning: () => this.reasoning,
    });
  }

  // -- events ---------------------------------------------------------------

  /** Subscribe to the whole event stream. Returns an unsubscribe function. */
  on(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private dispatch(event: EngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // A broken listener must not take the audio engine down mid-demo.
        console.error('[audio-haptics] listener threw', error);
      }
    }

    // Status is derived, so re-broadcast it after anything that changes it.
    if (event.type !== 'status:change') {
      const shouldRefresh = event.type === 'speech:start'
        || event.type === 'speech:end'
        || event.type === 'sonify:start'
        || event.type === 'sonify:end';
      if (shouldRefresh) this.broadcastStatus();
    }
  }

  private broadcastStatus(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener({ type: 'status:change', status });
      } catch (error) {
        console.error('[audio-haptics] listener threw', error);
      }
    }
  }

  // -- setup ----------------------------------------------------------------

  /**
   * Must run inside a user gesture (Person 4: the capture button). Until it
   * does, autoplay policy blocks all Web Audio silently, and on Android the
   * first utterance will not fire either.
   */
  async unlock(): Promise<boolean> {
    const ok = await this.sonifier.unlock();
    this.broadcastStatus();
    return ok;
  }

  /**
   * Hand the whole `ExtractionResponse` straight from Person 1's /extract here.
   * Branches on status so Person 4 does not reimplement that logic:
   *  - error: speaks the failure and the recovery action; loads no graph.
   *  - low_confidence: speaks the caveat and which fields to check, then the graph.
   *  - ok: speaks the intro and summary.
   */
  handleExtraction(response: ExtractionResponse): void {
    this.extractionStatus = response.status;
    const statusLine = describeExtractionStatus(response);

    if (response.status === 'error' || !response.graph) {
      this.graph = null;
      this.fieldConfidence = null;
      this.reasoning = null;
      this.explore.reset();
      if (statusLine) this.speech.speak(statusLine, 'interrupt');
      this.broadcastStatus();
      return;
    }

    this.setGraph(response.graph, response.fieldConfidence ?? null, { announce: false });

    if (statusLine) this.speech.speak(statusLine, 'interrupt');
    const confirm = describeFieldsNeedingConfirmation(response.fieldConfidence ?? null);
    if (confirm) this.speech.speak(confirm, 'normal');

    this.speakIntro();
    this.speakOverview();
  }

  /** Load a graph directly -- for corrected data, cached fallback, or mocks. */
  setGraph(
    graph: GraphData,
    fieldConfidence: FieldConfidence | null = null,
    options: { announce?: boolean } = {},
  ): void {
    this.graph = graph;
    this.fieldConfidence = fieldConfidence;
    // Stale analysis must never outlive the graph it described.
    this.reasoning = null;
    this.sonifier.stop();
    this.explore.reset();
    this.broadcastStatus();
    if (options.announce !== false) {
      this.speakIntro();
      this.speakOverview();
    }
  }

  getGraph(): GraphData | null {
    return this.graph;
  }

  /**
   * Supply Person 2's `POST /reason` result. Optional but preferred: with it,
   * point readouts carry deltas, haptic patterns use Person 2's turning-point
   * and 2%-threshold direction analysis, and pitch uses their cross-series
   * `normalised` so two series share one scale. Without it the engine falls
   * back to its own phrasing, so the demo still runs if /reason is down.
   *
   * Call it again after any user correction, since /reason must be re-run.
   */
  setReasoning(reasoning: ReasoningResponse | null): void {
    this.reasoning = reasoning;
    this.broadcastStatus();
  }

  getReasoning(): ReasoningResponse | null {
    return this.reasoning;
  }

  /**
   * Speak one of the four preset answers, then move focus to the point it
   * refers to so the user can explore the evidence rather than just hear a
   * claim. Caveats are spoken after the answer, never dropped.
   */
  ask(question: PresetQuestion): void {
    const answer = this.reasoning?.answers[question];
    if (!answer) {
      this.speech.speak('That question is not available yet.', 'interrupt');
      return;
    }

    this.speech.speak(answer.answer, 'interrupt');
    for (const caveat of answer.caveats) this.speech.speak(caveat, 'normal');

    const first = answer.highlight[0];
    if (first && this.graph) {
      // /reason identifies series by name; the explorer works in indices.
      const seriesIndex = this.graph.series.findIndex((s) => s.name === first.series);
      // Switch silently, then land on the point: one pulse, one readout.
      if (seriesIndex >= 0) this.explore.selectSeries(seriesIndex, { announce: false });
      this.explore.focus(first.index);
    }
  }

  // -- speech ---------------------------------------------------------------

  /** Graph type, title, axes, series, range -- the frame for the summary. */
  speakIntro(): void {
    if (!this.graph) return;
    this.speech.speak(describeGraphIntro(this.graph, this.fieldConfidence), 'normal');
  }

  /**
   * Person 2's summary. Falls back to the intro when `summary` is null, rather
   * than going silent -- the contract makes that field nullable.
   */
  speakOverview(text?: string): void {
    // Person 2's overview is computed from the data and explicitly supersedes
    // GraphData.summary, so it wins when /reason has been called.
    if (text === undefined && this.reasoning) {
      this.speech.speak(this.reasoning.overview.text, 'normal');
      for (const caveat of this.reasoning.overview.caveats) {
        this.speech.speak(caveat, 'normal');
      }
      return;
    }

    const summary = text ?? this.graph?.summary ?? null;
    if (summary) {
      this.speech.speak(summary, 'normal');
    } else if (this.graph) {
      this.speech.speak(
        'No summary is available for this graph, so here is what was extracted.',
        'normal',
      );
      this.speech.speak(describeSonification(this.graph), 'normal');
    }
  }

  /**
   * Speak an answer from Person 2's /reason endpoint. When the payload carries
   * `highlightPoints`, the referenced points are also marked haptically and
   * moved to, so an answer is explorable rather than just spoken.
   */
  speakAnswer(payload: AnswerPayload | string): void {
    const answer: AnswerPayload = typeof payload === 'string' ? { text: payload } : payload;
    this.speech.speak(answer.text, 'interrupt');

    const first = answer.highlightPoints?.[0];
    if (first && this.graph) {
      this.haptics.play('double');
      if (first.series < this.graph.series.length) {
        this.explore.selectSeries(first.series);
      }
      this.explore.focus(first.index);
    }
  }

  /** Text equivalent of the sonification, so no information is sound-only. */
  speakSonificationDescription(): void {
    if (!this.graph) return;
    this.speech.speak(describeSonification(this.graph, this.lastSonifyOptions.seriesIndices), 'normal');
  }

  /** Re-read the focused point without moving. */
  speakCurrentPoint(): void {
    if (!this.graph) return;
    this.speech.speak(
      describePoint(this.graph, this.explore.currentSeries, this.explore.currentPoint, this.fieldConfidence),
      'interrupt',
    );
  }

  setRate(rate: number): void {
    this.speech.setRate(rate);
    this.broadcastStatus();
  }

  // -- sonification ---------------------------------------------------------

  readonly sonify = {
    play: (options: SonifyOptions = {}): void => {
      if (!this.graph) return;
      this.lastSonifyOptions = options;
      this.sonifier.playEarcon('start');
      this.sonifier.play(this.graph, options);
    },
    replay: (): void => {
      this.sonifier.replay();
    },
    pause: (): void => {
      this.sonifier.pause();
      this.broadcastStatus();
    },
    resume: (): void => {
      this.sonifier.resume();
      this.broadcastStatus();
    },
    stop: (): void => {
      this.sonifier.stop();
      this.broadcastStatus();
    },
    /** Play one series alone -- used by "compare two series" walkthroughs. */
    series: (index: number, options: SonifyOptions = {}): void => {
      if (!this.graph) return;
      this.sonify.play({ ...options, seriesIndices: [index] });
    },
  };

  /** Fire a haptic pattern directly -- for Person 4's simulator test buttons. */
  playPattern(name: HapticPatternName): void {
    this.haptics.play(name);
  }

  // -- transport controls ---------------------------------------------------

  /** Pause both speech and sonification, as the accessibility checklist requires. */
  pause(): void {
    this.speech.pause();
    this.sonifier.pause();
    this.broadcastStatus();
  }

  resume(): void {
    this.speech.resume();
    this.sonifier.resume();
    this.broadcastStatus();
  }

  /** Replay the last utterance, and the sonification if one had been played. */
  replay(): void {
    this.speech.replay();
    if (this.sonifier.isPlaying) this.sonifier.replay();
  }

  /**
   * Full stop: speech, sonification and vibration. Person 4's reset path should
   * call this so a repeated demo never starts with leftover audio.
   */
  stopAll(): void {
    this.speech.stop();
    this.sonifier.stop();
    this.haptics.stop();
    this.broadcastStatus();
  }

  getStatus(): EngineStatus {
    return {
      audioUnlocked: this.sonifier.unlocked,
      speaking: this.speech.speaking,
      speechPaused: this.speech.isPaused,
      sonifying: this.sonifier.isPlaying,
      rate: this.speech.currentRate,
      activeTransports: this.haptics.getActiveTransports(),
      hasGraph: this.graph !== null,
      extractionStatus: this.extractionStatus,
      hasReasoning: this.reasoning !== null,
    };
  }
}

export { HAPTIC_PATTERNS, Haptics, patternDuration } from './haptics.js';
export { SpeechQueue, chunkText } from './speech.js';
export { Sonifier } from './sonification.js';
export { Explorer } from './explorer.js';
export {
  LOW_CONFIDENCE,
  describeExtractionStatus,
  describeFieldsNeedingConfirmation,
  describeGraphIntro,
  describePoint,
  describeSonification,
  speakNumber,
  speakUnit,
  speakValue,
} from './phrasing.js';
export * from './graph-utils.js';
export type * from './types.js';

/** Every pattern name, for generating Person 4's simulator test controls. */
export const HAPTIC_PATTERN_NAMES = Object.keys(HAPTIC_PATTERNS) as HapticPatternName[];
