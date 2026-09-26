/**
 * Web Audio sonification of a line graph, plus the shared AudioContext that the
 * audio-tactile haptic fallback also borrows.
 *
 * Design notes:
 *  - Pitch is mapped *exponentially*, so equal value steps sound like equal
 *    pitch steps. A linear Hz mapping makes the top of the range sound
 *    compressed and is much harder to read by ear.
 *  - Unreadable (null) points get an audible marker, never silence. Silence is
 *    indistinguishable from a pause, which would misrepresent missing data.
 *  - The AudioContext is created lazily inside a user gesture. Without that,
 *    autoplay policy blocks everything silently -- the likeliest way this fails
 *    on stage.
 */

import type { EngineEvent, GraphData, SonifyOptions } from './types.js';
import { normalise, pointCount, valueRange } from './graph-utils.js';

const DEFAULTS = {
  minFreq: 220,
  maxFreq: 1760,
  durationMs: 2500,
  mode: 'continuous' as const,
  quantise: true,
  pan: true,
};

/** Major pentatonic semitone offsets -- no semitone clashes when series overlap. */
const PENTATONIC = [0, 2, 4, 7, 9];

const SERIES_WAVEFORMS: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth'];

export type EarconName = 'start' | 'end' | 'max' | 'min' | 'gap' | 'boundary';

export class Sonifier {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: { stop(): void }[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];

  private playing = false;
  private graph: GraphData | null = null;
  private options: Required<SonifyOptions> | null = null;
  /** ms into the sequence at which playback was paused, for resume(). */
  private pausedAt = 0;
  private startedAt = 0;

  constructor(private readonly emit: (event: EngineEvent) => void) {}

