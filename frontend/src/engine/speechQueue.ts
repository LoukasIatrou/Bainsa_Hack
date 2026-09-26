// Speech queue over window.speechSynthesis, following Person 3's SpeechQueue (audio-haptics/src/
// speech.ts): interrupt / normal / background priorities, sentence chunking against Chrome's
// ~15 s cut-off, deferred restart after cancel(), and a `speech:idle` event when the queue drains
// (the Explain walk advances on that, never on a timer guess).
//
// Additions so the walk can never stall: with no TTS at all (or zero voices) an item "plays" for
// an estimated duration and still ends; a watchdog finishes an utterance whose onend never fires.
import type { EngineEvent, SpeechPriority } from './types'

const MAX_CHUNK_CHARS = 180
const RESTART_DELAY_MS = 60
const MS_PER_CHAR = 65

interface QueueItem {
  text: string
  priority: SpeechPriority
}

export function chunkText(text: string, maxLen = MAX_CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean === '') return []
  if (clean.length <= maxLen) return [clean]
  const chunks: string[] = []
  let current = ''
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if (current !== '' && `${current} ${sentence}`.length > maxLen) {
      chunks.push(current)
      current = sentence
    } else {
      current = current === '' ? sentence : `${current} ${sentence}`
    }
  }
  if (current !== '') chunks.push(current)
  return chunks
}

function estimateMs(text: string): number {
  return Math.max(700, text.length * MS_PER_CHAR)
}

export class SpeechQueue {
  private readonly synth: SpeechSynthesis | null
  private readonly emit: (event: EngineEvent) => void
  private queue: QueueItem[] = []
  private current: QueueItem | null = null
  private chunks: string[] = []
  private chunkIndex = 0
  private voice: SpeechSynthesisVoice | null = null
  // Bumped on every hard stop so callbacks from a torn-down utterance are ignored.
  private generation = 0
  private restartTimer: number | null = null
  private watchdog: number | null = null

  constructor(emit: (event: EngineEvent) => void) {
    this.emit = emit
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
    if (this.synth) {
      this.pickVoice()
      this.synth.addEventListener?.('voiceschanged', () => this.pickVoice())
    }
  }

  get speaking(): boolean {
    return this.current !== null
  }

  private pickVoice(): void {
    const voices = this.synth?.getVoices() ?? []
    const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
    const pool = english.length > 0 ? english : voices
    this.voice =
      pool.find((v) => v.name.toLowerCase().includes('google') && v.lang.toLowerCase() === 'en-us') ??
      pool.find((v) => v.lang.toLowerCase() === 'en-us') ??
      pool[0] ??
      null
  }

  speak(text: string, priority: SpeechPriority = 'normal'): void {
    const trimmed = text.trim()
    if (trimmed === '') return
    // Captions fire even without TTS, so the on-screen line stays truthful.
    this.emit({ type: 'speech:caption', text: trimmed, priority })
    const item: QueueItem = { text: trimmed, priority }

    if (priority === 'interrupt') {
      this.queue = this.queue.filter((q) => q.priority === 'normal')
      this.queue.unshift(item)
      this.hardStop()
      this.scheduleStart()
      return
    }
    if (priority === 'background' && (this.current !== null || this.queue.length > 0)) return
    this.queue.push(item)
    if (this.current === null && this.restartTimer === null) this.startNext()
  }

  // Stop everything and clear the queue. Emits no idle: a stop is not "finished speaking".
  stop(): void {
    this.queue = []
    this.hardStop()
  }

  private hardStop(): void {
    this.generation += 1
    if (this.restartTimer !== null) window.clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.clearWatchdog()
    if (this.current !== null) this.emit({ type: 'speech:end', text: this.current.text })
    this.current = null
    this.chunks = []
    this.chunkIndex = 0
    this.synth?.cancel()
  }

  private scheduleStart(): void {
    if (this.restartTimer !== null) window.clearTimeout(this.restartTimer)
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null
      this.startNext()
    }, RESTART_DELAY_MS)
  }

  private startNext(): void {
    const next = this.queue.shift()
    if (!next) {
      const was = this.current !== null
      this.current = null
      if (was) this.emit({ type: 'speech:idle' })
      return
    }
    this.current = next
    this.chunks = chunkText(next.text)
    this.chunkIndex = 0
    this.emit({ type: 'speech:start', text: next.text, priority: next.priority })
    this.speakCurrentChunk()
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) window.clearTimeout(this.watchdog)
    this.watchdog = null
  }

  private speakCurrentChunk(): void {
    const chunk = this.chunks[this.chunkIndex]
    if (!this.current || chunk === undefined) {
      this.finishCurrent()
      return
    }
    const gen = this.generation
    const done = () => {
      if (gen !== this.generation) return
      this.clearWatchdog()
      this.chunkIndex += 1
      if (this.chunkIndex < this.chunks.length) this.speakCurrentChunk()
      else this.finishCurrent()
    }

    // No TTS: pretend-speak for about as long as it would take, so sequencing still works.
    // With TTS: watchdog in case onend never arrives (Chrome drops it occasionally, and a
    // voiceless Linux build never fires it).
    this.clearWatchdog()
    this.watchdog = window.setTimeout(done, !this.synth ? estimateMs(chunk) : estimateMs(chunk) * 2 + 3000)
    if (!this.synth) return

    const utterance = new SpeechSynthesisUtterance(chunk)
    if (this.voice) utterance.voice = this.voice
    utterance.onend = done
    utterance.onerror = (event) => {
      if (event.error === 'interrupted' || event.error === 'canceled') return
      done()
    }
    this.synth.speak(utterance)
  }

  private finishCurrent(): void {
    const finished = this.current
    this.current = null
    this.chunks = []
    this.chunkIndex = 0
    this.clearWatchdog()
    if (finished) this.emit({ type: 'speech:end', text: finished.text })
    if (this.queue.length === 0) {
      this.emit({ type: 'speech:idle' })
      return
    }
    this.startNext()
  }

  // Must run inside a user gesture on mobile, or later speech stays blocked.
  unlock(): void {
    if (!this.synth) return
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    this.synth.speak(u)
  }
}
