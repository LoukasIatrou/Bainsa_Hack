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
import { Guidance } from './guidance.js';
import type { GuidanceReading } from './guidance.js';
import { isLocalExtremum, maxIndex, minIndex, pointCount } from './graph-utils.js';
import {
  describeAxes,
  describePointOfInterest,
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
  /**
   * Point readouts as "{x-label}, {value}{unit}" with no "Point 3 of 5"
   * suffix, per docs/phone-demo-navigation.md 2. Default true -- the suffix is
   * cut off by the next interrupt during fast swiping regardless.
   */
  conciseReadouts?: boolean;
}

export class AudioHapticEngine {
  readonly speech: SpeechQueue;
  readonly sonifier: Sonifier;
  readonly haptics: Haptics;
  readonly explore: Explorer;
  readonly guidance: Guidance;

  private listeners = new Set<EngineListener>();
  private graph: GraphData | null = null;
  private fieldConfidence: FieldConfidence | null = null;
  private extractionStatus: ExtractionStatus | null = null;
  private reasoning: ReasoningResponse | null = null;
  private lastSonifyOptions: SonifyOptions = {};
  private concise: boolean;

  constructor(options: EngineOptions = {}) {
    const emit = (event: EngineEvent) => this.dispatch(event);
    this.concise = options.conciseReadouts !== false;

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
      isConcise: () => this.concise,
    });

    this.guidance = new Guidance({
      haptics: this.haptics,
      sonifier: this.sonifier,
      emit,
      getGraph: () => this.graph,
      getReasoning: () => this.reasoning,
      getSeriesIndex: () => this.explore.currentSeries,
      onArrive: (index) => this.onGuidanceArrive(index),
    });
  }

  // -- Explore page: the four buttons -----------------------------------------

  /**
   * Overview button. Speaks the graph type and both axes, then starts haptic
   * guidance from the start of the curve. Guidance runs while the speech plays
   * -- the user can already be finding the curve with their finger while they
   * listen.
   */
  startOverview(): void {
    if (!this.graph) {
      this.speech.speak('No graph is loaded yet.', 'interrupt');
      return;
    }
    this.speech.speak(describeAxes(this.graph, this.fieldConfidence), 'interrupt');
    if (this.reasoning) {
      this.speech.speak(this.reasoning.overview.text, 'normal');
    } else if (this.graph.summary) {
      this.speech.speak(this.graph.summary, 'normal');
    }
    // Silent: guidance announces the first point on arrival, so speaking it
    // here as well would say it twice.
    this.explore.focus(0, { announce: false });
    this.guidance.start(0);
    this.broadcastStatus();
  }

  /**
   * Next point button. Steers the user toward the next point of interest --
   * a maximum, minimum or turning point, falling back to the next x position
   * when there is no further point of interest. Arrival is announced by
   * `onGuidanceArrive`, not here: the user has to actually get there first.
   */
  nextPoint(): void {
    if (!this.graph) {
      this.speech.speak('No graph is loaded yet.', 'interrupt');
      return;
    }
    const from = this.guidance.getCurrentIndex()
      ?? this.guidance.getTarget()
      ?? this.explore.currentPoint;
    const next = this.nextInterestingIndex(from);
    if (next === null) {
      this.speech.speak('That is the last point of the curve.', 'interrupt');
      this.haptics.play('long');
      return;
    }
    this.guidance.start(next);
    this.speech.speak('Follow the vibration to the next point.', 'interrupt');
    this.broadcastStatus();
  }

  /**
   * Explain button. Short readout of the point the user is on: where it is,
   * what it is worth, and why it matters. Then hands back to Next point.
   */
  explain(): void {
    if (!this.graph) {
      this.speech.speak('No graph is loaded yet.', 'interrupt');
      return;
    }
    // Where the finger actually is, not where it was being sent -- the user
    // may have stopped short of the target or slid past it.
    const index = this.guidance.getCurrentIndex()
      ?? this.guidance.getTarget()
      ?? this.explore.currentPoint;
    this.speech.speak(
      describePointOfInterest(
        this.graph,
        this.explore.currentSeries,
        index,
        this.interestAt(index),
        this.fieldConfidence,
      ),
      'interrupt',
    );
    this.speech.speak('Go to next point.', 'normal');
  }

  /**
   * Stop speaking button. Speech only -- haptic guidance keeps running, so
   * silencing a long explanation does not also strand the user's finger.
   */
  stopSpeaking(): void {
    this.speech.stop();
    this.broadcastStatus();
  }

  /**
   * Feed a pointer position from the chart area. Person 4 calls this on every
   * pointermove; it throttles internally. Coordinates are normalised data
   * space -- use `fromPointerEvent(event, chartEl)` to convert, which also
   * flips screen-y into data-y.
   */
  guide(x: number, y: number): GuidanceReading {
    return this.guidance.update(x, y);
  }

  /**
   * The single entry point for Person 4's exploration slider.
   *
   * docs/phone-demo-navigation.md 1 maps finger movement to a data index via a
   * native `<input type="range">`, so its `input` event drives speech, the
   * vibration pulse and the ring from one place:
   *
   *   <input type="range" min="0" max={length - 1} step="1"
   *          onInput={(e) => engine.exploreIndex(e.currentTarget.valueAsNumber)} />
   *
   * Speech uses `interrupt`, which cancels before speaking exactly as 2
   * requires, so fast swiping never builds a backlog of stale utterances.
   */
  exploreIndex(index: number, options: { pattern?: HapticPatternName } = {}): void {
    this.explore.focus(index, { pattern: options.pattern });
  }

  /** Whether readouts omit the "Point 3 of 5" suffix. */
  setConciseReadouts(concise: boolean): void {
    this.concise = concise;
  }

  /** Fired when the finger actually lands on the point it was steered toward. */
  private onGuidanceArrive(index: number): void {
    this.explore.focus(index, { announce: false });
    this.speech.speak('Explain available.', 'interrupt');
    this.broadcastStatus();
  }

  /** Person 2's flags where available, otherwise computed locally. */
  private interestAt(index: number): {
    isMax?: boolean;
    isMin?: boolean;
    isTurningPoint?: boolean;
  } {
    const graph = this.graph;
    if (!graph) return {};
    const series = graph.series[this.explore.currentSeries];
    if (!series) return {};

    const entry = this.reasoning?.series.find((s) => s.name === series.name);
    const point = entry?.points.find((p) => p.index === index);
    if (point) {
      return {
        isMax: point.isMax,
        isMin: point.isMin,
        isTurningPoint: point.isTurningPoint,
      };
    }
    return {
      isMax: maxIndex(series) === index,
      isMin: minIndex(series) === index,
      isTurningPoint: isLocalExtremum(series, index),
    };
  }

  /** Next maximum, minimum or turning point after `from`, else the next x position. */
  private nextInterestingIndex(from: number): number | null {
    const graph = this.graph;
    if (!graph) return null;
    const total = pointCount(graph);
    for (let i = from + 1; i < total; i++) {
      const interest = this.interestAt(i);
      if (interest.isMax || interest.isMin || interest.isTurningPoint) return i;
    }
    return from + 1 < total ? from + 1 : null;
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
    this.guidance.stop();
    this.haptics.stop();
    this.broadcastStatus();
  }

  /**
   * Objectively check that audio and haptics can actually work here, before
   * trusting them on stage.
   *
   * The sound check taps the master output with an AnalyserNode and measures
   * the real signal level, so it proves the engine is emitting audio even when
   * the listener hears nothing -- which separates "the code is broken" from
   * "the output device is wrong", the two failures that look identical.
   *
   * Must be called from a user gesture, like everything else that needs audio.
   */
  async selfTest(): Promise<{
    audioUnlocked: boolean;
    audioSignalLevel: number;
    audioProducingSound: boolean;
    speechVoices: number;
    speechUsable: boolean;
    speechVoice: string | null;
    vibrationApi: boolean;
    activeTransports: string[];
    problems: string[];
  }> {
    const problems: string[] = [];
    const audioUnlocked = await this.unlock();
    if (!audioUnlocked) problems.push('Audio is blocked: call unlock() from a click or keypress.');

    let level = 0;
    const ctx = this.sonifier.getContext();
    const master = this.sonifier.getMaster();
    if (ctx && master) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      master.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);

      this.sonifier.tone(440, 400, { gain: 0.9 });
      await new Promise((resolve) => setTimeout(resolve, 180));
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const v of buffer) sum += v * v;
      level = Math.sqrt(sum / buffer.length);

      master.disconnect(analyser);
    } else {
      problems.push('No AudioContext: Web Audio is unavailable in this browser.');
    }

    const producing = level > 0.01;
    if (audioUnlocked && !producing) {
      problems.push('Audio context is running but no signal reached the output.');
    }
    if (producing) {
      problems.push(
        'Engine is emitting sound. If you hear nothing, the output device is wrong '
        + '-- check which sink your system is playing to, and the volume.',
      );
    }

    const voices = this.speech.voiceCount;
    if (!this.speech.supported) {
      problems.push('No SpeechSynthesis API in this browser.');
    } else if (voices === 0) {
      problems.push(
        'SpeechSynthesis reports ZERO voices, so speech will be silent. '
        + 'Electron shells report zero always. On desktop Linux, Chrome needs '
        + '--enable-speech-dispatcher; Firefox works without a flag. Android '
        + 'Chrome is always fine.',
      );
    }

    const vibrationApi = typeof navigator !== 'undefined'
      && typeof navigator.vibrate === 'function';
    if (!vibrationApi) {
      problems.push('No Vibration API: haptics fall back to the simulator and audio buzz.');
    }

    return {
      audioUnlocked,
      audioSignalLevel: Number(level.toFixed(5)),
      audioProducingSound: producing,
      speechVoices: voices,
      speechUsable: this.speech.usable,
      speechVoice: this.speech.voiceName,
      vibrationApi,
      activeTransports: this.haptics.getActiveTransports(),
      problems,
    };
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
      speechVoices: this.speech.voiceCount,
      speechUsable: this.speech.usable,
      guiding: this.guidance.isActive,
      targetIndex: this.guidance.getTarget(),
    };
  }
}

