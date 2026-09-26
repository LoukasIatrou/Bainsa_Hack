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

/**
 * Rank a voice by likely listening quality.
 *
 * Voice lists differ wildly by platform. Android Chrome offers a handful of
 * genuinely good neural voices; desktop Linux offers ~945 espeak-ng variants of
 * the same robotic synth, including "English (Caribbean)+Demonic". Picking the
 * first match, or even the one flagged `default`, lands somewhere arbitrary in
 * that list, so rank explicitly instead.
 *
 * Higher is better.
 */
export function voiceQuality(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  // Named engines, best first. Google's Android voices are the ones the demo
  // will actually be heard through.
  if (name.includes('google')) score += 100;
  else if (name.includes('microsoft') || name.includes('natural')) score += 80;
  else if (name.includes('samsung')) score += 60;
  else if (name.includes('mbrola')) score += 40;   // diphone, clearly better than raw espeak
  else if (name.includes('espeak')) score += 0;

  // Network voices are usually the higher-quality ones where both exist.
  if (!voice.localService) score += 15;

  // espeak variants ("English+Adam", "+Demonic") are novelty timbres layered on
  // the same synth; the plain entry is the intelligible one.
  if (name.includes('+')) score -= 50;

  // Prefer mainstream accents over regional espeak variants (en-029 Caribbean,
  // en-gb-scotland and friends) unless nothing else exists.
  if (lang === 'en-us') score += 30;
  else if (lang === 'en-gb') score += 25;
  else if (lang === 'en') score += 20;
  else if (lang.startsWith('en')) score += 5;

  if (voice.default) score += 10;
  return score;
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
  /**
   * Cached voice list. espeak-ng via speech-dispatcher exposes ~15,000 voices
   * (every language crossed with every variant), so calling getVoices() on
   * every status broadcast allocates a huge array many times a second.
   */
  private voices: SpeechSynthesisVoice[] = [];
  private rate = 1;
  private pitch = 1;
  private volume = 1;
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
    return this.voices.length;
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

  get currentPitch(): number {
    return this.pitch;
  }

  get currentVolume(): number {
    return this.volume;
  }

  /**
   * 0-1, default 1 (maximum).
   *
   * This is the API's own scale, not the device's -- it cannot exceed the
   * phone's media volume, so "louder" ultimately means turning the phone up.
   * Exposed so a quieter setting is possible, not because 1 can be beaten.
   */
  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
  }

  /**
   * 0-2, default 1. Lowering it slightly takes some of the edge off espeak's
   * harshness; it does nothing much to a good neural voice.
   */
  setPitch(pitch: number): void {
    this.pitch = Math.min(2, Math.max(0, pitch));
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
    this.voices = voices;

    const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const pool = english.length > 0 ? english : voices;
    if (pool.length === 0) return;

    let best = pool[0]!;
    let bestScore = -Infinity;
    for (const v of pool) {
      const score = voiceQuality(v);
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    this.voice = best;
  }

  /** Which voice was chosen, for the diagnostic. */
  get voiceName(): string | null {
    return this.voice?.name ?? null;
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
      const wasSpeaking = this.current !== null;
      this.current = null;
      // Drained. Callers that sequence on speech completion (the Explain
      // walkthrough) key off this rather than guessing at durations.
      if (wasSpeaking) this.emit({ type: 'speech:idle' });
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
    utterance.pitch = this.pitch;
    utterance.volume = this.volume;
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
    if (this.queue.length === 0) {
      this.emit({ type: 'speech:idle' });
      return;
    }
    this.startNext();
  }
}
