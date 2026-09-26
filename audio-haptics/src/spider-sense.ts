/**
 * Drives speech and haptics from Person 4's spider-sense state machine.
 *
 * `frontend/src/spiderSense/logic.ts` is deliberately pure -- "so audio/haptics
 * can drive the same state machine later without going through the visual
 * component". This is that driver. Their state is the input; this decides what
 * the user hears and feels.
 *
 * Their model is richer than a plain up/down hunt: once the finger has touched
 * the curve, `angle` points a full 360 degrees back toward `lastContact`, and
 * `distance` is meant to drive the pulse. Both are honoured here -- direction
 * picks the pattern, distance picks how fast it repeats.
 *
 * Coordinates are theirs: screen pixels, y growing downward, angles in screen
 * radians where -PI/2 is up and +PI/2 is down.
 */

import type { HapticPatternName } from './types.js';

export interface SpiderSensePoint {
  x: number;
  y: number;
}

/** Structural copy of their SpiderSenseState, so this package imports nothing from the app. */
export interface SpiderSenseStateLike {
  phase: 'searching' | 'on-curve';
  pointer: SpiderSensePoint | null;
  lastContact: SpiderSensePoint | null;
  target: SpiderSensePoint | null;
  distance: number | null;
  angle: number | null;
}

export interface SpiderSenseBindingOptions {
  /** Number of data points, for mapping screen x onto a data index. */
  pointCount: number;
  /** Their Box: the drawing area the curve was built into. */
  box: { width: number; padding?: number };
  /** Distance in pixels at which pulses are slowest. Defaults to half the width. */
  farDistance?: number;
  /** Pulse repeat interval when far from the target, and when almost on it. */
  farIntervalMs?: number;
  nearIntervalMs?: number;
  /**
   * Below this |sin(angle)| the target is treated as sideways rather than
   * up or down, and gets a neutral tick instead of a misleading rise or fall.
   */
  verticalDeadzone?: number;
}

interface EngineLike {
  playPattern(name: HapticPatternName): void;
  exploreIndex(index: number, options?: { pattern?: HapticPatternName }): void;
  haptics: { stop(): void };
}

const DEFAULTS = {
  farIntervalMs: 700,
  nearIntervalMs: 140,
  verticalDeadzone: 0.25,
};

/** Screen x -> data index, using the same box the curve was built into. */
export function indexAtX(
  x: number,
  box: { width: number; padding?: number },
  pointCount: number,
): number {
  if (pointCount <= 1) return 0;
  const padding = box.padding ?? 0;
  const innerW = box.width - padding * 2;
  if (innerW <= 0) return 0;
  const t = (x - padding) / innerW;
  return Math.min(pointCount - 1, Math.max(0, Math.round(t * (pointCount - 1))));
}

/**
 * Which pattern points the user the right way.
 *
 * Their angle is in screen radians, so a negative sine is upward. Near-horizontal
 * angles get `short` rather than an arbitrary rise or fall -- claiming "up" when
 * the target is sideways is worse than saying nothing directional.
 */
export function patternForAngle(angle: number, deadzone = DEFAULTS.verticalDeadzone): HapticPatternName {
  const vertical = Math.sin(angle);
  if (Math.abs(vertical) < deadzone) return 'short';
  return vertical < 0 ? 'rising' : 'falling';
}

/**
 * Returns a handler to pass straight to their `onStateChange` prop:
 *
 *   const onState = useMemo(
 *     () => createSpiderSenseBinding(engine, { pointCount, box }),
 *     [engine, pointCount, box],
 *   );
 *   <SpiderSense curve={curve} width={w} height={h} onStateChange={onState} />
 *
 * It throttles internally, so it is safe on every pointermove.
 */
export function createSpiderSenseBinding(
  engine: EngineLike,
  options: SpiderSenseBindingOptions,
): (state: SpiderSenseStateLike) => void {
  const farInterval = options.farIntervalMs ?? DEFAULTS.farIntervalMs;
  const nearInterval = options.nearIntervalMs ?? DEFAULTS.nearIntervalMs;
  const deadzone = options.verticalDeadzone ?? DEFAULTS.verticalDeadzone;
  const far = options.farDistance ?? options.box.width / 2;

  let lastPhase: SpiderSenseStateLike['phase'] | 'lifted' = 'lifted';
  let lastIndex = -1;
  let lastPulseAt = 0;

  return (state: SpiderSenseStateLike): void => {
    const now = Date.now();

    // Finger lifted. Their machine keeps `lastContact` so the next touch has to
    // return to it; stop pulsing but keep the remembered index.
    if (state.pointer === null) {
      if (lastPhase !== 'lifted') engine.haptics.stop();
      lastPhase = 'lifted';
      return;
    }

    if (state.phase === 'on-curve') {
      const index = indexAtX(state.pointer.x, options.box, options.pointCount);

      if (lastPhase !== 'on-curve') {
        // Arrival: one pulse, overriding the data-driven pattern so landing on
        // the curve always feels the same regardless of the local trend.
        engine.exploreIndex(index, { pattern: 'double' });
        lastIndex = index;
      } else if (index !== lastIndex) {
        // Tracing along the curve. exploreIndex speaks the point and fires the
        // data-driven pattern, so the trend is felt while following it.
        engine.exploreIndex(index);
        lastIndex = index;
      }
      lastPhase = 'on-curve';
      lastPulseAt = now;
      return;
    }

    // Searching: repeat a direction pulse, faster as the target gets closer.
    lastPhase = 'searching';
    if (state.angle === null) return;

    const distance = state.distance ?? far;
    const closeness = 1 - Math.min(1, distance / Math.max(1, far));
    const interval = farInterval - (farInterval - nearInterval) * closeness;
    if (now - lastPulseAt < interval) return;

    lastPulseAt = now;
    engine.playPattern(patternForAngle(state.angle, deadzone));
  };
}
