/**
 * Harness for the audio/haptic engine.
 *
 * Deliberately fetches Person 1's real `GET /extract/mock?scenario=...` rather
 * than hardcoding fixtures, so this exercises the actual wire format and the
 * actual `ExtractionResponse` contract from the first minute.
 */

import {
  AudioHapticEngine,
  HAPTIC_PATTERNS,
  describeSonification,
  patternDuration,
} from '../src/index.js';
import type {
  EngineEvent,
  ExtractionResponse,
  HapticPatternName,
} from '../src/types.js';

const engine = new AudioHapticEngine();

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

// The phone loads this page from the laptop's IP, so the backend is the same
// host on port 8000. Backend CORS is already open for exactly this reason.
const backendInput = $<HTMLInputElement>('backend');
backendInput.value = `${location.protocol}//${location.hostname}:8000`;

// ---------------------------------------------------------------------------
// Event stream -> status, transcript, simulator
// ---------------------------------------------------------------------------

const ring = $('ring');
const patternLabel = $('patternLabel');
const transcript = $<HTMLUListElement>('transcript');
const live = $('live');
const focusReadout = $('focusReadout');

let pulseTimers: ReturnType<typeof setTimeout>[] = [];

/** Minimal stand-in for Person 4's visual simulator, driven by haptic:pattern. */
function animatePattern(timings: number[], ramp: 'none' | 'up' | 'down'): void {
  for (const t of pulseTimers) clearTimeout(t);
  pulseTimers = [];

  const pulses = timings.filter((_, i) => i % 2 === 0).length;
  let elapsed = 0;
  let pulseIndex = 0;

  timings.forEach((ms, i) => {
    if (i % 2 === 0) {
      const progress = pulses > 1 ? pulseIndex / (pulses - 1) : 0;
      const scale = ramp === 'up'
        ? 0.8 + progress * 0.6
        : ramp === 'down'
          ? 1.4 - progress * 0.6
          : 1.15;
      pulseTimers.push(
        setTimeout(() => {
          ring.classList.add('pulse');
          ring.style.transform = `scale(${scale.toFixed(2)})`;
        }, elapsed),
      );
      pulseTimers.push(
        setTimeout(() => {
          ring.classList.remove('pulse');
          ring.style.transform = 'scale(1)';
        }, elapsed + ms),
      );
      pulseIndex += 1;
    }
    elapsed += ms;
  });
}

function addTranscriptLine(text: string, meta: string): void {
  const li = document.createElement('li');
  const metaEl = document.createElement('span');
  metaEl.className = 'meta';
  metaEl.textContent = `${meta} · `;
  li.append(metaEl, document.createTextNode(text));
  transcript.prepend(li);
  while (transcript.children.length > 40) transcript.lastElementChild?.remove();
}

