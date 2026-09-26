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
| `stopAll()` | Full stop. Call this from the reset path. |
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
npm run dev -- --host      # then open http://<laptop-ip>:5173 on the phone
```

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
