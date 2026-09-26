/**
 * Point-by-point exploration.
 *
 * This is the object Person 4 binds arrow keys and large buttons to: Person 3
 * owns what happens on each move, Person 4 owns the controls that trigger it.
 *
 * Every move fires one coordinated response -- a haptic pattern, a tone, and an
 * interrupting spoken readout -- so the three channels always describe the same
 * point.
 */

import type {
  EngineEvent,
  FieldConfidence,
  GraphData,
  HapticPatternName,
  ReasoningPoint,
  ReasoningResponse,
} from './types.js';
import type { Haptics } from './haptics.js';
import type { Sonifier } from './sonification.js';
import type { SpeechQueue } from './speech.js';
import { describePoint } from './phrasing.js';
import {
  direction,
  isLocalExtremum,
  maxIndex,
  minIndex,
  pointCount,
  xLabel,
} from './graph-utils.js';

interface ExplorerDeps {
  speech: SpeechQueue;
  sonifier: Sonifier;
  haptics: Haptics;
  emit: (event: EngineEvent) => void;
  getGraph: () => GraphData | null;
  getFieldConfidence: () => FieldConfidence | null;
  /** Person 2's analysis, when /reason has been called. Null falls back to local phrasing. */
  getReasoning: () => ReasoningResponse | null;
  /**
   * Concise readouts drop the "Point 3 of 5" suffix, matching
   * docs/phone-demo-navigation.md 2 ("{x-label}, {value}{unit}"). During fast
   * swiping the suffix is cut off by the next interrupt anyway, so it costs
   * nothing and shortens every utterance.
   */
  isConcise: () => boolean;
}

export class Explorer {
  private seriesIndex = 0;
  private pointIndex = 0;

  constructor(private readonly deps: ExplorerDeps) {}

  get currentSeries(): number {
    return this.seriesIndex;
  }

  get currentPoint(): number {
    return this.pointIndex;
  }

  /** Called when a new graph is loaded, so exploration restarts cleanly. */
  reset(): void {
    this.seriesIndex = 0;
    this.pointIndex = 0;
  }

  next(): void {
    const graph = this.deps.getGraph();
    if (!graph) return;
    const last = pointCount(graph) - 1;
    if (this.pointIndex >= last) {
      this.announceBoundary('end');
      return;
    }
    this.pointIndex += 1;
    this.announce();
  }

  prev(): void {
    const graph = this.deps.getGraph();
    if (!graph) return;
    if (this.pointIndex <= 0) {
      this.announceBoundary('start');
      return;
    }
    this.pointIndex -= 1;
    this.announce();
  }

  first(): void {
    if (!this.deps.getGraph()) return;
    this.pointIndex = 0;
    this.announce();
  }

  last(): void {
    const graph = this.deps.getGraph();
    if (!graph) return;
    this.pointIndex = Math.max(0, pointCount(graph) - 1);
    this.announce();
  }

  /**
   * `announce: false` moves the cursor without speaking or pulsing.
   * `pattern` overrides the data-driven choice -- used when the caller already
   * knows the move means something else, such as arriving on the curve.
   */
  focus(
    index: number,
    options: { announce?: boolean; pattern?: HapticPatternName } = {},
  ): void {
    const graph = this.deps.getGraph();
    if (!graph) return;
    const clamped = Math.min(Math.max(0, index), Math.max(0, pointCount(graph) - 1));
    this.pointIndex = clamped;
    if (options.announce === false) {
      this.emitFocus(graph);
      return;
    }
    this.announce(options.pattern ? { pattern: options.pattern } : {});
  }

  /** Jumps to the highest *readable* value; nulls are never treated as zero. */
  jumpToMax(): void {
    this.jumpToExtreme('max');
  }

  jumpToMin(): void {
    this.jumpToExtreme('min');
  }

  private jumpToExtreme(which: 'max' | 'min'): void {
    const graph = this.deps.getGraph();
    if (!graph) return;
    const series = graph.series[this.seriesIndex];
    if (!series) return;

    const target = which === 'max' ? maxIndex(series) : minIndex(series);
    if (target === -1) {
      this.deps.speech.speak(
        `No readable values in ${series.name}, so there is no ${which === 'max' ? 'maximum' : 'minimum'} to move to.`,
        'interrupt',
      );
      this.deps.haptics.play('long');
      return;
    }

    this.pointIndex = target;
    const prefix = which === 'max' ? 'Highest point.' : 'Lowest point.';
    this.deps.sonifier.playEarcon(which === 'max' ? 'max' : 'min');
    this.announce({ prefix, pattern: 'double' });
  }