engine.on((event: EngineEvent) => {
  switch (event.type) {
    case 'speech:caption':
      addTranscriptLine(event.text, event.priority);
      live.textContent = event.text;
      break;

    case 'haptic:pattern': {
      animatePattern(event.timings, event.ramp);
      const channels = event.transports.length > 0 ? event.transports.join(' + ') : 'none';
      patternLabel.textContent =
        `${event.pattern} (${patternDuration(HAPTIC_PATTERNS[event.pattern])}ms) — `
        + `${event.meaning} [${channels}]`;
      break;
    }

    case 'focus:change':
      focusReadout.textContent = event.value === null
        ? `${event.seriesName} · ${event.label} · unreadable`
        : `${event.seriesName} · ${event.label} · ${event.value}`;
      break;

    case 'status:change': {
      const s = event.status;
      $('s-unlocked').textContent = s.audioUnlocked ? 'yes' : 'no';
      $('s-speaking').textContent = s.speaking ? (s.speechPaused ? 'paused' : 'yes') : 'no';
      $('s-sonifying').textContent = s.sonifying ? 'yes' : 'no';
      $('s-extraction').textContent = s.extractionStatus ?? '—';
      $('s-transports').innerHTML = '';
      for (const id of ['vibration', 'simulator', 'audio-tactile']) {
        const on = s.activeTransports.includes(id);
        const pill = document.createElement('span');
        pill.className = `pill ${on ? 'on' : 'off'}`;
        pill.textContent = on ? id : `${id} (unavailable)`;
        pill.style.marginRight = '6px';
        $('s-transports').append(pill);
      }
      break;
    }
  }
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

$('unlock').addEventListener('click', async () => {
  const ok = await engine.unlock();
  $('unlockNote').textContent = ok
    ? 'Audio is enabled.'
    : 'Audio could not be enabled on this device — check the ringer/mute switch.';
  $('unlockNote').className = ok ? 'note' : 'note bad';
  // navigator.vibrate needs prior user activation; this click supplies it.
  engine.playPattern('short');
});

$('testPattern').addEventListener('click', () => engine.playPattern('double'));

$('diagnose').addEventListener('click', async () => {
  const out = $('diagnostic');
  out.style.display = 'block';
  out.textContent = 'Running…';
  const r = await engine.selfTest();
  const yn = (ok: boolean) => (ok ? 'YES' : 'NO');
  out.textContent = [
    `Audio unlocked        ${yn(r.audioUnlocked)}`,
    `Engine emitting sound ${yn(r.audioProducingSound)}   (signal level ${r.audioSignalLevel})`,
    `Speech voices         ${r.speechVoices}`,
    `Speech will be heard  ${yn(r.speechUsable)}`,
    `Vibration API         ${yn(r.vibrationApi)}`,
    `Haptic channels       ${r.activeTransports.join(', ') || 'none'}`,
    '',
    ...r.problems.map((p) => `• ${p}`),
  ].join('\n');
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scenario]')) {
  button.addEventListener('click', async () => {
    const scenario = button.dataset.scenario!;
    const note = $('loadNote');
    note.className = 'note';
    note.textContent = `Loading ${scenario}…`;
    try {
      const base = backendInput.value.replace(/\/$/, '');
      const res = await fetch(`${base}/extract/mock?scenario=${scenario}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ExtractionResponse;
      engine.handleExtraction(data);
      note.textContent = data.graph
        ? `Loaded "${data.graph.title}" — status ${data.status}, `
          + `${data.graph.series.length} series, ${data.graph.xAxis.values.length} points.`
        : `Status ${data.status}: ${data.message ?? 'no graph returned'}`;
      if (data.status !== 'ok') note.className = 'note warn';
    } catch (error) {
      note.className = 'note bad';
      note.textContent =
        `Could not reach ${backendInput.value}. Start the backend `
        + `(cd backend && uv run fastapi dev --host 0.0.0.0) — ${String(error)}`;
    }
  });
}

$('prev').addEventListener('click', () => engine.explore.prev());
$('next').addEventListener('click', () => engine.explore.next());
$('max').addEventListener('click', () => engine.explore.jumpToMax());
$('min').addEventListener('click', () => engine.explore.jumpToMin());
$('series').addEventListener('click', () => engine.explore.nextSeries());
$('where').addEventListener('click', () => engine.speakCurrentPoint());

const quantise = $<HTMLInputElement>('quantise');

$('sonifyContinuous').addEventListener('click', () =>
  engine.sonify.play({ mode: 'continuous', quantise: quantise.checked }));
$('sonifyDiscrete').addEventListener('click', () =>
  engine.sonify.play({ mode: 'discrete', quantise: quantise.checked }));
$('sonifySeries0').addEventListener('click', () =>
  engine.sonify.series(0, { quantise: quantise.checked }));
$('sonifySeries1').addEventListener('click', () =>
  engine.sonify.series(1, { quantise: quantise.checked }));
$('describe').addEventListener('click', () => engine.speakSonificationDescription());

$('pause').addEventListener('click', () => engine.pause());
$('resume').addEventListener('click', () => engine.resume());
$('replay').addEventListener('click', () => engine.replay());
$('stop').addEventListener('click', () => engine.stopAll());

const rate = $<HTMLInputElement>('rate');
rate.addEventListener('input', () => {
  $('rateValue').textContent = Number(rate.value).toFixed(1);
  engine.setRate(Number(rate.value));
});

$<HTMLInputElement>('tactile').addEventListener('change', (e) => {
  engine.haptics.setEnabled('audio-tactile', (e.target as HTMLInputElement).checked);
});

// One button per pattern, generated from the pattern library so the harness
// cannot drift from it.
const patternButtons = $('patternButtons');
for (const name of Object.keys(HAPTIC_PATTERNS) as HapticPatternName[]) {
  const spec = HAPTIC_PATTERNS[name];
  const button = document.createElement('button');
  button.textContent = `${name} (${patternDuration(spec)}ms)`;
  button.title = spec.meaning;
  button.addEventListener('click', () => engine.playPattern(name));
  patternButtons.append(button);
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (event) => {
  // Never hijack typing in the backend field.
  if (event.target instanceof HTMLInputElement) return;

  const actions: Record<string, () => void> = {
    ArrowRight: () => engine.explore.next(),
    ArrowLeft: () => engine.explore.prev(),
    ArrowUp: () => engine.explore.nextSeries(),
    ArrowDown: () => engine.explore.nextSeries(),
    Home: () => engine.explore.first(),
    End: () => engine.explore.last(),
    m: () => engine.explore.jumpToMax(),
    n: () => engine.explore.jumpToMin(),
    s: () => engine.explore.nextSeries(),
    r: () => engine.replay(),
    p: () => engine.pause(),
    ' ': () => engine.sonify.play({ quantise: quantise.checked }),
  };

  const action = actions[event.key] ?? actions[event.key.toLowerCase()];
  if (action) {
    event.preventDefault();
    action();
  }
});

// Exposed for console assertions during verification.
Object.assign(window, { engine, describeSonification, HAPTIC_PATTERNS });

// ---------------------------------------------------------------------------
// Explore page: haptic curve-following
// ---------------------------------------------------------------------------

const chart = document.getElementById('chart') as unknown as SVGSVGElement;
const curveLine = document.getElementById('curveLine') as unknown as SVGPolylineElement;
const fingerDot = document.getElementById('fingerDot') as unknown as SVGCircleElement;
const targetDot = document.getElementById('targetDot') as unknown as SVGCircleElement;
const pushLine = document.getElementById('pushLine') as unknown as SVGLineElement;
const guidanceReadout = $('guidanceReadout');

const VIEW = { w: 400, h: 260, pad: 16 };

/** Normalised data space (y up) -> SVG coords (y down). */
const toSvg = (nx: number, ny: number) => ({
  x: VIEW.pad + nx * (VIEW.w - VIEW.pad * 2),
  y: VIEW.h - VIEW.pad - ny * (VIEW.h - VIEW.pad * 2),
});

function drawCurve(): void {
  const graph = engine.getGraph();
  if (!graph) {
    curveLine.setAttribute('points', '');
    return;
  }
  const series = graph.series[engine.explore.currentSeries];
  if (!series) return;
  const values = series.values.filter((v): v is number => v !== null);
  if (values.length === 0) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const pts: string[] = [];
  series.values.forEach((v, i) => {
    if (v === null) return; // a gap stays a gap
    const nx = series.values.length > 1 ? i / (series.values.length - 1) : 0.5;
    const p = toSvg(nx, (v - min) / span);
    pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  });
  curveLine.setAttribute('points', pts.join(' '));
  drawTarget();
}

function drawTarget(): void {
  const graph = engine.getGraph();
  const target = engine.guidance.getTarget();
  if (!graph || target === null) {
    targetDot.setAttribute('cx', '-20');
    return;
  }
  const series = graph.series[engine.explore.currentSeries];
  const value = series?.values[target];
  if (value === null || value === undefined) return;
  const values = series!.values.filter((v): v is number => v !== null);
  const min = Math.min(...values);
  const span = (Math.max(...values) - min) || 1;
  const nx = series!.values.length > 1 ? target / (series!.values.length - 1) : 0.5;
  const p = toSvg(nx, (value - min) / span);
  targetDot.setAttribute('cx', p.x.toFixed(1));
  targetDot.setAttribute('cy', p.y.toFixed(1));
}

/** Pointer -> normalised data space, accounting for the SVG's inner padding. */
function chartCoords(event: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = chart.getBoundingClientRect();
  const padX = (VIEW.pad / VIEW.w) * rect.width;
  const padY = (VIEW.pad / VIEW.h) * rect.height;
  const innerW = rect.width - padX * 2;
  const innerH = rect.height - padY * 2;
  return {
    x: innerW <= 0 ? 0 : (event.clientX - rect.left - padX) / innerW,
    y: innerH <= 0 ? 0 : 1 - (event.clientY - rect.top - padY) / innerH,
  };
}

let tracking = false;

function handlePointer(event: PointerEvent): void {
  const { x, y } = chartCoords(event);
  const reading = engine.guide(x, y);

  const p = toSvg(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  fingerDot.setAttribute('cx', p.x.toFixed(1));
  fingerDot.setAttribute('cy', p.y.toFixed(1));

  if (reading.push !== 'none' && reading.curveY !== null) {
    const to = toSvg(Math.min(1, Math.max(0, x)), reading.curveY);
    pushLine.setAttribute('x1', p.x.toFixed(1));
    pushLine.setAttribute('y1', p.y.toFixed(1));
    pushLine.setAttribute('x2', to.x.toFixed(1));
    pushLine.setAttribute('y2', to.y.toFixed(1));
  } else {
    pushLine.setAttribute('x2', pushLine.getAttribute('x1') ?? '-20');
    pushLine.setAttribute('y2', pushLine.getAttribute('y1') ?? '-20');
  }

  guidanceReadout.className = `note ${reading.state}`;
  guidanceReadout.textContent = reading.state === 'on-curve'
    ? `ON CURVE at point ${reading.index + 1}`
    : reading.state === 'off-chart'
      ? 'Off the chart.'
      : reading.push === 'none'
        ? `Point ${reading.index + 1}: no readable value here.`
        : `Move ${reading.push.toUpperCase()} — ${Math.abs((reading.delta ?? 0) * 100).toFixed(0)}% away`;
}

chart.addEventListener('pointerdown', (e) => {
  tracking = true;
  chart.setPointerCapture(e.pointerId);
  handlePointer(e);
});
chart.addEventListener('pointermove', (e) => {
  if (tracking) handlePointer(e);
});
chart.addEventListener('pointerup', (e) => {
  tracking = false;
  chart.releasePointerCapture(e.pointerId);
});

$('btnOverview').addEventListener('click', async () => {
  await engine.unlock();
  engine.startOverview();
  drawTarget();
});
$('btnNext').addEventListener('click', () => { engine.nextPoint(); drawTarget(); });
$('btnExplain').addEventListener('click', () => engine.explain());
$('btnStop').addEventListener('click', () => engine.stopSpeaking());

engine.on((event) => {
  if (event.type === 'status:change') drawTarget();
});

// Redraw whenever a graph is loaded.
const originalHandle = engine.handleExtraction.bind(engine);
engine.handleExtraction = (response) => {
  originalHandle(response);
  drawCurve();
};
