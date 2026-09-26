/**
 * Haptic curve-following for the Explore page.
 *
 * The user drags a finger over the chart. This decides, continuously, whether
 * they are on the curve and which way to push them if not:
 *
 *   off curve   -> `rising` / `falling` pointing toward the curve, repeating
 *                  faster the closer they get
 *   on curve    -> a distinct `double` on arrival, then a `short` tick each
 *                  time they cross into a new x position, so following the
 *                  curve sideways feels like running along a ridge
 *   off chart   -> `long`
 *
 * Coordinates are **normalised data space**, not screen space:
 *   x: 0 at the first x-axis value, 1 at the last
 *   y: 0 at the graph's minimum value, 1 at its maximum -- so y increases
 *      *upward*, the opposite of a DOM clientY. Use `fromPointerEvent` to
 *      convert; getting this backwards inverts every direction cue.
 */

import type {
  EngineEvent,
  GraphData,
  HapticPatternName,
  ReasoningResponse,
} from './types.js';
import type { Haptics } from './haptics.js';
import type { Sonifier } from './sonification.js';
import { normalise, pointCount, valueRange } from './graph-utils.js';

/** Within this vertical distance (as a fraction of the value range) counts as on the curve. */
const ON_CURVE_TOLERANCE = 0.06;
/** Pulse repeat interval when the finger is far from the curve, and when it is nearly there. */
const FAR_INTERVAL_MS = 700;
const NEAR_INTERVAL_MS = 140;
/** Minimum gap between on-curve x ticks, so sliding fast does not machine-gun. */
const TICK_INTERVAL_MS = 90;

export type GuidanceState = 'idle' | 'off-curve' | 'on-curve' | 'off-chart';

export interface GuidanceReading {
  state: GuidanceState;
  /** Nearest x index to the finger. */
  index: number;
  /** The curve's normalised height at the finger's x, or null where unreadable. */
  curveY: number | null;
  /** curveY - fingerY. Positive means the curve is above the finger. */
  delta: number | null;
  /** 'up' / 'down' = move the finger that way. 'none' = on the curve. */
  push: 'up' | 'down' | 'none';
}

export interface GuidanceDeps {
  haptics: Haptics;
  sonifier: Sonifier;
  emit: (event: EngineEvent) => void;
  getGraph: () => GraphData | null;
  getReasoning: () => ReasoningResponse | null;
  getSeriesIndex: () => number;
  /** Called when the finger lands on the index that was set as the target. */
  onArrive: (index: number) => void;
}

/** Convert a pointer event over an element into normalised data space. */
export function fromPointerEvent(
  event: { clientX: number; clientY: number },
  element: { getBoundingClientRect(): DOMRect },
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  const x = rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width;
  // Screen y grows downward; data y grows upward. Flip it.
  const y = rect.height === 0 ? 0 : 1 - (event.clientY - rect.top) / rect.height;
  return { x, y };
}

export class Guidance {
  private active = false;
  private lastPulseAt = 0;
  private lastTickAt = 0;
  private lastState: GuidanceState = 'idle';
  private lastIndex = -1;
  private targetIndex: number | null = null;
  private announcedArrival = false;
  /** Last x index the finger was actually on the curve at. */
  private currentIndex: number | null = null;

  constructor(private readonly deps: GuidanceDeps) {}

  get isActive(): boolean {
    return this.active;
  }

  get state(): GuidanceState {
    return this.lastState;
  }

  /**
   * Where the finger last actually was on the curve -- which is not
   * necessarily the target it was being steered toward. "Explain" must
   * describe this, or it narrates a point the user never reached.
   */
  getCurrentIndex(): number | null {
    return this.currentIndex;
  }

  start(targetIndex: number | null = null): void {
    this.active = true;
    this.targetIndex = targetIndex;
    this.announcedArrival = false;
    this.lastState = 'idle';
    this.lastIndex = -1;
    this.currentIndex = null;
    this.lastPulseAt = 0;
    this.lastTickAt = 0;
  }

  stop(): void {
    this.active = false;
    this.lastState = 'idle';
    this.deps.haptics.stop();
  }

  /** Aim the user at a particular x position; arrival fires `onArrive`. */
  setTarget(index: number | null): void {
    this.targetIndex = index;
    this.announcedArrival = false;
  }

  getTarget(): number | null {
    return this.targetIndex;
  }

  /** Normalised curve heights for the active series, null where unreadable. */
  private curve(): (number | null)[] | null {
    const graph = this.deps.getGraph();
    if (!graph) return null;
    const series = graph.series[this.deps.getSeriesIndex()];
    if (!series) return null;

    // Prefer Person 2's `normalised`: it is computed across every series, so
    // guidance stays consistent when the user switches series.
    const reasoning = this.deps.getReasoning();
    const entry = reasoning?.series.find((s) => s.name === series.name);
    if (entry) {
      return series.values.map((_, i) => {
        const point = entry.points.find((p) => p.index === i);
        return point ? point.normalised : null;
      });
    }

    const range = valueRange(graph);
    if (!range) return null;
    return series.values.map((v) => (v === null ? null : normalise(v, range.min, range.max)));
  }

