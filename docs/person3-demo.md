# Demo runbook — audio and haptics (Person 3)

The eight-step walkthrough, what each step calls, and what can go wrong.

Two pages exist. **Person 4's app is the demo.** The page below is the fallback
`team-plan.md` 8 requires, and the reference for wiring the engine in.

```
backend   cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
frontend  cd audio-haptics && npm start        # opens Chrome with the speech flag
phone     http://<laptop-ip>:5173/demo.html
```

## The steps

| # | Step | Call | Notes |
| --- | --- | --- | --- |
| 1 | Show the graph | — | Physical. |
| 2 | Capture or upload | `POST /extract`, or `GET /extract/mock?scenario=unemployment_us` | The known graph is one tap, no camera. |
| 3 | Confirmation screen | `handleExtraction(res, { announce: false })` | Loads silently and speaks one short line. Confidence bars come from `fieldConfidence`. |
| 4 | Overview | `startOverview()` | Speaks type and both axes, then Person 2's summary: *"It spikes to 8.1 percent in 2020, then falls back to 4 percent by 2024."* |
| 5 | Finger exploration | `guide(x, y)` on every pointermove | `rising`/`falling` steer to the curve, `short` ticks along it, `double` on the target. Every pulse's meaning is on screen for narration. |
| 6 | Next point, Explain | `nextPoint()`, `explain()` | Explain describes where the finger *is*, not where it was sent. |
| 7 | Preset question | `ask('max')` | Needs `POST /reason`. Speaks the answer, then moves to the evidence. |
| 8 | Close | `stopAll()` resets | Confidence and recovery are on screen throughout. |

## What is honest about this demo

- **Haptics are simulated.** `navigator.vibrate()` is accepted and ignored on
  the demo handset, and the API cannot report that, so vibration is off by
  default and the footer says so. Do not claim the phone is buzzing.
- **Cached vs live** is labelled in the header pill: "cached extraction" or
  "live capture". The known-graph path is a legitimate mode, not a fake.
- **Confidence is shown, not hidden.** Low-confidence fields get a warning
  colour and a spoken caveat.
- Everything spoken is also printed, so the demo survives a room too loud to
  hear the phone.

## Failure modes, and what to do

| Symptom | Cause | Fix |
| --- | --- | --- |
| No speech at all | Desktop Chrome reports zero voices | Launch with `--enable-speech-dispatcher` (`npm start` does). Android is fine. |
| Nothing audible on the laptop | Output routed to the USB DAC | `pactl set-default-sink ...Speaker__sink` |
| `ERR_SSL_PROTOCOL_ERROR` on the phone | Chrome upgraded the URL to https | Settings → Privacy → "Always use secure connections" off; type `http://` |
| Camera refuses to open | `getUserMedia` needs a secure context | `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add the origin |
| Capture misreads the graph | Live extraction is unpredictable | Use the known graph. That is why it exists. |
| Preset question does nothing | `/reason` unreachable | The button disables itself; everything else still works. |

## Rehearsal check

Before presenting, on the actual phone:

1. Tap **Use the known graph** — confirmation appears, one line is spoken.
2. Tap **Overview** — the spike sentence plays.
3. Drag from below the curve upward — pulses change on reaching it.
4. **Next point** then **Explain** — lands on a turning point and describes it.
5. **Where is the maximum?** — answers 8.1 percent in 2020.
6. **Start over** — returns to capture with nothing left speaking.

If all six pass, the demo is safe to run.