  get supported(): boolean {
    return typeof window !== 'undefined'
      && ('AudioContext' in window || 'webkitAudioContext' in window);
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Must be called from inside a user gesture (Person 4: the capture button).
   * Resolves to true when audio is actually usable.
   */
  async unlock(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    return ctx.state === 'running';
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext | undefined = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.28;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Exposed so the audio-tactile haptic transport can share one context. */
  getContext(): AudioContext | null {
    return this.ensureContext();
  }

  getMaster(): GainNode | null {
    this.ensureContext();
    return this.master;
  }

  private freqFor(value: number, min: number, max: number, opts: Required<SonifyOptions>): number {
    const norm = normalise(value, min, max);
    const raw = opts.minFreq * Math.pow(opts.maxFreq / opts.minFreq, norm);
    if (!opts.quantise) return raw;

    // Snap to the nearest pentatonic degree above minFreq.
    const semitones = 12 * Math.log2(raw / opts.minFreq);
    const octave = Math.floor(semitones / 12);
    const within = semitones - octave * 12;
    let nearest = PENTATONIC[0]!;
    for (const degree of PENTATONIC) {
      if (Math.abs(degree - within) < Math.abs(nearest - within)) nearest = degree;
    }
    return opts.minFreq * Math.pow(2, (octave * 12 + nearest) / 12);
  }

  play(graph: GraphData, options: SonifyOptions = {}): void {
    const opts: Required<SonifyOptions> = {
      ...DEFAULTS,
      seriesIndices: options.seriesIndices ?? graph.series.map((_, i) => i),
      ...options,
    } as Required<SonifyOptions>;

    this.stop();
    this.graph = graph;
    this.options = opts;
    this.pausedAt = 0;
    this.schedule(0);
  }

  /** Replay the same graph and options from the start. */
  replay(): void {
    if (this.graph && this.options) {
      const graph = this.graph;
      const options = this.options;
      this.stop();
      this.graph = graph;
      this.options = options;
      this.pausedAt = 0;
      this.schedule(0);
    }
  }

  /**
   * Web Audio has no real pause, so record how far in we got, tear the nodes
   * down, and reschedule from that offset on resume.
   */
  pause(): void {
    if (!this.playing || !this.ctx) return;
    this.pausedAt = (this.ctx.currentTime - this.startedAt) * 1000;
    this.teardown();
    this.playing = false;
  }

  resume(): void {
    if (this.playing || !this.graph || !this.options) return;
    if (this.pausedAt <= 0) {
      this.schedule(0);
    } else if (this.pausedAt >= this.options.durationMs) {
      this.pausedAt = 0;
    } else {
      this.schedule(this.pausedAt);
    }
  }

  stop(): void {
    this.teardown();
    this.playing = false;
    this.pausedAt = 0;
  }

  private teardown(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const node of this.active) {
      try {
        node.stop();
      } catch {
        // Already stopped; nothing to do.
      }
    }
    this.active = [];
  }

  private schedule(offsetMs: number): void {
    const ctx = this.ensureContext();
    const graph = this.graph;
    const opts = this.options;
    if (!ctx || !this.master || !graph || !opts) return;

    const range = valueRange(graph, opts.seriesIndices);
    if (!range) {
      // Nothing readable to play. Say so via the event stream rather than
      // emitting silence that looks like success.
      this.emit({ type: 'sonify:end' });
      return;
    }

    const total = pointCount(graph);
    if (total === 0) {
      this.emit({ type: 'sonify:end' });
      return;
    }

    const remainingMs = Math.max(0, opts.durationMs - offsetMs);
    const stepMs = opts.durationMs / total;
    const startIndex = Math.floor(offsetMs / stepMs);

    this.playing = true;
    this.startedAt = ctx.currentTime - offsetMs / 1000;
    this.emit({ type: 'sonify:start', total });

    opts.seriesIndices.forEach((seriesIndex, ordinal) => {
      const series = graph.series[seriesIndex];
      if (!series) return;
      if (opts.mode === 'continuous') {
        this.scheduleContinuous(ctx, series.values, range, opts, ordinal, startIndex, stepMs, total);
      } else {
        this.scheduleDiscrete(ctx, series.values, range, opts, ordinal, startIndex, stepMs, total);
      }
    });

    // Progress ticks and the end marker are timer-driven: Web Audio gives no
    // per-node progress callback, and these only drive UI, never audio timing.
    for (let i = startIndex; i < total; i++) {
      const at = i * stepMs - offsetMs;
      this.timers.push(
        setTimeout(() => this.emit({ type: 'sonify:progress', index: i, total }), Math.max(0, at)),
      );
    }
    this.timers.push(
      setTimeout(() => {
        this.playing = false;
        this.pausedAt = 0;
        this.emit({ type: 'sonify:end' });
      }, remainingMs + 80),
    );
  }

  private scheduleContinuous(
    ctx: AudioContext,
    values: (number | null)[],
    range: { min: number; max: number },
    opts: Required<SonifyOptions>,
    ordinal: number,
    startIndex: number,
    stepMs: number,
    total: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = SERIES_WAVEFORMS[ordinal % SERIES_WAVEFORMS.length]!;

    const panner = opts.pan ? ctx.createStereoPanner() : null;
    osc.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(this.master!);
    } else {
      gain.connect(this.master!);
    }

    const now = ctx.currentTime;
    const startAt = now + 0.02;
    gain.gain.setValueAtTime(0, now);

    let lastFreq: number | null = null;
    for (let i = startIndex; i < total; i++) {
      const at = startAt + Math.max(0, (i - startIndex) * stepMs) / 1000;
      const value = values[i] ?? null;

      if (value === null) {
        // Audible gap marker rather than silence.
        gain.gain.setTargetAtTime(0, at, 0.015);
        this.timers.push(
          setTimeout(() => this.playEarcon('gap'), Math.max(0, (i - startIndex) * stepMs)),
        );
        continue;
      }

      const freq = this.freqFor(value, range.min, range.max, opts);
      if (lastFreq === null) {
        osc.frequency.setValueAtTime(freq, at);
      } else {
        // Portamento between points is what conveys shape.
        osc.frequency.linearRampToValueAtTime(freq, at);
      }
      lastFreq = freq;
      gain.gain.setTargetAtTime(0.9, at, 0.02);

      if (panner) {
        const pan = total > 1 ? (i / (total - 1)) * 2 - 1 : 0;
        panner.pan.setValueAtTime(pan, at);
      }
    }

    const endAt = startAt + Math.max(0, total - startIndex) * stepMs / 1000;
    gain.gain.setTargetAtTime(0, endAt, 0.05);
    osc.start(now);
    osc.stop(endAt + 0.35);
    this.active.push({ stop: () => osc.stop() });
  }

  private scheduleDiscrete(
    ctx: AudioContext,
    values: (number | null)[],
    range: { min: number; max: number },
    opts: Required<SonifyOptions>,
    ordinal: number,
    startIndex: number,
    stepMs: number,
    total: number,
  ): void {
    const toneMs = Math.min(stepMs * 0.8, 260);

    for (let i = startIndex; i < total; i++) {
      const value = values[i] ?? null;
      const delay = Math.max(0, (i - startIndex) * stepMs);

      if (value === null) {
        this.timers.push(setTimeout(() => this.playEarcon('gap'), delay));
        continue;
      }

      const freq = this.freqFor(value, range.min, range.max, opts);
      const pan = opts.pan && total > 1 ? (i / (total - 1)) * 2 - 1 : 0;
      this.timers.push(
        setTimeout(() => {
          this.tone(freq, toneMs, {
            type: SERIES_WAVEFORMS[ordinal % SERIES_WAVEFORMS.length]!,
            pan,
          });
        }, delay),
      );
    }
  }

