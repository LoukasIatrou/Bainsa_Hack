// THE single switch point for speech, sonification and haptics: Person 3's AudioHapticEngine
// (audio-haptics/, imported from source). Everything that speaks or vibrates imports `engine`
// from here. Phone vibration stays OFF (his default): the audio-tactile buzz and the on-screen
// ring carry the haptic patterns; opt in with `new AudioHapticEngine({ vibration: true })`.
import { AudioHapticEngine } from '../../../audio-haptics/src/index'

export const engine = new AudioHapticEngine()

export * from '../../../audio-haptics/src/index'
