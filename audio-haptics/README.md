# @bainsa/audio-haptics

Person 3's deliverable: coordinated speech, sonification and haptic behaviour
for the graph accessibility copilot.

Renders no UI. Everything is methods to call and events to subscribe to, so
Person 4 owns how controls, status and the simulator look.

Zero runtime dependencies. TypeScript and Vite are dev-only.

## Integration (Person 4)

```bash
cd frontend && npm i file:../audio-haptics
```

```ts
import { AudioHapticEngine } from '@bainsa/audio-haptics';

const engine = new AudioHapticEngine();

// One subscription drives the live region, status display and simulator.
engine.on((event) => {
  switch (event.type) {
    case 'speech:caption':  liveRegion.textContent = event.text; break;
    case 'haptic:pattern':  simulator.play(event.timings, event.ramp); break;
    case 'focus:change':    highlightPoint(event.series, event.index); break;
    case 'status:change':   renderStatus(event.status); break;
  }
});
```

**`unlock()` must be called from inside a click or keypress handler** — the
capture button is the natural place. Browsers block Web Audio until then, and on
Android the first utterance and the first vibration both need that user
activation too. Nothing is audible before it, silently.

```ts
captureButton.addEventListener('click', async () => {
  await engine.unlock();
  // ...capture the image, POST it to /extract...
  engine.handleExtraction(response);   // the whole ExtractionResponse, unmodified
});
```

`handleExtraction` branches on `status` for you:

| status | What the engine does |
| --- | --- |
| `error` | Speaks the failure and the recovery action. Loads no graph. |
| `low_confidence` | Speaks the caveat, then which fields need checking, then the graph. |
| `ok` | Speaks the intro, then the summary. |

## Person 2's `/reason` (optional but preferred)

```ts
const reasoning = await fetch('/api/reason', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ graph, fieldConfidence }),
}).then((r) => r.json());

engine.setReasoning(reasoning);
engine.ask('trend' | 'max' | 'changes' | 'compare');
```

With a `ReasoningResponse` supplied the engine upgrades itself:

| Field | What the engine does with it |
| --- | --- |
| `series[].points[].readout` | Spoken instead of the local phrasing — carries the delta ("up 5 from February"). |
| `points[].normalised` | Drives pitch directly. Computed across *all* series, so two series share one comparable scale. |
| `points[].isMax / isMin / isTurningPoint` | Selects the `double` pulse. |
| `points[].direction` | Selects `rising` / `falling`. Their 2% threshold means small wobbles correctly read as flat. |
| `overview.text` + `caveats` | Supersedes `GraphData.summary`; caveats are spoken, never dropped. |
| `answers[q].highlight` | `ask()` moves focus there so the answer is explorable, not just audible. |

Without it, everything falls back to the local phrasing and analysis, so the
demo still runs if `/reason` is down. `setGraph` and `handleExtraction` both
clear stale reasoning — call `setReasoning` again after any user correction,
since `/reason` has to be re-run anyway.

## Spider-sense circle (Person 4's component)

`frontend/src/spiderSense/logic.ts` is pure by design -- "so audio/haptics can
drive the same state machine later without going through the visual component".
This is that driver:

```tsx
import { createSpiderSenseBinding } from '@bainsa/audio-haptics';

const onState = useMemo(
  () => createSpiderSenseBinding(engine, { pointCount, box: { width, padding } }),
  [engine, pointCount, width, padding],
);

<SpiderSense curve={curve} width={w} height={h} onStateChange={onState} />
```

Pass it straight to `onStateChange`; it throttles internally, so it is safe on
every pointermove. What the user gets:

| Their state | Result |
| --- | --- |
| `searching`, angle pointing up | `rising`, repeating faster as `distance` shrinks |
| `searching`, angle pointing down | `falling`, same proximity ramp |
| `searching`, angle near horizontal | `short` -- claiming "up" for a sideways target would mislead |
| `on-curve`, first contact | `double`, overriding the trend so arrival always feels identical |
| `on-curve`, crossing into a new index | the data-driven pattern, plus the spoken readout |
| `pointer: null` | pulsing stops; their `lastContact` memory is untouched |

`distance` drives the repeat rate (700ms far, 140ms near), which is what their
comment intends by "drives the pulse". Screen x maps to a data index through the
same `box` the curve was built into — `indexAtX` is exported if you need it.

