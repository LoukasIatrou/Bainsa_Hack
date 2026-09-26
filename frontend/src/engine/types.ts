// Engine surface types, mirroring audio-haptics/src/types.ts (Person 3) so the local stand-in and
// Person 3's AudioHapticEngine are interchangeable at engine/index.ts. Keep names identical.

export type SpeechPriority = 'interrupt' | 'normal' | 'background'

export type GraphKind = 'continuous' | 'discrete'

export type HapticPatternName = 'short' | 'double' | 'long' | 'rising' | 'falling'

export type HapticRamp = 'none' | 'up' | 'down'

export interface HapticPatternSpec {
  name: HapticPatternName
  // navigator.vibrate() format: even indices vibrate (ms), odd indices are gaps.
  timings: number[]
  ramp: HapticRamp
  meaning: string
}

export type GuidanceState = 'idle' | 'off-curve' | 'on-curve' | 'off-chart'

export interface GuidanceReading {
  state: GuidanceState
  // Nearest x index to the finger.
  index: number
  // The curve's normalised height at the finger's x, or null where unreadable.
  curveY: number | null
  // curveY - fingerY. Positive means the curve is above the finger.
  delta: number | null
  push: 'up' | 'down' | 'none'
}

export interface EngineStatus {
  speaking: boolean
  hasGraph: boolean
  hasReasoning: boolean
  graphKind: GraphKind
  explaining: boolean
  // 1-based, for display.
  explainStep: number | null
  guiding: boolean
  targetIndex: number | null
}

export type EngineEvent =
  | { type: 'speech:start'; text: string; priority: SpeechPriority }
  | { type: 'speech:end'; text: string }
  | { type: 'speech:idle' }
  | { type: 'speech:caption'; text: string; priority: SpeechPriority }
  | {
      type: 'haptic:pattern'
      pattern: HapticPatternName
      timings: number[]
      ramp: HapticRamp
      meaning: string
      transports: string[]
    }
  | {
      type: 'guidance:change'
      state: GuidanceState
      index: number
      push: 'up' | 'down' | 'none'
      delta: number | null
    }
  | { type: 'status:change'; status: EngineStatus }

export type EngineListener = (event: EngineEvent) => void
