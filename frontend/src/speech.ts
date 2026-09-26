// Shared voice announcer. Cancels any in-flight utterance before speaking so a fast sequence
// of state changes (e.g. capture -> processing -> result) doesn't queue a backlog of stale
// utterances that keep talking after the user has moved on.
// `onEnd` fires only if the utterance finishes (not when it's cut off by the next one).
export function announce(text: string, onEnd?: () => void): void {
  const synth = window.speechSynthesis
  if (!synth) return
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  if (onEnd) utterance.onend = onEnd
  synth.speak(utterance)
}

export function stopSpeech(): void {
  window.speechSynthesis?.cancel()
}

// Mobile browsers only allow speech that starts from a user gesture until something has been
// spoken once. Call from inside a click/tap handler; later async announcements then work.
let unlocked = false
export function unlockSpeech(): void {
  if (unlocked || !window.speechSynthesis) return
  unlocked = true
  const utterance = new SpeechSynthesisUtterance('Ready.')
  utterance.volume = 0
  window.speechSynthesis.speak(utterance)
}
