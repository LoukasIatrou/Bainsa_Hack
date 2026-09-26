// THE single switch point between the local stand-in and Person 3's engine. Everything that
// speaks or vibrates imports `engine` from here, never from localEngine directly.
//
// TODO(Haris): swap to Person 3's engine after his final push:
//   import { AudioHapticEngine } from '../../../audio-haptics/src/index'
//   export const engine = new AudioHapticEngine()
// (and delete the LocalAudioHapticEngine lines below). Person 3's package must compile under
// frontend/tsconfig.app.json first; see the SPEC notes at the top of localEngine.ts for the
// behaviours his engine still needs.
import { LocalAudioHapticEngine } from './localEngine'

export const engine = new LocalAudioHapticEngine()

export type Engine = typeof engine
export { HAPTIC_PATTERNS } from './patterns'
export type { EngineEvent, EngineStatus, GraphKind, GuidanceReading, HapticPatternName } from './types'
