/**
 * Explain mode: a guided walkthrough of a discrete graph, point by point.
 *
 * Only exists for `discrete` graphs. A continuous curve is a shape, not a list
 * of places worth stopping at, so it gets Overview alone.
 *
 * The loop, per point:
 *
 *   1. Steer the finger toward the point (the guidance layer does the pulsing).
 *   2. On arrival, a `double` pulse confirms the finger is on the right point.
 *   3. Speak the explanation.
 *   4. When the speech finishes, advance to the next point and steer again.
 *
 * Step 4 keys off the speech queue actually draining, not a timer. Explanations
 * vary in length, and a guess would either cut them off or leave dead air.
 */

import type { GraphData } from './types.js';

export interface ExplainModeDeps {
  getGraph: () => GraphData | null;
  getPointCount: () => number;
  /** Steer the finger at this point; arrival calls back into `onArrive`. */
  setTarget: (index: number) => void;
  /** Stop steering entirely. */
  clearTarget: () => void;
  speak: (text: string, priority: 'interrupt' | 'normal') => void;
  /** The explanation for one point. */
  describe: (index: number) => string;
  pulse: (pattern: 'double' | 'long') => void;
  onChange: () => void;
}

export class ExplainMode {
  private running = false;
  private index = 0;
  /** True between arriving at a point and its explanation finishing. */
  private explaining = false;
  /** Guards against a stray idle event ending the walkthrough early. */
  private awaitingArrival = false;

  constructor(private readonly deps: ExplainModeDeps) {}

  get active(): boolean {
    return this.running;
  }

  /** 1-based, for display. Null when not running. */
  get step(): number | null {
    return this.running ? this.index + 1 : null;
  }

  get currentIndex(): number | null {
    return this.running ? this.index : null;
  }

  start(from = 0): void {
    const total = this.deps.getPointCount();
    if (total === 0) return;

    this.running = true;
    this.index = Math.min(Math.max(0, from), total - 1);
    this.explaining = false;
    this.awaitingArrival = true;

    this.deps.speak(
      this.index === 0
        ? 'Explain mode. Follow the vibration to the first point.'
        : 'Follow the vibration to the next point.',
      'interrupt',
    );
    this.deps.setTarget(this.index);
    this.deps.onChange();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.explaining = false;
    this.awaitingArrival = false;
    this.deps.clearTarget();
    this.deps.onChange();
  }

  /**
   * The finger reached the point it was steered to. Confirm by touch, then
   * explain. Ignores arrivals at any other index, so brushing past a
   * neighbouring point does not skip the walkthrough forward.
   */
  handleArrival(index: number): void {
    if (!this.running || !this.awaitingArrival) return;
    if (index !== this.index) return;

    this.awaitingArrival = false;
    this.explaining = true;
    // No pulse here: the guidance layer already fired `double` on arriving at
    // the target, and firing a second one would double-buzz the confirmation.
    this.deps.speak(this.deps.describe(this.index), 'interrupt');
    this.deps.onChange();
  }

  /**
   * Speech finished. If it was an explanation, move on to the next point.
   *
   * Called for every drain, including the "follow the vibration" prompt, so
   * `explaining` gates it -- otherwise the walkthrough would advance before
   * the user had reached anything.
   */
  handleSpeechIdle(): void {
    if (!this.running || !this.explaining) return;
    this.explaining = false;

    const total = this.deps.getPointCount();
    if (this.index + 1 >= total) {
      this.deps.pulse('long');
      this.deps.speak('That was the last point. Explain mode finished.', 'normal');
      this.running = false;
      this.deps.clearTarget();
      this.deps.onChange();
      return;
    }

    this.index += 1;
    this.awaitingArrival = true;
    this.deps.speak('Follow the vibration to the next point.', 'normal');
    this.deps.setTarget(this.index);
    this.deps.onChange();
  }

  /** Skip ahead without waiting for the current explanation to finish. */
  skip(): void {
    if (!this.running) return;
    this.explaining = true;
    this.handleSpeechIdle();
  }
}
