// THE single switch point for speech, sonification and haptics: Person 3's AudioHapticEngine
// (audio-haptics/, imported from source). Everything that speaks or vibrates imports `engine`
// from here. Phone vibration stays OFF (his default): the audio-tactile buzz and the on-screen
// ring carry the haptic patterns; opt in with `new AudioHapticEngine({ vibration: true })`.
import { AudioHapticEngine } from '../../../audio-haptics/src/index'

export const engine = new AudioHapticEngine()

// Dev server only (stripped from production builds): lets headless checks read engine events
// (haptic patterns, guidance) from the page.
if (import.meta.env.DEV) Object.assign(window, { __engine: engine })

export * from '../../../audio-haptics/src/index'