export { HAPTIC_PATTERNS, Haptics, patternDuration } from './haptics.js';
export { SpeechQueue, chunkText } from './speech.js';
export { Sonifier } from './sonification.js';
export { Explorer } from './explorer.js';
export { Guidance, fromPointerEvent } from './guidance.js';
export {
  RING_PATTERN_LABELS,
  createRingBinding,
  ringAngle,
  toLegacyDirection,
} from './ring.js';
export type { RingState } from './ring.js';
export {
  createSpiderSenseBinding,
  indexAtX,
  patternForAngle,
} from './spider-sense.js';
export type {
  SpiderSenseBindingOptions,
  SpiderSensePoint,
  SpiderSenseStateLike,
} from './spider-sense.js';
export type { GuidanceReading, GuidanceState } from './guidance.js';
export {
  LOW_CONFIDENCE,
  describeExtractionStatus,
  describeFieldsNeedingConfirmation,
  describeGraphIntro,
  describePoint,
  describeAxes,
  describePointOfInterest,
  describeSonification,
  speakNumber,
  speakUnit,
  speakValue,
} from './phrasing.js';
export * from './graph-utils.js';
export type * from './types.js';

/** Every pattern name, for generating Person 4's simulator test controls. */
export const HAPTIC_PATTERN_NAMES = Object.keys(HAPTIC_PATTERNS) as HapticPatternName[];
