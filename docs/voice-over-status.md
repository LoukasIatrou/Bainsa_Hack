# Voice-over / TTS: current state on `main`

**Handoff to: Person 3 (Audio/haptic engine)**
**From: code audit, 2026-09-26**

This is what the codebase actually does for speech today, not what's planned. See
`phone-demo-navigation.md` for the design decisions/open questions and `person2-reasoning.md`
§5 for the specific checklist items Person 2 (Haris) has already flagged for you.

## 1. What exists today

All speech goes through one helper, `frontend/src/speech.ts`:

```ts
export function announce(text: string): void {
  window.speechSynthesis?.cancel()
  window.speechSynthesis?.speak(new SpeechSynthesisUtterance(text))
}
```

Plain native Web Speech API (`speechSynthesis`). No rate/pitch/voice selection, no queue, no
sonification (tone-per-drag was explicitly ruled out per `phone-demo-navigation.md` §8).
`cancel()` always runs before `speak()`, so a new utterance always interrupts whatever is playing.

It's called from three places:

- **`Capture.tsx`**: the instant a frame is captured (inside `canvas.toBlob`, before the network
  call starts), it speaks a fixed string: `"Graph captured. Processing."` — immediate confirmation
  since a blind user has no visual cue the tap registered.
- **`App.tsx`**: after `/extract` resolves, speaks one of three things depending on
  `response.status`: `graph.summary` (ok), a prefixed low-confidence message, or an error/message
  string. This **replaces** whatever is still playing, including a still-speaking "Graph captured.
  Processing." if the response comes back quickly.
- **`Exploration.tsx`**: on every slider/series change, speaks
  `` `${series.name}. ${pointLabel}: ${value}${unit}` `` — one utterance per data point, matching
  the "discrete speech per point" decision in `phone-demo-navigation.md` §2.

Camera status text ("Requesting camera access...", camera errors) is **not** spoken — it's only in
an `aria-live`/`role="alert"` paragraph, so it depends on the OS screen reader picking up the live
region rather than on `announce()`.

## 2. What's built on the backend but not reaching speech yet

`backend/app/reasoning.py` (Person 2, merged into `main`) already produces exactly the phrasing an
engine needs — `overview.text`, `points[].readout` / `.explain`, `interestPoints[].explain`,
`answers.{trend,max,changes,compare}` — via the `/reason` endpoint. **The frontend never calls
`/reason`.** `frontend/src/api.ts` only has `extractGraph()`. So everything spoken today comes
straight from the raw extraction `summary`/`message` fields, not from any of Person 2's crafted
text. There's no Overview/Explain/Next-point/Stop UI and no preset-question Q&A anywhere in `main`
— just the three call sites above.

## 3. Specific asks already on record for you (from `docs/person2-reasoning.md` §5)

These reference an "engine" (`startOverview()`, `describeAxes`, "Explain available"/"Go to next
point" prompts) that **isn't in this repo** — presumably it's on your own branch/machine. Flagging
them here since they're concrete and already blocking merge sign-off:

- **Axes spoken twice**: your `startOverview()` speaks `describeAxes` then `overview.text` —
  Person 2 says the axes should now only be spoken once (`overview.text` no longer repeats them).
- **`readout` no longer carries the delta**: it's brief value+landmark only now (e.g. `"2020: 8.1,
  highest."`); the change-from-previous-point text moved to `points[].explain`. Any code comment
  assuming `readout` includes a delta is stale.
- **Use `interestPoints` / `points[].explain` instead of computing your own stops**: you currently
  derive stops from `isTurningPoint` and write your own sentences; reading these two fields instead
  keeps wording (including the 6-stop cap and "readable" phrasing for missing values) consistent
  everywhere. Suggested as a small (~10-line) change.
- **"Explain available" / "Go to next point" should be vibrations, not speech** — per team
  decision, but the engine currently speaks these prompts.
- **TalkBack conflict**: with Android's screen reader on, finger-drag gestures are captured by
  TalkBack and may not reach the page at all. Untested; simplest demo fallback is TalkBack off with
  the app speaking for itself.

## 4. Gaps vs. `team-plan.md` requirements

- **No pause/replay controls** for speech (required by `team-plan.md` §6/§7 and its completion
  checklist) — not implemented anywhere in `main`.
- **Race condition**: because every `announce()` call cancels in-flight speech, a fast `/extract`
  response can cut off "Graph captured. Processing." before it finishes.

## 5. Open design questions (unresolved, see `phone-demo-navigation.md` §7)

- Explain mode vs. think mode mapping (Overview state vs. Exploration state) isn't confirmed.
- Multi-series speech model undecided: one combined readout per index vs. a two-level series/point
  grid (§7.2) — affects how the speech layer scales past a single series.
- Position recovery after a Q&A interruption mid-exploration isn't decided.
