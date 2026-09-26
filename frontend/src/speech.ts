// Shared voice announcer. Cancels any in-flight utterance before speaking so a fast sequence
// of state changes (e.g. capture -> processing -> result) doesn't queue a backlog of stale
// utterances that keep talking after the user has moved on.
export function announce(text: string): void {
  window.speechSynthesis?.cancel()
  window.speechSynthesis?.speak(new SpeechSynthesisUtterance(text))
}
