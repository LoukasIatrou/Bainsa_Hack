/**
 * A priority queue over window.speechSynthesis.
 *
 * Four platform behaviours shape this file, all of them things that break a
 * naive `speechSynthesis.speak(new SpeechSynthesisUtterance(text))`:
 *
 *  1. Chrome truncates utterances past roughly 15 seconds, so long text is
 *     chunked at sentence boundaries and the chunk index is tracked so
 *     pause/resume/replay stay accurate.
 *  2. Voices load asynchronously. We never *wait* for them -- on Android the
 *     first utterance has to be spoken inside the user gesture, so we speak
 *     with the default voice and upgrade later via `voiceschanged`.
 *  3. `cancel()` immediately followed by `speak()` is unreliable in Chrome, so
 *     restarts are deferred by a tick.
 *  4. `pause()` silently does nothing on some platforms, so we verify it took
 *     effect and fall back to cancel-and-resume-from-chunk.
 */

import type { EngineEvent, SpeechPriority } from './types.js';

const MAX_CHUNK_CHARS = 180;
const RESTART_DELAY_MS = 60;
const PAUSE_VERIFY_MS = 120;

interface QueueItem {
  text: string;
  priority: SpeechPriority;
}

/**
 * Split into chunks short enough that Chrome will not truncate them, preferring
 * sentence boundaries and falling back to word boundaries for a single
 * overlong sentence.
 */
export function chunkText(text: string, maxLen = MAX_CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') return [];
  if (clean.length <= maxLen) return [clean];

  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current !== '') {
      chunks.push(current);
      current = '';
    }
  };

  for (const sentence of sentences) {
    if (sentence.length > maxLen) {
      flush();
      let line = '';
      for (const word of sentence.split(' ')) {
        if (line === '') {
          line = word;
        } else if (`${line} ${word}`.length <= maxLen) {
          line = `${line} ${word}`;
        } else {
          chunks.push(line);
          line = word;
        }
      }
      if (line !== '') chunks.push(line);
      continue;
    }

    if (current === '') {
      current = sentence;
    } else if (`${current} ${sentence}`.length <= maxLen) {
      current = `${current} ${sentence}`;
    } else {
      flush();
      current = sentence;
    }
  }

  flush();
  return chunks;
}

export class SpeechQueue {
  private readonly synth: SpeechSynthesis | null;
  private readonly emit: (event: EngineEvent) => void;

  private queue: QueueItem[] = [];
  private current: QueueItem | null = null;
  private chunks: string[] = [];
  private chunkIndex = 0;
  private lastSpoken: QueueItem | null = null;

  private voice: SpeechSynthesisVoice | null = null;
  private rate = 1;
  private paused = false;
  /** Set while we are tearing down an utterance on purpose, so onend is ignored. */
  private discarding = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(emit: (event: EngineEvent) => void) {
    this.emit = emit;
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis
      : null;

    if (this.synth) {
      this.pickVoice();
      // Voices arrive asynchronously in Chrome; upgrade once they do.
      this.synth.addEventListener?.('voiceschanged', () => this.pickVoice());
    }
  }

  get supported(): boolean {
    return this.synth !== null;
  }

  /**
   * How many voices the platform actually offers.
   *
   * `'speechSynthesis' in window` is not enough: Electron shells and some Linux
   * Chromium builds expose the API with **zero voices**, so speak() resolves
   * happily and emits no sound. A demo that fails this silently is the worst
   * possible failure, so report it.
   */
  get voiceCount(): number {
    return this.synth?.getVoices().length ?? 0;
  }

  /** Supported *and* actually able to make a sound. */
  get usable(): boolean {
    return this.synth !== null && this.voiceCount > 0;
  }

