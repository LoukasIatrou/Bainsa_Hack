/**
 * The demo walkthrough, end to end.
 *
 * Follows the agreed eight steps: capture, confirm, overview, finger
 * exploration, next point, explain, preset question, reset.
 *
 * This is Person 3's **fallback demo**, not a replacement for Person 4's app.
 * `team-plan.md` 8 requires a mode that still works when live capture is
 * unreliable, and requires it to look deliberate rather than like an emergency.
 * It doubles as the reference for wiring the engine into the real frontend --
 * every call here is one Person 4 can copy.
 */

import { AudioHapticEngine, fromPointerEvent } from '../src/index.js';
import type { ExtractionResponse, ReasoningResponse } from '../src/types.js';

const engine = new AudioHapticEngine();
const BACKEND = `${location.protocol}//${location.hostname}:8000`;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const chart = document.getElementById('chart') as unknown as SVGSVGElement;
const curve = document.getElementById('curve') as unknown as SVGPolylineElement;
const fingerDot = document.getElementById('finger') as unknown as SVGCircleElement;
const targetDot = document.getElementById('target') as unknown as SVGCircleElement;

let reasoning: ReasoningResponse | null = null;
/** Which path the data came from, so the mode pill can be honest about it. */
let source: 'live' | 'cached' | null = null;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function showStep(id: 'capture' | 'confirm' | 'explore'): void {
  for (const step of document.querySelectorAll('.step')) step.classList.remove('active');
  $(`step-${id}`).classList.add('active');
}

function setStatus(text: string): void {
  $('status').textContent = text;
}

function setMode(label: string, live: boolean): void {
  const pill = $('modePill');
  pill.textContent = label;
  pill.classList.toggle('live', live);
}

// ---------------------------------------------------------------------------
// 1-2. Capture
// ---------------------------------------------------------------------------

/**
 * Audio must be unlocked inside a real gesture or nothing is audible for the
 * whole demo, so every entry point does it first.
 */
async function unlockFrom(action: () => Promise<void> | void): Promise<void> {
  await engine.unlock();
  await action();
}