  /**
   * `announce: false` switches series silently -- used when a caller is about
   * to move focus anyway, so the user does not get a pulse and a readout for a
   * point that was only ever passed through.
   */
  selectSeries(index: number, options: { announce?: boolean } = {}): void {
    const graph = this.deps.getGraph();
    if (!graph) return;
    if (index < 0 || index >= graph.series.length) return;
    this.seriesIndex = index;
    if (options.announce === false) {
      this.emitFocus(graph);
      return;
    }
    // No prefix: describePoint already leads with the series name whenever
    // there is more than one, so a prefix here would say it twice.
    this.announce();
  }

  /** Cycles series, for a single "switch series" control. */
  nextSeries(): void {
    const graph = this.deps.getGraph();
    if (!graph || graph.series.length < 2) return;
    this.selectSeries((this.seriesIndex + 1) % graph.series.length);
  }

  /** Re-announce the current point without moving -- a "where am I" control. */
  announceCurrent(): void {
    this.announce();
  }

  private announceBoundary(edge: 'start' | 'end'): void {
    const graph = this.deps.getGraph();
    if (!graph) return;
    this.deps.haptics.play('long');
    this.deps.sonifier.playEarcon('boundary');
    this.deps.speech.speak(
      edge === 'start' ? 'Start of the series.' : 'End of the series.',
      'interrupt',
    );
    this.emitFocus(graph);
  }

  /** Person 2's analysis for the focused point, when /reason has been called. */
  private reasoningPoint(): ReasoningPoint | null {
    const reasoning = this.deps.getReasoning();
    const graph = this.deps.getGraph();
    if (!reasoning || !graph) return null;
    const seriesName = graph.series[this.seriesIndex]?.name;
    if (seriesName === undefined) return null;
    // Match by name: /reason keys series by name, not by index.
    const entry = reasoning.series.find((s) => s.name === seriesName);
    return entry?.points.find((p) => p.index === this.pointIndex) ?? null;
  }

  private announce(options: { prefix?: string; pattern?: HapticPatternName } = {}): void {
    const graph = this.deps.getGraph();
    if (!graph) return;
    const series = graph.series[this.seriesIndex];
    if (!series) return;

    const analysis = this.reasoningPoint();
    // Emit the new index BEFORE the pattern. Consumers that key both the ring
    // dot and the pulse flash off one index would otherwise briefly render the
    // new pattern at the previous angle.
    this.emitFocus(graph);
    this.deps.haptics.play(options.pattern ?? this.patternForCurrent(graph, analysis));
    this.deps.sonifier.sonifyPoint(graph, this.seriesIndex, this.pointIndex, {
      // Person 2 normalises across every series, so pitches stay comparable
      // between them. Without /reason the sonifier normalises locally.
      normalised: analysis?.normalised ?? null,
    });

    // Prefer Person 2's ready-to-speak readout -- it carries the delta
    // ("up 5 from February") that a locally generated one cannot know.
    const readout = analysis?.readout
      ?? describePoint(graph, this.seriesIndex, this.pointIndex, this.deps.getFieldConfidence(), {
        includePosition: !this.deps.isConcise(),
      });
    const text = options.prefix ? `${options.prefix} ${readout}` : readout;
    // 'interrupt' so holding an arrow key always speaks the point under the
    // cursor now, instead of working through a backlog.
    this.deps.speech.speak(text, 'interrupt');
  }

  private patternForCurrent(
    graph: GraphData,
    analysis: ReasoningPoint | null,
  ): HapticPatternName {
    // Person 2's flags are authoritative when present: isTurningPoint catches
    // genuine trend reversals, and their `direction` ignores moves under 2% of
    // the range rather than treating any wobble as a rise.
    if (analysis) {
      if (analysis.value === null) return 'long';
      if (analysis.isMax || analysis.isMin || analysis.isTurningPoint) return 'double';
      if (analysis.direction === 'up') return 'rising';
      if (analysis.direction === 'down') return 'falling';
      return 'short';
    }

    const series = graph.series[this.seriesIndex];
    if (!series) return 'short';

    const value = series.values[this.pointIndex] ?? null;
    // An unreadable point gets the boundary-ish long pulse rather than the
    // normal move pattern, so it is unmistakable by touch alone.
    if (value === null) return 'long';

    if (isLocalExtremum(series, this.pointIndex)) return 'double';

    const dir = direction(series, this.pointIndex);
    if (dir === 'up') return 'rising';
    if (dir === 'down') return 'falling';
    return 'short';
  }

  private emitFocus(graph: GraphData): void {
    const series = graph.series[this.seriesIndex];
    if (!series) return;
    this.deps.emit({
      type: 'focus:change',
      series: this.seriesIndex,
      seriesName: series.name,
      index: this.pointIndex,
      label: xLabel(graph, this.pointIndex),
      value: series.values[this.pointIndex] ?? null,
    });
  }
}