## Phone integration (Person 4)

Per `docs/phone-demo-navigation.md`: a native `<input type="range">` drives an
index, and speech, vibration and the ring all key off it.

```tsx
<input type="range" min={0} max={length - 1} step={1}
       onInput={(e) => engine.exploreIndex(e.currentTarget.valueAsNumber)} />
```

`exploreIndex` cancels-then-speaks (doc 2), fires the matching vibration
pattern and emits the ring state, from one call.

### Ring simulator

```tsx
import { createRingBinding, RING_PATTERN_LABELS } from '@bainsa/audio-haptics';
import type { RingState } from '@bainsa/audio-haptics';

const [ring, setRing] = useState<RingState | null>(null);
useEffect(() => createRingBinding(engine, setRing), [engine]);

<RingSimulator index={ring.index} length={ring.length} direction={ring.direction} />
```

`RingState` carries everything both layers need: `index`, `length`, `angle`
(already `index / (length - 1) * 360`), `pattern`, `label`, `timings`, `ramp`,
`vibrated` and a ready-to-render `status` string.

**It works with `RingSimulator` unchanged** — `ring.direction` is pre-degraded
onto the existing `'rising' | 'falling' | 'flat' | 'unknown'` prop.

**But two of the five patterns cannot survive that**: `double` (a peak or
trough) and `long` (a boundary or unreadable point) both collapse to
`'unknown'`, and those are the moments most worth feeling. Doc 4 says the flash
"mirrors whichever of the 5 named patterns just fired", so the upgrade is to
widen the prop:

```ts
- export type PullDirection = 'rising' | 'falling' | 'flat' | 'unknown'
+ import type { HapticPatternName } from '@bainsa/audio-haptics'
+ export type PullDirection = HapticPatternName   // short | double | long | rising | falling
```

then pass `ring.pattern` instead of `ring.direction`, and use
`RING_PATTERN_LABELS` for the aria-live text. Five CSS classes instead of four.

One `RingState` is emitted per index change, not one per event, so the dot and
the flash can never disagree about which point they are showing.

`status` says **"vibration requested"**, never "vibrating": desktop Chrome
exposes `navigator.vibrate` and silently does nothing, with no way to detect
the difference, and doc 4 forbids the ring implying hardware it cannot confirm.

## Phone vibration is OFF by default

`navigator.vibrate()` is accepted and then silently ignored on a great many
Android builds -- OEM skins, battery saver, Do Not Disturb -- and the API never
reports that it did nothing. Rather than let the demo lean on a channel that
cannot be verified, the **audio-tactile buzz and the ring simulator carry the
haptic meaning**, and vibration is opt-in:

```ts
new AudioHapticEngine({ vibration: true });   // once a human has felt it work
engine.haptics.setEnabled('vibration', true); // or at runtime
```

Nothing else changes when it is off: the same five patterns fire, the same
`haptic:pattern` events reach the simulator, and the buzz makes them audible.
`status.activeTransports` reports what is really running.

## Gestures: menu mode and graph mode

A self-voicing interface with no buttons. Swipe between spoken actions, tap to
choose, two-finger tap to switch between the menu and the graph.

```ts
el.addEventListener('pointerdown', (e) => engine.gestures.pointerDown(e));
el.addEventListener('pointermove', (e) => engine.gestures.pointerMove(e));
el.addEventListener('pointerup',   (e) => engine.gestures.pointerUp(e));
el.addEventListener('pointercancel', (e) => engine.gestures.pointerCancel(e));

// So drags can steer the curve directly:
engine.setPointerConverter((x, y) =>
  fromPointerEvent({ clientX: x, clientY: y }, chartEl));
```

The element needs `touch-action: none`, or the browser scrolls instead.

| Gesture | Menu mode | Graph mode |
| --- | --- | --- |
| Swipe right / down | Next action | — |
| Swipe left / up | Previous action | — |
| Single-finger drag | — | Trace the curve |
| Tap | Activate the action | Re-read the current point |
| Long press | Re-read the action | Explain this point |
| **Two-finger tap** | **Switch to graph mode** | **Back to the menu** |

Two-finger tap is the toggle because it cannot happen by accident while tracing
a line, and screen-reader users already know it from elsewhere.

