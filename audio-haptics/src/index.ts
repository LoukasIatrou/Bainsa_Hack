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
  GraphKind,
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
import { ExplainMode } from './explain-mode.js';
import { MenuController } from './menu.js';
import type { AppMode, MenuItem } from './menu.js';
import { GestureRecogniser } from './gestures.js';
import type { Gesture } from './gestures.js';
import type { GuidanceReading } from './guidance.js';
import {
  inferGraphKind,
  isLocalExtremum,
  maxIndex,
  minIndex,
  pointCount,
} from './graph-utils.js';
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
  /**
   * Use the phone's vibration motor. **Off by default.**
   *
   * `navigator.vibrate()` is accepted and then silently ignored on a great many
   * Android builds -- OEM skins, battery saver, Do Not Disturb -- and the API
   * never reports that it did nothing. Rather than let the demo depend on a
   * channel that cannot be verified, the audio-tactile buzz and the ring
   * simulator carry the haptic meaning, and vibration is opt-in once a human
   * has confirmed it works on the actual handset.
   */
  vibration?: boolean;
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
  readonly explainMode: ExplainMode;
  readonly menu: MenuController;
  readonly gestures: GestureRecogniser;

  private listeners = new Set<EngineListener>();
  private graph: GraphData | null = null;
  private fieldConfidence: FieldConfidence | null = null;
  private extractionStatus: ExtractionStatus | null = null;
  private reasoning: ReasoningResponse | null = null;
  private lastSonifyOptions: SonifyOptions = {};
  private concise: boolean;
  private graphKind: GraphKind = 'discrete';
  private pointerConverter:
    ((clientX: number, clientY: number) => { x: number; y: number } | null) | null = null;

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

    // Opt-in: see EngineOptions.vibration.
    if (options.vibration !== true) this.haptics.setEnabled('vibration', false);
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

    this.explainMode = new ExplainMode({
      getGraph: () => this.graph,
      getPointCount: () => (this.graph ? pointCount(this.graph) : 0),
      setTarget: (index) => this.guidance.start(index),
      clearTarget: () => this.guidance.setTarget(null),
      speak: (text, priority) => this.speech.speak(text, priority),
      describe: (index) => this.explanationFor(index),
      pulse: (pattern) => this.haptics.play(pattern),
      onChange: () => this.broadcastStatus(),
    });

    this.on((event) => {
      if (event.type === 'speech:idle') this.explainMode.handleSpeechIdle();
    });

    this.menu = new MenuController({
      speak: (text, priority) => this.speech.speak(text, priority),
      pulse: (pattern) => this.haptics.play(pattern),
      onChange: () => this.broadcastStatus(),
      onEnterGraphMode: () => {
        if (this.graph) this.guidance.start(this.explainMode.currentIndex ?? null);
      },
      onExitGraphMode: () => {
        this.guidance.stop();
      },
    });
    this.menu.setItems(this.defaultMenuItems());

    this.gestures = new GestureRecogniser(
      (gesture) => this.handleGesture(gesture),
      { isTracing: () => this.menu.currentMode === 'graph' },
    );
  }

  // -- gestures and the spoken menu -------------------------------------------

  /**
   * The default actions, adapting to what the graph supports. Replace wholesale
   * with `engine.menu.setItems()` if the app wants different ones.
   *
   * Explain is absent rather than disabled on a continuous curve: reading out
   * an option that cannot be chosen wastes a swipe.
   */
  private defaultMenuItems(): MenuItem[] {
    return [
      {
        id: 'overview',
        label: 'Overview',
        hint: 'Hear the shape of the whole graph.',
        activate: () => {
          this.menu.setMode('graph');
          this.startOverview();
        },
      },
      {
        id: 'explain',
        label: 'Explain each point',
        hint: 'Guided walk through every point.',
        available: () => this.supportsExplainMode && this.graph !== null,
        activate: () => {
          this.menu.setMode('graph');
          this.startExplainMode();
        },
      },
      {
        id: 'graph',
        label: 'Explore freely',
        hint: 'Trace the curve with a finger.',
        available: () => this.graph !== null,
        activate: () => this.menu.setMode('graph'),
      },
      {
        id: 'repeat',
        label: 'Repeat that',
        activate: () => this.replay(),
      },
      {
        id: 'series',
        label: 'Switch series',
        available: () => (this.graph?.series.length ?? 0) > 1,
        activate: () => this.explore.nextSeries(),
      },
      {
        id: 'stop',
        label: 'Stop speaking',
        activate: () => this.stopSpeaking(),
      },
    ];
  }

  /**
   * Feed pointer events here and the engine handles both modes:
   *
   *   el.addEventListener('pointerdown', (e) => engine.gestures.pointerDown(e));
   *   el.addEventListener('pointermove', (e) => engine.gestures.pointerMove(e));
   *   el.addEventListener('pointerup',   (e) => engine.gestures.pointerUp(e));
   *
   * The element needs `touch-action: none`, or the browser will scroll instead.
   */
  private handleGesture(gesture: Gesture): void {
    // Works in both modes, and is the only gesture that does.
    if (gesture.type === 'two-finger-tap') {
      this.menu.toggleMode();
      return;
    }

    if (this.menu.currentMode === 'menu') {
      switch (gesture.type) {
        case 'swipe':
          if (gesture.direction === 'right' || gesture.direction === 'down') this.menu.next();
          else this.menu.previous();
          return;
        case 'tap':
          this.menu.activate();
          return;
        case 'long-press':
          this.menu.announceCurrent();
          return;
        default:
          return;
      }
    }

    // Graph mode: dragging traces the curve, a tap re-reads where the finger is.
    switch (gesture.type) {
      case 'drag': {
        // Gestures carry client pixels; guidance works in normalised data
        // space. Without a converter the app is driving guidance itself, so
        // feeding raw pixels here would read as "off-chart" and buzz wrongly.
        if (!this.pointerConverter) return;
        const point = this.pointerConverter(gesture.x, gesture.y);
        if (point) this.guidance.update(point.x, point.y);
        return;
      }
      case 'tap':
        this.speakCurrentPoint();
        return;
      case 'long-press':
        this.explain();
        return;
      default:
    }
  }

  /**
   * Teach the engine how to turn client pixels into normalised data space, so
   * drags recognised by the gesture layer can drive guidance directly.
   *
   * y must increase *upward* (0 at the graph minimum, 1 at the maximum), the
   * opposite of clientY -- `fromPointerEvent` does that conversion.
   *
   *   engine.setPointerConverter((x, y) => fromPointerEvent({ clientX: x, clientY: y }, chartEl));
   *
   * Without one, drag gestures are ignored and the app is assumed to be calling
   * `engine.guide()` itself.
   */
  setPointerConverter(
    convert: ((clientX: number, clientY: number) => { x: number; y: number } | null) | null,
  ): void {
    this.pointerConverter = convert;
  }

  /** Current interaction mode. */
  getMode(): AppMode {
    return this.menu.currentMode;
  }

  setMode(mode: AppMode): void {
    this.menu.setMode(mode);
  }

  // -- graph kind -------------------------------------------------------------

  /**
   * Continuous curves get Overview only; discrete graphs also get Explain mode.
   *
   * Inferred from the data on load, but inference is a heuristic -- set it
   * explicitly when the caller knows, for instance because the curve came from
   * sampling a function rather than from extraction.
   */
  setGraphKind(kind: GraphKind): void {
    this.graphKind = kind;
    if (kind === 'continuous' && this.explainMode.active) this.explainMode.stop();
    this.broadcastStatus();
  }

  getGraphKind(): GraphKind {
    return this.graphKind;
  }

  /** Whether Explain mode is offered at all. False for continuous curves. */
  get supportsExplainMode(): boolean {
    return this.graphKind === 'discrete';
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

    // A continuous curve has no point worth stopping at, so guidance steers the
    // finger onto the line and then simply follows it -- no target, no arrival.
    // A discrete graph starts at the first point.
    this.guidance.start(this.graphKind === 'continuous' ? null : 0);
    this.broadcastStatus();
  }

  // -- Explain mode (discrete graphs only) ------------------------------------

  /**
   * Walk the finger through every point in turn: steer, confirm with a `double`
   * pulse on arrival, explain, then steer to the next once the explanation has
   * finished speaking.
   *
   * Refused for continuous curves, which have no discrete points to stop on.
   */
  startExplainMode(from = 0): void {
    if (!this.graph) {
      this.speech.speak('No graph is loaded yet.', 'interrupt');
      return;
    }
    if (this.graphKind === 'continuous') {
      this.speech.speak(
        'This is a continuous curve, so there are no separate points to explain. '
        + 'Use Overview to trace its shape.',
        'interrupt',
      );
      this.haptics.play('long');
      return;
    }
    this.explainMode.start(from);
  }

  stopExplainMode(): void {
    this.explainMode.stop();
  }

  /** Move on without waiting for the current explanation to finish. */
  skipToNextExplanation(): void {
    this.explainMode.skip();
  }

  /** The text Explain mode speaks at one point. */
  private explanationFor(index: number): string {
    if (!this.graph) return '';
    return describePointOfInterest(
      this.graph,
      this.explore.currentSeries,
      index,
      this.interestAt(index),
      this.fieldConfidence,
    );
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
    if (this.explainMode.active) {
      // The walkthrough owns what happens next: confirm, then explain.
      this.explainMode.handleArrival(index);
      return;
    }
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
    this.graphKind = inferGraphKind(graph);
    this.explainMode.stop();
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
    this.explainMode.stop();
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
    /** What navigator.vibrate() returned on the test pulse. */
    vibrateAccepted: boolean | null;
    /** Whether the page has the user activation vibrate() requires. */
    userActivated: boolean | null;
    secureContext: boolean;
    pageVisible: boolean;
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

    // Fire a real pattern so the return value below means something.
    if (vibrationApi) this.haptics.play('double');
    const vibrateAccepted = this.haptics.lastVibrateResult;

    const activation = (navigator as unknown as {
      userActivation?: { isActive: boolean; hasBeenActive: boolean };
    }).userActivation;
    const userActivated = activation ? activation.hasBeenActive : null;
    const pageVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
    const secureContext = typeof window !== 'undefined' && window.isSecureContext;

    if (vibrationApi && vibrateAccepted === false) {
      problems.push(
        'navigator.vibrate() returned FALSE -- the request was rejected. Usually '
        + 'no user activation yet: tap the page once, then try again.',
      );
    }
    if (vibrationApi && userActivated === false) {
      problems.push('The page has no user activation yet. Tap it once before testing vibration.');
    }
    if (vibrationApi && vibrateAccepted === true) {
      problems.push(
        'vibrate() was ACCEPTED. If nothing moved: this is a laptop (the API is a '
        + 'no-op there), or on Android check silent mode, Do Not Disturb, battery '
        + 'saver, and Settings > Sound > Vibration. An accepted call is not proof '
        + 'the motor ran -- the API never reports that.',
      );
    }
    if (!pageVisible) problems.push('Page is not visible; vibration is suppressed in the background.');

    return {
      audioUnlocked,
      audioSignalLevel: Number(level.toFixed(5)),
      audioProducingSound: producing,
      speechVoices: voices,
      speechUsable: this.speech.usable,
      speechVoice: this.speech.voiceName,
      vibrationApi,
      vibrateAccepted,
      userActivated,
      secureContext,
      pageVisible,
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
      graphKind: this.graphKind,
      mode: this.menu.currentMode,
      menuItem: this.menu.current?.label ?? null,
      menuPosition: this.menu.position,
      explaining: this.explainMode.active,
      explainStep: this.explainMode.step,
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
export { ExplainMode } from './explain-mode.js';
export { MenuController } from './menu.js';
export type { AppMode, MenuItem } from './menu.js';
export { GestureRecogniser } from './gestures.js';
export type { Gesture, GestureOptions, SwipeDirection } from './gestures.js';
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