$('btnKnown').addEventListener('click', () => unlockFrom(async () => {
  setStatus('Loading the cached extraction…');
  try {
    const res = await fetch(`${BACKEND}/extract/mock?scenario=unemployment_us`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadExtraction(await res.json() as ExtractionResponse, 'cached');
  } catch (error) {
    captureFailed(error);
  }
}));

$('btnUpload').addEventListener('click', () => unlockFrom(() => {
  $<HTMLInputElement>('fileInput').removeAttribute('capture');
  $<HTMLInputElement>('fileInput').click();
}));

$('btnCamera').addEventListener('click', () => unlockFrom(() => {
  $<HTMLInputElement>('fileInput').setAttribute('capture', 'environment');
  $<HTMLInputElement>('fileInput').click();
}));

$<HTMLInputElement>('fileInput').addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  setStatus('Reading the graph…');
  engine.speech.speak('Reading the graph. One moment.', 'interrupt');

  try {
    const body = new FormData();
    body.append('image', file);
    const res = await fetch(`${BACKEND}/extract`, { method: 'POST', body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadExtraction(await res.json() as ExtractionResponse, 'live');
  } catch (error) {
    captureFailed(error);
  }
});

function captureFailed(error: unknown): void {
  setStatus(`Capture failed: ${String(error)}`);
  // Recovery is part of the demo, not an accident -- say what to do next.
  engine.speech.speak(
    'That image could not be read. Try again, or use the known graph.',
    'interrupt',
  );
  $('captureNote').textContent =
    `Could not reach ${BACKEND}. Use the known graph to continue.`;
}

// ---------------------------------------------------------------------------
// 3. Confirmation
// ---------------------------------------------------------------------------

async function loadExtraction(response: ExtractionResponse, from: 'live' | 'cached'): Promise<void> {
  source = from;
  setMode(from === 'live' ? 'live capture' : 'cached extraction', from === 'live');

  if (response.status === 'error' || !response.graph) {
    // handleExtraction speaks the failure and the recovery action for us.
    engine.handleExtraction(response);
    $('captureNote').textContent = response.message ?? 'No graph was detected.';
    setStatus('Extraction failed.');
    return;
  }

  // Load quietly: the confirmation screen is for *checking*, not for a spoken
  // intro. Audio starts at step 4 when the user taps Overview.
  engine.handleExtraction(response, { announce: false });
  const graph = response.graph;

  $('cType').textContent = `${graph.graphType} graph`;
  $('cTitle').textContent = graph.title;
  $('cX').textContent = `${graph.xAxis.label} — ${graph.xAxis.values[0]} to ${graph.xAxis.values[graph.xAxis.values.length - 1]}`;
  $('cY').textContent = graph.yAxis.unit
    ? `${graph.yAxis.label} (${graph.yAxis.unit})`
    : `${graph.yAxis.label} — unit could not be read`;
  $('cPoints').textContent = `${graph.xAxis.values.length} across ${graph.series.length} series`;

  renderConfidence(response);
  showStep('confirm');
  setStatus(`Loaded "${graph.title}".`);

  // Fetch reasoning now so the preset question is instant later. Optional --
  // everything still works from local phrasing if it fails.
  reasoning = null;
  try {
    const res = await fetch(`${BACKEND}/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph, fieldConfidence: response.fieldConfidence ?? null }),
    });
    if (res.ok) {
      reasoning = await res.json() as ReasoningResponse;
      engine.setReasoning(reasoning);
    }
  } catch {
    // /reason unavailable; local phrasing covers every spoken line.
  }
  $<HTMLButtonElement>('btnMax').disabled = reasoning === null;

  // One short line so a blind user knows the confirmation screen is up and what
  // is on it, without reciting the whole graph.
  const caveat = response.status === 'low_confidence'
    ? ' Some values are uncertain.'
    : '';
  engine.speech.speak(
    `Read a ${graph.graphType} graph: ${graph.title}. `
    + `${Math.round(graph.confidence * 100)} percent confidence.${caveat} `
    + 'Confirm to explore it.',
    'interrupt',
  );
}

function renderConfidence(response: ExtractionResponse): void {
  const list = $('confList');
  list.innerHTML = '';
  const overall = response.graph?.confidence ?? 0;

  const rows: [string, number][] = [['Overall', overall]];
  const fc = response.fieldConfidence;
  if (fc) {
    rows.push(['Axes', Math.min(fc.xAxis, fc.yAxis)], ['Values', fc.series]);
  }

  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.className = 'conf';
    const bar = document.createElement('span');
    bar.className = value < 0.7 ? 'bar low' : 'bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(value * 100)}%`;
    bar.append(fill);
    const pct = document.createElement('span');
    pct.textContent = `${Math.round(value * 100)}%`;
    dd.append(bar, pct);
    list.append(dt, dd);
  }

  const banner = $('confirmBanner');
  banner.innerHTML = '';
  if (response.status === 'low_confidence') {
    const div = document.createElement('div');
    div.className = 'banner';
    div.textContent = response.message ?? 'Some values are uncertain. Check before trusting them.';
    banner.append(div);
  }
}

$('btnRetake').addEventListener('click', () => {
  engine.stopAll();
  showStep('capture');
  setStatus('Ready.');
});

$('btnConfirm').addEventListener('click', () => unlockFrom(() => {
  showStep('explore');
  syncViewBox();
  drawCurve();
  setStatus('Drag a finger across the graph.');
  engine.speech.speak('Ready to explore. Drag a finger across the graph.', 'interrupt');
}));

// ---------------------------------------------------------------------------
// 4-7. Explore
// ---------------------------------------------------------------------------

/**
 * The viewBox is resized to the element's real aspect ratio rather than
 * stretched with preserveAspectRatio="none", which would squash the finger and
 * target markers into ovals.
 */
const VIEW = { w: 400, h: 260, pad: 22 };

function syncViewBox(): void {
  const rect = chart.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  VIEW.h = Math.round((VIEW.w * rect.height) / rect.width);
  chart.setAttribute('viewBox', `0 0 ${VIEW.w} ${VIEW.h}`);
}

function toSvg(nx: number, ny: number): { x: number; y: number } {
  return {
    x: VIEW.pad + nx * (VIEW.w - VIEW.pad * 2),
    y: VIEW.h - VIEW.pad - ny * (VIEW.h - VIEW.pad * 2),
  };
}

function drawCurve(): void {
  const graph = engine.getGraph();
  if (!graph) return;
  const series = graph.series[engine.explore.currentSeries];
  if (!series) return;
  const nums = series.values.filter((v): v is number => v !== null);
  if (nums.length === 0) return;
  const min = Math.min(...nums);
  const span = (Math.max(...nums) - min) || 1;

  const pts: string[] = [];
  series.values.forEach((v, i) => {
    if (v === null) return;
    const nx = series.values.length > 1 ? i / (series.values.length - 1) : 0.5;
    const p = toSvg(nx, (v - min) / span);
    pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  });
  curve.setAttribute('points', pts.join(' '));
  drawTarget();
}

function drawTarget(): void {
  const graph = engine.getGraph();
  const t = engine.guidance.getTarget();
  if (!graph || t === null) {
    targetDot.setAttribute('cx', '-30');
    return;
  }
  const series = graph.series[engine.explore.currentSeries];
  const value = series?.values[t];
  if (value === null || value === undefined || !series) return;
  const nums = series.values.filter((v): v is number => v !== null);
  const min = Math.min(...nums);
  const span = (Math.max(...nums) - min) || 1;
  const nx = series.values.length > 1 ? t / (series.values.length - 1) : 0.5;
  const p = toSvg(nx, (value - min) / span);
  targetDot.setAttribute('cx', p.x.toFixed(1));
  targetDot.setAttribute('cy', p.y.toFixed(1));
}

/** Account for the chart's inner padding so the curve lines up with the finger. */
function chartCoords(event: PointerEvent): { x: number; y: number } {
  const raw = fromPointerEvent(event, chart);
  const padX = VIEW.pad / VIEW.w;
  const padY = VIEW.pad / VIEW.h;  // VIEW.h tracks the element, see syncViewBox
  return {
    x: (raw.x - padX) / (1 - padX * 2),
    y: (raw.y - padY) / (1 - padY * 2),
  };
}

let tracing = false;

chart.addEventListener('pointerdown', (event) => {
  tracing = true;
  try {
    chart.setPointerCapture(event.pointerId);
  } catch {
    // Capture is a convenience; tracing works without it.
  }
  handleTrace(event);
  event.preventDefault();
});
chart.addEventListener('pointermove', (event) => {
  if (tracing) handleTrace(event);
});
chart.addEventListener('pointerup', (event) => {
  tracing = false;
  try {
    chart.releasePointerCapture(event.pointerId);
  } catch {
    // Already released.
  }
});

function handleTrace(event: PointerEvent): void {
  const { x, y } = chartCoords(event);
  engine.guide(x, y);
  const p = toSvg(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  fingerDot.setAttribute('cx', p.x.toFixed(1));
  fingerDot.setAttribute('cy', p.y.toFixed(1));
}

$('btnOverview').addEventListener('click', () => unlockFrom(() => {
  engine.startOverview();
  drawTarget();
}));
$('btnNext').addEventListener('click', () => {
  engine.nextPoint();
  drawTarget();
});
$('btnExplain').addEventListener('click', () => engine.explain());
$('btnMax').addEventListener('click', () => {
  engine.ask('max');
  drawTarget();
});
$('btnStop').addEventListener('click', () => engine.stopSpeaking());
$('btnReset').addEventListener('click', () => {
  engine.stopAll();
  reasoning = null;
  source = null;
  setMode('prototype', false);
  $('caption').textContent = '—';
  $('pulse').textContent = '';
  $('captureNote').textContent = '';
  showStep('capture');
  setStatus('Ready.');
});

// ---------------------------------------------------------------------------
// Live captions and pulse narration
// ---------------------------------------------------------------------------

engine.on((event) => {
  switch (event.type) {
    case 'speech:caption':
      // Everything spoken is also on screen, so the demo survives a room where
      // nobody can hear the phone.
      $('caption').textContent = event.text;
      break;
    case 'haptic:pattern':
      // Lets the presenter narrate each pulse as it happens.
      $('pulse').innerHTML = `<b>${event.pattern}</b> — ${event.meaning}`;
      break;
    case 'focus:change':
      drawTarget();
      break;
    case 'status:change':
      if (source !== null && !event.status.activeTransports.includes('vibration')) {
        setStatus('Haptics: simulated (no phone vibration on this device).');
      }
      break;
  }
});

window.addEventListener('resize', () => {
  syncViewBox();
  drawCurve();
});

setStatus(`Backend: ${BACKEND}`);
Object.assign(window, { engine });
