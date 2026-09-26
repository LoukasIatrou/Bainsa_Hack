/**
 * Adapter between this engine and Person 4's RingSimulator.
 *
 * `docs/phone-demo-navigation.md` 4 gives the ring two independent layers, both
 * keyed off the slider index:
 *
 *   position dot  angle = index / (length - 1) * 360, every index change
 *   pulse flash   mirrors whichever of the five named patterns just fired
 *
 * The component as written types its pulse layer as
 * `'rising' | 'falling' | 'flat' | 'unknown'`, which cannot express two of the
 * five: `double` (a peak or trough) and `long` (a boundary or unreadable
 * point). Those are exactly the moments worth feeling, so this module supplies
 * both halves of the bridge:
 *
 *   - `RING_PATTERN_LABELS` and `RingState`, for widening the prop to all five.
 *   - `toLegacyDirection`, which degrades the five onto the existing four, so
 *     nothing has to change before it works at all.
 *
 * Person 4 owns how the ring looks. This only decides what it is told.
 */

import type {
  EngineEvent,
  HapticPatternName,
  HapticRamp,
} from './types.js';

/** Text for the ring's aria-live tag. Covers all five patterns. */
export const RING_PATTERN_LABELS: Record<HapticPatternName, string> = {
  short: 'steady pulse',
  double: 'peak pulse',
  long: 'edge pulse',
  rising: 'rising pulse',
  falling: 'falling pulse',
};

/**
 * Degrade the five patterns onto the four the current component accepts, so it
 * renders something sensible before the prop is widened.
 *
 * `double` and `long` both collapse to 'unknown', which is lossy on purpose:
 * showing a peak as a plain rise would be worse than showing it as distinct.
 */
export function toLegacyDirection(
  pattern: HapticPatternName,
): 'rising' | 'falling' | 'flat' | 'unknown' {
  switch (pattern) {
    case 'rising': return 'rising';
    case 'falling': return 'falling';
    case 'short': return 'flat';
    case 'double':
    case 'long':
    default: return 'unknown';
  }
}

export interface RingState {
  /** Current data point index, the one value every layer keys off. */
  index: number;
  /** Number of points, for the dot's angle. */
  length: number;
  /** Degrees around the ring: index / (length - 1) * 360, per doc 4. */
  angle: number;
  pattern: HapticPatternName;
  /** Back-compat value for the component's current prop type. */
  direction: 'rising' | 'falling' | 'flat' | 'unknown';
  label: string;
  /** navigator.vibrate() timings, if the flash should match the real rhythm. */
  timings: number[];
  ramp: HapticRamp;
  /**
   * Whether navigator.vibrate() was called. NOT proof the user felt anything:
   * desktop Chrome exposes the API and silently does nothing, with no way to
   * detect the difference. False means the ring is the only pulse feedback
   * that exists.
   */
  vibrated: boolean;
  /** Ready-to-render sentence for the aria-live tag, honest about simulation. */
  status: string;
}

export function ringAngle(index: number, length: number): number {
  return length > 1 ? (index / (length - 1)) * 360 : 0;
}

interface EngineLike {
  on(listener: (event: EngineEvent) => void): () => void;
  getGraph(): { xAxis: { values: string[] } } | null;
}

/**
 * Subscribe to the engine and receive a complete RingState on every change.
 *
 * Both layers update from one callback, so the dot and the flash can never
 * disagree about which point they are showing.
 *
 *   useEffect(() => createRingBinding(engine, setRing), [engine]);
 *
 * Returns an unsubscribe function.
 */
export function createRingBinding(
  engine: EngineLike,
  onChange: (state: RingState) => void,
): () => void {
  let index = 0;
  let pattern: HapticPatternName = 'short';
  let timings: number[] = [];
  let ramp: HapticRamp = 'none';
  let vibrated = false;
  let scheduled = false;

  /**
   * A single index change produces both a focus:change and a haptic:pattern.
   * Coalescing them into one callback per microtask means the dot and the
   * flash are always describing the same point -- doc 4 keys both layers off
   * one index, and emitting twice would briefly show the new pattern at the
   * previous angle.
   */
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      emit();
    });
  };

  const emit = () => {
    const length = engine.getGraph()?.xAxis.values.length ?? 0;
    onChange({
      index,
      length,
      angle: ringAngle(index, length),
      pattern,
      direction: toLegacyDirection(pattern),
      label: RING_PATTERN_LABELS[pattern],
      timings,
      ramp,
      vibrated,
      // "requested", not "felt": the Vibration API exists on desktop and does
      // nothing, and offers no way to tell a real motor from a no-op. doc 4
      // forbids the ring implying hardware it cannot confirm.
      status: vibrated
        ? `${RING_PATTERN_LABELS[pattern]}, vibration requested`
        : `${RING_PATTERN_LABELS[pattern]}, simulated only`,
    });
  };

  return engine.on((event) => {
    if (event.type === 'haptic:pattern') {
      pattern = event.pattern;
      timings = event.timings;
      ramp = event.ramp;
      // 'vibration' present means the motor was asked. On a laptop the API
      // exists and does nothing, so this is "requested", not "felt" -- the
      // label says "vibrating" only where the transport is actually live.
      vibrated = event.transports.includes('vibration');
      schedule();
      return;
    }
    if (event.type === 'focus:change') {
      index = event.index;
      schedule();
    }
  });
}
