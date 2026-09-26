/**
 * The five vibration patterns from the team brief, and the transports that play
 * them.
 *
 * One timing definition drives every channel, so the phone's motor, Person 4's
 * visual simulator and the laptop audio fallback can never disagree about what
 * a pattern is. The brief names the five patterns but assigns no meaning or
 * timing -- the mapping below is the agreed one, documented for the whole team
 * in `contracts/haptic-patterns.md`.
 *
 * Timings use the navigator.vibrate() convention: even indices are vibration
 * durations in ms, odd indices are the silent gaps between them.
 */

import type {
  EngineEvent,
  HapticPatternName,
  HapticPatternSpec,
  HapticRamp,
  HapticTransport,
} from './types.js';
import type { Sonifier } from './sonification.js';

export const HAPTIC_PATTERNS: Record<HapticPatternName, HapticPatternSpec> = {
  short: {
    name: 'short',
    timings: [60],
    ramp: 'none',
    meaning: 'Focus moved to a point; its value was read.',
  },
  double: {
    name: 'double',
    timings: [50, 60, 50],
    ramp: 'none',
    meaning: 'Local extremum reached -- a peak or a trough.',
  },
  long: {
    name: 'long',
    timings: [300],
    ramp: 'none',
    meaning: 'Boundary: start or end of the series, cannot move further.',
  },
  rising: {
    name: 'rising',
    timings: [40, 40, 60, 40, 90],
    ramp: 'up',
    meaning: 'Value increased from the previous point.',
  },
  falling: {
    name: 'falling',
    timings: [90, 40, 60, 40, 40],
    ramp: 'down',
    meaning: 'Value decreased from the previous point.',
  },
};

/** Total wall-clock length of a pattern, for the simulator's animation. */
export function patternDuration(spec: HapticPatternSpec): number {
  return spec.timings.reduce((total, ms) => total + ms, 0);
}

/**
 * The phone's own vibration motor. Primary channel for the demo (Android).
 *
 * Two caveats that make a second channel mandatory: it requires prior user
 * activation on the page, and it is a silent no-op on a laptop -- and absent
 * entirely on iOS, where `navigator.vibrate` is not implemented at all.
 */
export class VibrationTransport implements HapticTransport {
  readonly id = 'vibration';

  /**
   * What the last `navigator.vibrate()` call returned, or null if never called.
   *
   * The API returns a boolean and most code throws it away. `false` means the
   * request was rejected outright -- no user activation yet, or the pattern was
   * invalid. `true` only means Chrome accepted it, NOT that the motor moved:
   * silent mode, Do Not Disturb, battery saver and a disabled system haptics
   * setting all swallow an accepted request. Desktop returns true and does
   * nothing at all.
   */
  lastResult: boolean | null = null;

  get available(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  play(spec: HapticPatternSpec): void {
    if (!this.available) return;
    try {
      this.lastResult = navigator.vibrate(spec.timings);
    } catch {
      // Blocked without user activation; the other transports still fire.
      this.lastResult = false;
    }
  }

  stop(): void {
    if (!this.available) return;
    try {
      navigator.vibrate(0);
    } catch {
      // Nothing to cancel.
    }
  }
}

/**
 * Emits the pattern for Person 4's visual simulator. Always available -- this
 * is the channel that guarantees the concept stays demonstrable when hardware
 * does not cooperate.
 */
export class SimulatorTransport implements HapticTransport {
  readonly id = 'simulator';
  readonly available = true;

  play(_spec: HapticPatternSpec): void {
    // Intentionally empty. `Haptics.play` emits the single combined
    // haptic:pattern event once it knows which transports actually fired, so
    // the simulator is driven from there rather than from here.
  }

  stop(): void {
    // Nothing to stop: the simulator animation is owned by Person 4.
  }
}

/**
 * Renders the pattern as a low-frequency buzz through Web Audio. Not a
 * substitute for touch, but it makes the haptic channel perceivable while
 * developing on a laptop, where the vibration motor does not exist.
 */
export class AudioTactileTransport implements HapticTransport {
  readonly id = 'audio-tactile';

  constructor(private readonly sonifier: Sonifier) {}

  get available(): boolean {
    return this.sonifier.supported;
  }

  play(spec: HapticPatternSpec): void {
    if (!this.available) return;
    this.sonifier.buzz(spec.timings, spec.ramp);
  }

  stop(): void {
    // Buzz pulses are short and self-terminating.
  }
}

export class Haptics {
  private readonly transports: HapticTransport[];
  private readonly enabled = new Map<string, boolean>();

  constructor(
    private readonly emit: (event: EngineEvent) => void,
    transports: HapticTransport[],
  ) {
    this.transports = transports;
    for (const t of transports) this.enabled.set(t.id, true);
  }

  /**
   * Ids of transports that are both present on this device and switched on.
   * Person 4 uses this to label the demo honestly -- the brief requires being
   * explicit when the simulator is running without real hardware.
   */
  getActiveTransports(): string[] {
    return this.transports
      .filter((t) => t.available && this.enabled.get(t.id) !== false)
      .map((t) => t.id);
  }

  /**
   * True when the Vibration API is present and enabled.
   *
   * Careful: this is *not* proof that a motor exists. Desktop Chrome exposes
   * `navigator.vibrate` and silently does nothing, and the API gives no way to
   * tell the two apart. Person 4 should label the demo as "vibration requested"
   * rather than "ring active" unless a human has confirmed it on the phone --
   * the brief forbids presenting simulated hardware as live.
   */
  get vibrationRequested(): boolean {
    return this.getActiveTransports().includes('vibration');
  }

  /** What the last navigator.vibrate() call returned. See VibrationTransport. */
  get lastVibrateResult(): boolean | null {
    const t = this.transports.find((x) => x.id === 'vibration');
    return t instanceof VibrationTransport ? t.lastResult : null;
  }

  setEnabled(id: string, enabled: boolean): void {
    this.enabled.set(id, enabled);
  }

  play(name: HapticPatternName): void {
    const spec = HAPTIC_PATTERNS[name];
    const fired: string[] = [];

    for (const transport of this.transports) {
      if (!transport.available || this.enabled.get(transport.id) === false) continue;
      transport.play(spec);
      fired.push(transport.id);
    }

    this.emit({
      type: 'haptic:pattern',
      pattern: spec.name,
      timings: spec.timings,
      ramp: spec.ramp,
      meaning: spec.meaning,
      transports: fired,
    });
  }

  stop(): void {
    for (const transport of this.transports) transport.stop();
  }
}

export function ramp(name: HapticPatternName): HapticRamp {
  return HAPTIC_PATTERNS[name].ramp;
}