The menu stops at both ends instead of wrapping, with a `long` pulse and "Start
of menu" / "End of menu" — wrapping costs a blind user their sense of where the
list begins. Unavailable actions are omitted rather than read out as disabled,
so no swipe is wasted: Explain is simply absent on a continuous curve, and
Switch series absent on a single-series graph.

Replace the default actions with `engine.menu.setItems([...])`.

### This claims gestures TalkBack normally owns

A self-voicing app speaks everything itself, which means taking over the
single-finger gestures a screen reader would otherwise use.
`docs/phone-demo-navigation.md` 1 argued the opposite -- let TalkBack drive a
native slider -- and both designs are valid, but they cannot be mixed on one
surface. Pick per screen and tell the team which you picked.

`engine.speech.setVolume(0-1)` exists but 1 is already the default and the API
cannot exceed the phone's media volume; "louder" ultimately means turning the
phone up.

## Continuous vs discrete

```ts
engine.getGraphKind();        // 'continuous' | 'discrete', inferred on load
engine.setGraphKind('continuous');   // override when you know better
engine.supportsExplainMode;   // false for continuous
```

| Kind | Overview | Explain |
| --- | --- | --- |
| `continuous` | Steers onto the curve, then follows it freely — no target, no per-point stops. Speaks the whole-graph summary. | Refused, with a spoken reason. |
| `discrete` | Steers to the first point. | Walks through every point in turn. |

```ts
engine.startExplainMode();      // discrete only
engine.skipToNextExplanation(); // move on without waiting
engine.stopExplainMode();
```

Explain mode per point: steer → `double` on arrival → speak → steer to the next
**when the explanation finishes**, keyed off the speech queue draining rather
than a timer. `status.explainStep` is the 1-based position for display.

Inference is a heuristic (40+ points, or 25+ bare numeric labels, reads as
continuous). Getting it wrong only changes which modes are offered, never what
is spoken — override it when the curve came from sampling a function.

## Explore page: the four buttons

The Explore page is driven by touch — the user drags a finger over the chart and
is steered onto the curve by vibration, rather than stepping through points with
arrow keys.

```ts
import { fromPointerEvent } from '@bainsa/audio-haptics';

chartEl.addEventListener('pointermove', (event) => {
  const { x, y } = fromPointerEvent(event, chartEl);
  engine.guide(x, y);              // throttles internally; call on every move
});

overviewBtn.onclick = () => engine.startOverview();
nextBtn.onclick     = () => engine.nextPoint();
explainBtn.onclick  = () => engine.explain();
stopBtn.onclick     = () => engine.stopSpeaking();
```

| Button | What happens |
| --- | --- |
| **Overview** | Speaks graph type and both axes, then starts guidance at the start of the curve. Guidance runs *while* the speech plays, so the user can be finding the curve as they listen. |
| **Next point** | Targets the next maximum, minimum or turning point. Says "Follow the vibration to the next point." On arrival — when the finger actually gets there — it says "Explain available." |
| **Explain** | Short readout of **where the finger actually is**, not where it was being sent: coordinates, plus whether it is a max, min, turning point, or the start/end of the curve. Ends with "Go to next point." |
| **Stop speaking** | Silences speech only. Guidance keeps running, so cutting off a long explanation does not strand the user's finger. |

`engine.guide()` returns a `GuidanceReading` (`state`, `index`, `curveY`,
`delta`, `push`) if you want to draw the finger position or a hint arrow, and a
`guidance:change` event fires on every state change. See
[`contracts/haptic-patterns.md`](../contracts/haptic-patterns.md) for the
pattern meanings in guidance mode.

**Coordinates are normalised data space**, y increasing upward — the opposite of
`clientY`. Use `fromPointerEvent`, or every direction cue comes out inverted.

## API