  get speaking(): boolean {
    return this.current !== null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get currentRate(): number {
    return this.rate;
  }

  /** 0.5-2.0. Screen-reader users routinely want faster speech than the default. */
  setRate(rate: number): void {
    this.rate = Math.min(2, Math.max(0.5, rate));
    // Rate only applies to new utterances, so re-speak the remainder of the
    // current one to make the change audible immediately.
    if (this.current && !this.paused) this.restartFromCurrentChunk();
  }

  private pickVoice(): void {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    if (voices.length === 0) return;
    this.voice = voices.find((v) => v.lang.startsWith('en') && v.localService)
      ?? voices.find((v) => v.lang.startsWith('en'))
      ?? voices[0]
      ?? null;
  }

  /**
   * Queue text for speaking.
   * - `interrupt` replaces anything pending and cancels current playback.
   * - `normal` queues behind whatever is already waiting.
   * - `background` is dropped when anything else is pending.
   */
  speak(text: string, priority: SpeechPriority = 'normal'): void {
    const trimmed = text.trim();
    if (trimmed === '') return;

    // Captions fire even when speech is unsupported, so Person 4's live region
    // and transcript stay correct on a device with no TTS at all.
    this.emit({ type: 'speech:caption', text: trimmed, priority });
    if (!this.synth) return;

    const item: QueueItem = { text: trimmed, priority };

    if (priority === 'interrupt') {
      // Coalesce: replace-latest rather than enqueue, so holding an arrow key
      // does not build a backlog of stale point readouts.
      this.queue = this.queue.filter((q) => q.priority === 'normal');
      this.queue.unshift(item);
      this.hardStop();
      this.scheduleStart();
      return;
    }

    if (priority === 'background' && (this.current !== null || this.queue.length > 0)) {
      return;
    }

    this.queue.push(item);
    if (this.current === null && !this.paused) this.startNext();
  }

  /** Re-speak the last utterance from the beginning. */
  replay(): void {
    const item = this.lastSpoken ?? this.current;
    if (!item) return;
    this.queue = [];
    this.hardStop();
    this.queue.unshift(item);
    this.scheduleStart();
  }

  pause(): void {
    if (!this.synth || this.current === null || this.paused) return;
    this.paused = true;
    this.synth.pause();

    // pause() is a silent no-op on some platforms. If it did not take, tear the
    // utterance down and remember the chunk so resume() can rebuild from it.
    setTimeout(() => {
      if (this.paused && this.synth && !this.synth.paused) {
        this.discarding = true;
        this.synth.cancel();
        this.discarding = false;
      }
    }, PAUSE_VERIFY_MS);
  }

  resume(): void {
    if (!this.synth || !this.paused) return;
    this.paused = false;

    if (this.synth.paused) {
      this.synth.resume();
      return;
    }
    // pause() had been faked with a cancel -- rebuild from the current chunk.
    if (this.current) {
      this.restartFromCurrentChunk();
    } else {
      this.startNext();
    }
  }

  /** Stop everything and clear the queue. Used by the engine's reset path. */
  stop(): void {
    this.queue = [];
    this.paused = false;
    this.hardStop();
  }

  private hardStop(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.current !== null) {
      this.emit({ type: 'speech:end', text: this.current.text });
    }
    this.current = null;
    this.chunks = [];
    this.chunkIndex = 0;
    if (this.synth) {
      this.discarding = true;
      this.synth.cancel();
      this.discarding = false;
    }
  }

  /** cancel() then speak() in the same tick is unreliable in Chrome. */
  private scheduleStart(): void {
    if (this.restartTimer !== null) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startNext();
    }, RESTART_DELAY_MS);
  }

  private startNext(): void {
    if (this.paused) return;
    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      return;
    }

    this.current = next;
    this.lastSpoken = next;
    this.chunks = chunkText(next.text);
    this.chunkIndex = 0;

    if (this.chunks.length === 0) {
      this.current = null;
      this.startNext();
      return;
    }

    this.emit({ type: 'speech:start', text: next.text, priority: next.priority });
    this.speakCurrentChunk();
  }

  private restartFromCurrentChunk(): void {
    if (!this.synth || !this.current) return;
    this.discarding = true;
    this.synth.cancel();
    this.discarding = false;
    if (this.restartTimer !== null) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.paused && this.current) this.speakCurrentChunk();
    }, RESTART_DELAY_MS);
  }

  private speakCurrentChunk(): void {
    if (!this.synth || !this.current) return;
    const chunk = this.chunks[this.chunkIndex];
    if (chunk === undefined) {
      this.finishCurrent();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = this.rate;
    if (this.voice) utterance.voice = this.voice;

    utterance.onend = () => {
      if (this.discarding || this.paused) return;
      this.chunkIndex += 1;
      if (this.chunkIndex < this.chunks.length) {
        this.speakCurrentChunk();
      } else {
        this.finishCurrent();
      }
    };

    utterance.onerror = (event) => {
      // 'interrupted' and 'canceled' are our own doing; anything else should
      // not strand the queue, so move on either way.
      if (this.discarding) return;
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        this.finishCurrent();
      }
    };

    this.synth.speak(utterance);
  }

  private finishCurrent(): void {
    const finished = this.current;
    this.current = null;
    this.chunks = [];
    this.chunkIndex = 0;
    if (finished) this.emit({ type: 'speech:end', text: finished.text });
    this.startNext();
  }
}