  /** Curve height at a continuous x, interpolating between readable neighbours. */
  private curveAt(curve: (number | null)[], x: number): number | null {
    const n = curve.length;
    if (n === 0) return null;
    if (n === 1) return curve[0] ?? null;

    const pos = Math.min(Math.max(0, x), 1) * (n - 1);
    const i = Math.floor(pos);
    const frac = pos - i;
    const a = curve[i] ?? null;
    const b = curve[Math.min(n - 1, i + 1)] ?? null;

    if (a === null && b === null) return null;
    // A gap should not be silently bridged -- fall back to whichever end is
    // readable rather than inventing a slope across missing data.
    if (a === null) return b;
    if (b === null) return a;
    return a + (b - a) * frac;
  }

  /** Read the finger position without emitting anything. */
  read(x: number, y: number): GuidanceReading {
    const graph = this.deps.getGraph();
    const curve = this.curve();
    if (!graph || !curve) {
      return { state: 'idle', index: 0, curveY: null, delta: null, push: 'none' };
    }

    const total = pointCount(graph);
    const index = Math.min(total - 1, Math.max(0, Math.round(x * (total - 1))));

    if (x < -0.02 || x > 1.02 || y < -0.05 || y > 1.05) {
      return { state: 'off-chart', index, curveY: null, delta: null, push: 'none' };
    }

    const curveY = this.curveAt(curve, x);
    if (curveY === null) {
      // Over a stretch that could not be read: no honest direction to give.
      return { state: 'off-curve', index, curveY: null, delta: null, push: 'none' };
    }

    const delta = curveY - y;
    if (Math.abs(delta) <= ON_CURVE_TOLERANCE) {
      return { state: 'on-curve', index, curveY, delta, push: 'none' };
    }
    return {
      state: 'off-curve',
      index,
      curveY,
      delta,
      push: delta > 0 ? 'up' : 'down',
    };
  }

  /**
   * Feed a pointer position. Call on every pointermove -- this throttles
   * internally, so it never fires a 270ms pattern faster than it can play.
   */
  update(x: number, y: number, now = Date.now()): GuidanceReading {
    const reading = this.read(x, y);
    if (!this.active) return reading;

    const enteredCurve = reading.state === 'on-curve' && this.lastState !== 'on-curve';
    const leftCurve = reading.state !== 'on-curve' && this.lastState === 'on-curve';

    if (reading.state === 'off-chart') {
      if (this.lastState !== 'off-chart' || now - this.lastPulseAt > FAR_INTERVAL_MS) {
        this.fire('long', reading, now);
      }
      this.lastState = reading.state;
      return reading;
    }

    if (enteredCurve) {
      // `double` means "on the right point", not merely "on the curve". When a
      // target is set and the finger lands somewhere else along the line, that
      // gets a plain tick instead -- otherwise the confirmation pulse would lie
      // about where the user is.
      const atTarget = this.targetIndex === null || reading.index === this.targetIndex;
      this.fire(atTarget ? 'double' : 'short', reading, now);
      this.sonifyIndex(reading.index);
      this.lastIndex = reading.index;
      this.currentIndex = reading.index;
      this.lastState = reading.state;
      this.checkArrival(reading.index);
      return reading;
    }

    if (reading.state === 'on-curve') {
      // Tick once per new x position, so sliding along feels like detents --
      // except when that position IS the target, which earns the confirmation
      // `double`. Reaching the target by tracing along the curve is the normal
      // case, not an edge case.
      if (reading.index !== this.lastIndex && now - this.lastTickAt >= TICK_INTERVAL_MS) {
        const hittingTarget = this.targetIndex !== null
          && reading.index === this.targetIndex
          && !this.announcedArrival;
        this.fire(hittingTarget ? 'double' : 'short', reading, now);
        this.sonifyIndex(reading.index);
        this.lastTickAt = now;
        this.lastIndex = reading.index;
        this.currentIndex = reading.index;
        this.checkArrival(reading.index);
      }
      this.lastState = reading.state;
      return reading;
    }

    // Off the curve: repeat the direction pulse, faster as they close in.
    if (leftCurve) this.announcedArrival = false;
    if (reading.push !== 'none') {
      const closeness = 1 - Math.min(1, Math.abs(reading.delta ?? 1));
      const interval = FAR_INTERVAL_MS - (FAR_INTERVAL_MS - NEAR_INTERVAL_MS) * closeness;
      if (now - this.lastPulseAt >= interval) {
        this.fire(reading.push === 'up' ? 'rising' : 'falling', reading, now);
      }
    }
    this.lastState = reading.state;
    return reading;
  }

  private checkArrival(index: number): void {
    if (this.targetIndex === null || this.announcedArrival) return;
    if (index !== this.targetIndex) return;
    this.announcedArrival = true;
    this.deps.onArrive(index);
  }

  private sonifyIndex(index: number): void {
    const graph = this.deps.getGraph();
    if (!graph) return;
    this.deps.sonifier.sonifyPoint(graph, this.deps.getSeriesIndex(), index);
  }

  private fire(pattern: HapticPatternName, reading: GuidanceReading, now: number): void {
    this.lastPulseAt = now;
    this.deps.haptics.play(pattern);
    this.deps.emit({
      type: 'guidance:change',
      state: reading.state,
      index: reading.index,
      push: reading.push,
      delta: reading.delta,
    });
  }
}