  /**
   * A single tone for the currently focused point, paired with its readout.
   *
   * `normalised` accepts Person 2's value, which is computed across every
   * series so two series stay on one comparable pitch scale. Without it the
   * value is normalised against this graph's own range.
   */
  sonifyPoint(
    graph: GraphData,
    seriesIndex: number,
    pointIndex: number,
    options: { normalised?: number | null } = {},
  ): void {
    const series = graph.series[seriesIndex];
    if (!series) return;
    const value = series.values[pointIndex] ?? null;
    if (value === null) {
      this.playEarcon('gap');
      return;
    }

    const opts = { ...DEFAULTS, seriesIndices: [seriesIndex] } as Required<SonifyOptions>;
    let freq: number;
    if (options.normalised !== null && options.normalised !== undefined) {
      // Already 0-1: map straight onto the pitch range, skipping local scaling.
      freq = this.freqFor(options.normalised, 0, 1, opts);
    } else {
      const range = valueRange(graph);
      if (!range) return;
      freq = this.freqFor(value, range.min, range.max, opts);
    }

    const total = pointCount(graph);
    const pan = total > 1 ? (pointIndex / (total - 1)) * 2 - 1 : 0;
    this.tone(freq, 190, {
      type: SERIES_WAVEFORMS[seriesIndex % SERIES_WAVEFORMS.length]!,
      pan,
    });
  }

  playEarcon(name: EarconName): void {
    switch (name) {
      case 'start':
        this.tone(880, 70, { type: 'sine', gain: 0.5 });
        break;
      case 'end':
        this.tone(660, 70, { type: 'sine', gain: 0.5 });
        this.timers.push(setTimeout(() => this.tone(440, 110, { type: 'sine', gain: 0.5 }), 80));
        break;
      case 'max':
        this.tone(1568, 90, { type: 'triangle', gain: 0.55 });
        this.timers.push(setTimeout(() => this.tone(2093, 110, { type: 'triangle', gain: 0.5 }), 90));
        break;
      case 'min':
        this.tone(330, 90, { type: 'triangle', gain: 0.55 });
        this.timers.push(setTimeout(() => this.tone(247, 110, { type: 'triangle', gain: 0.5 }), 90));
        break;
      case 'gap':
        // Deliberately unmusical, so an unreadable point cannot be mistaken
        // for a real low value or for a pause.
        this.noise(140, 0.32);
        break;
      case 'boundary':
        this.tone(160, 150, { type: 'square', gain: 0.32 });
        break;
    }
  }

  /** One-shot tone. Also used by the audio-tactile haptic transport. */
  tone(
    freq: number,
    durationMs: number,
    options: { type?: OscillatorType; gain?: number; pan?: number } = {},
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = options.type ?? 'sine';
    osc.frequency.value = freq;

    const peak = options.gain ?? 0.8;
    const now = ctx.currentTime;
    const end = now + durationMs / 1000;
    // Short attack/release: a hard gate produces an audible click.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.012);
    gain.gain.setTargetAtTime(0, end - 0.03, 0.02);

    osc.connect(gain);
    if (options.pan !== undefined && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan));
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }

    osc.start(now);
    osc.stop(end + 0.06);
    this.active.push({ stop: () => osc.stop() });
  }

  /** Filtered noise burst, used for the unreadable-value marker. */
  noise(durationMs: number, peak = 0.3): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;

    const frames = Math.max(1, Math.floor((ctx.sampleRate * durationMs) / 1000));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.8;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.01);
    gain.gain.setTargetAtTime(0, now + durationMs / 1000 - 0.03, 0.02);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    this.active.push({ stop: () => source.stop() });
  }

  /**
   * Render a vibration pattern as a low-frequency buzz, so the haptic channel
   * is still perceivable when testing on a laptop with no motor.
   */
  buzz(timings: number[], ramp: 'none' | 'up' | 'down' = 'none'): void {
    const pulses = timings.filter((_, i) => i % 2 === 0);
    let elapsed = 0;
    timings.forEach((ms, i) => {
      if (i % 2 === 0) {
        const pulseIndex = i / 2;
        const progress = pulses.length > 1 ? pulseIndex / (pulses.length - 1) : 0;
        const intensity = ramp === 'up'
          ? 0.35 + progress * 0.5
          : ramp === 'down'
            ? 0.85 - progress * 0.5
            : 0.6;
        const freq = ramp === 'up' ? 60 + progress * 40 : ramp === 'down' ? 100 - progress * 40 : 80;
        this.timers.push(
          setTimeout(() => this.tone(freq, ms, { type: 'sine', gain: intensity }), elapsed),
        );
      }
      elapsed += ms;
    });
  }
}
