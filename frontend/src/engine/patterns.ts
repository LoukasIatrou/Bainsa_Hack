import type { HapticPatternName, HapticPatternSpec } from './types'

// Copied verbatim from Person 3's HAPTIC_PATTERNS (audio-haptics/src/haptics.ts), the code form of
// contracts/haptic-patterns.md. Do not invent new vibrations: every buzz in the app is one of
// these five. In guidance, `double` is reserved for "arrived on the target point".
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
}

// Plays a pattern on the phone motor. Returns the transports that fired (for honest labelling:
// desktop Chrome accepts vibrate() and does nothing).
export function vibratePattern(name: HapticPatternName): string[] {
  const fired = ['simulator']
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(HAPTIC_PATTERNS[name].timings)
      fired.unshift('vibration')
    } catch {
      // Blocked before user activation; the simulator still shows it.
    }
  }
  return fired
}