| Call | Purpose |
| --- | --- |
| `unlock()` | Enable audio. Must be inside a user gesture. |
| `handleExtraction(response)` | Take Person 1's `ExtractionResponse` as-is. |
| `setGraph(graph, fieldConfidence?)` | Load corrected or cached data directly. |
| `speakIntro()` / `speakOverview(text?)` | Frame, then Person 2's summary. |
| `setReasoning(response)` | Supply Person 2's `/reason` result. See above. |
| `ask(question)` | Speak a preset answer and move focus to its evidence. |
| `speakAnswer(payload)` | Ad-hoc answer not from `/reason`. |
| `speakCurrentPoint()` | "Where am I" — re-read without moving. |
| `speakSonificationDescription()` | Text equivalent of the sonification. |
| `explore.next() / prev() / first() / last()` | Bind to arrow keys and buttons. |
| `explore.jumpToMax() / jumpToMin()` | Skips unreadable points. |
| `explore.selectSeries(n) / nextSeries()` | Multi-series navigation. |
| `sonify.play(opts) / series(n) / pause() / resume() / replay() / stop()` | Graph shape as sound. |
| `playPattern(name)` | Fire one haptic pattern — for simulator test buttons. |
| `pause() / resume() / replay()` | Both speech and sonification together. |
| `startOverview() / nextPoint() / explain() / stopSpeaking()` | The four Explore buttons. |
| `guide(x, y)` | Feed a pointer position in normalised data space. |
| `stopAll()` | Full stop, including guidance. Call this from the reset path. |
| `setRate(0.5–2.0)` | Speech rate. |
| `getStatus()` | `audioUnlocked`, `speaking`, `sonifying`, `activeTransports`, … |

Sonification options: `mode` (`'continuous'` conveys shape, `'discrete'` conveys
individual points), `durationMs`, `quantise` (pentatonic, easier to compare),
`pan`, `seriesIndices`.

## Behaviour worth knowing

- **Nulls are never silent.** `series[].values` may contain `null` ("could not be
  read" per the contract). Those are spoken as unreadable, marked with a
  distinct noise burst rather than silence, given the `long` pulse, and skipped
  by `jumpToMax`/`jumpToMin`. They are never interpolated or treated as zero.
- **Low confidence is hedged.** When `fieldConfidence.series` is below 0.7,
  values are spoken as "approximately N". A null `yAxis.unit` is announced once
  in the intro rather than leaving every value sounding bare.
- **Point readouts interrupt.** Holding an arrow key coalesces to the point
  under the cursor instead of working through a backlog of stale utterances.
- **Every sound has a caption.** `speech:caption` fires for every utterance,
  including on devices with no TTS at all, so the live region and transcript
  stay correct.

Haptic pattern meanings and timings: [`contracts/haptic-patterns.md`](../contracts/haptic-patterns.md).

## Harness

```bash
npm start                  # starts Vite and opens a browser that can speak
```

Or by hand:

```bash
npm run dev -- --host      # then open http://<laptop-ip>:5173 on the phone
```

### Proving speech is audible

`speak()` accepts the text and fires every event even when the browser makes no
sound, so "it didn't throw" proves nothing. Two tools:

```bash
npm run test:speech     # records the audio device and measures the signal
```

It checks the system chain (speech-dispatcher to espeak-ng) automatically, then
gives you a window to press **Speak test** in the harness and measures whether
browser speech reached the device. Peak and RMS are reported, so the verdict is
a measurement rather than an opinion.

In the harness, **Speak test** speaks a known phrase and reports whether
`speech:start` fired, the voice count and the chosen voice. Together the two
separate the three failures that look identical: no voices, no signal, wrong
output device.

### Desktop speech needs a flag

**Chrome on Linux reports ZERO SpeechSynthesis voices by default** and `speak()`
becomes a silent no-op — no error, all events still fire. Chrome disables
speech-dispatcher unless told otherwise:

```bash
google-chrome --enable-speech-dispatcher http://localhost:5173
```

Measured on the dev machine: 0 voices without the flag, 14,824 with it. Firefox
reaches speech-dispatcher unflagged. Electron shells (including editor preview
panes) always report zero and cannot be fixed. **Android Chrome needs none of
this** — the phone, which is the actual target, is the easy platform.

Press **Run diagnostic** in the harness on any new machine. It measures the real
output signal level, counts voices, names the chosen voice and checks the
Vibration API, so a silent demo is caught in two seconds instead of on stage.

Fetches `GET /extract/mock?scenario=…` from the backend at
`http://<same-host>:8000`, so it exercises the real contract rather than
hardcoded fixtures. Start the backend with
`cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000`.

`--host` matters: `navigator.vibrate` is a silent no-op on a laptop, so the
vibration channel can only be verified on the phone.

## Build

```bash
npm run build      # tsc -> dist/ with .d.ts
npm run typecheck
```
