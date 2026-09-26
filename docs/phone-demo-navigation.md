# Phone Demo: Finger Navigation, Ring Simulator & Speech

**Handoff to: Person 4 (Frontend Demo Experience)**
**From: brainstorm session, 2026-09-26**
**Scope: phone-only demo.** No desktop/keyboard path assumed here — see `team-plan.md` for the
keyboard-exploration requirement, which still applies for non-phone testing but is not this doc's focus.

This builds on the shared `GraphData` contract already in `frontend/src/types.ts` /
`backend/app/schemas.py`. Nothing here changes that contract — it only covers what the Exploration
state does with `xAxis.values` and `series[].values` once a graph is confirmed.

## 1. Core interaction model

Map finger movement to an **index into the data series**, not to raw screen coordinates. Every
downstream layer (speech, haptics, ring) keys off "current data point index," so it stays correct
regardless of phone screen size or graph length.

**Recommended implementation: native `<input type="range" step="1" min="0" max="n-1">`**, styled to
look like the exploration track, rather than a custom `touchmove` handler.

- Why: VoiceOver/TalkBack already know how to make a range slider draggable and swipeable. A custom
  `touchmove` listener conflicts with the screen reader's own touch-exploration gesture (a blind
  user's single-finger drag normally reads whatever's under the finger, not a custom handler).
- The `input` event fires on every step change → drives speech, haptic pulse, and ring update from
  one place.

## 2. Speech: discrete, per point

Decided: **discrete speech per data point**, not continuous sonification/tone. On every index change:

1. `speechSynthesis.cancel()` first, then `speak()` the new value.
   - Without the cancel, fast swiping queues a backlog of stale utterances that keep playing after
     the finger has moved on.
2. Speak `"{x-label}, {value}{unit}"` (e.g. "March, 12 degrees"), not just the number — the x-axis
   label only reaches the blind user through this readout.
3. Pause/replay controls (already required by `team-plan.md` §6/§7) apply to this speech layer too.

## 3. Haptics: real vibration where available

- `navigator.vibrate(pattern)` fires on each index change, using Person 3's five named patterns
  (short pulse, double pulse, long pulse, rising sequence, falling sequence) mapped to the local
  trend between the previous and current point.
- **iOS Safari does not support `navigator.vibrate()` at all** (Android Chrome only). Decide which
  device the demo is rehearsed on — if it's an iPhone, real vibration is not available and the ring
  simulator's pulse layer is the only pulse feedback that exists, not a backup for one that's missing.

## 4. Ring simulator: two-panel layout, two independent visual states

Layout: **ring panel next to the graph panel**, both driven by the same `index` state from the
slider. The graph panel (reconstructed line chart) is for sighted judges only, per `team-plan.md` §4
("blind-user experience remains fully usable without looking at it") — the ring panel is the
haptic-pattern visualization required by `team-plan.md` §6.

The ring has two independent visual layers, both keyed off `index`:

| Layer | Trigger | Shows |
| --- | --- | --- |
| Position dot | Every index change (continuous as finger moves) | Angle `= index / (length - 1) × 360°` around the ring — "how far through the series," independent of value magnitude |
| Pulse flash | Only on index change, using the pattern matching local trend | Mirrors whichever of the 5 named patterns just fired via `navigator.vibrate()` (or would have, on iOS) |

**Labelling requirement (from `team-plan.md` §6/§7):** the ring must never look like it's silently
standing in for real hardware. Add a small text/`aria-live` tag under the ring stating which pattern
just fired (e.g. "rising pulse") and whether it reflects a real vibration or is simulation-only.

## 5. Open questions — not yet decided

- **Pattern-to-trend mapping thresholds.** What counts as "rising" vs. "plateau" vs. a full reversal
  between two adjacent points (e.g. a minimum % change to avoid firing "rising" on noise-level
  fluctuations)? Needs agreement with Person 3 before the pulse layer can be built.
- **Target demo device** (Android vs. iPhone) — decides whether real vibration is part of the
  rehearsed demo or the ring simulator carries the haptic story alone.
- Ring panel visual spec (SVG vs. CSS, exact sizing) not designed yet — only the two-layer behavior
  above is agreed.

## 7. Explain mode vs. think mode, multi-series grid, and position recovery

**Added: brainstorm follow-up, 2026-09-26. Same audience (Person 4), same open-decision status
as §5 — nothing here is settled yet.**

Mapping onto `team-plan.md` §4's four-state model: **"explain mode" = Overview state**
(spoken summary, Step 3, plus spoken answers to preset questions, Step 5). **"think mode" =
Exploration state** (Step 4, the finger-navigation/speech/haptic/ring loop this doc otherwise
describes). Confirm this mapping before building against it — no one has written it down until
now.

### 7.1 Explain mode ambiguities

- **Scope**: does "explain mode" mean only the once-per-graph Overview summary, or does every
  preset-question answer (§5 of `team-plan.md`, e.g. "Where is the maximum?") also count as
  entering explain mode, even if it's asked while the user is mid-exploration?
- **Transition trigger capture → think**: does Overview auto-advance to Exploration once the
  summary finishes playing, or does it require an explicit user action? Team-plan §4 implies
  Overview is reviewed/corrected before exploration, which suggests explicit, not automatic.
- **Interruption**: if a question is asked while already in think mode (mid-slider-drag), does
  the app pause exploration, answer in explain mode, then need to resume exploration exactly
  where the user left off? This is the "pull back to original position" question below — it
  can't be answered without deciding this first.

### 7.2 Think mode: single index vs. multi-series grid

The slider model above is a single 1D index into "current data point," which only works cleanly
for one series. `contracts/graph-data.schema.json` already supports multiple series sharing one
`xAxis.values` array (see `ok.json` fixture: Milan + Palermo), but nothing decides how a phone
user navigates more than one series:

- **(a) Combined readout** — one shared index; at each point, speak all series together (e.g.
  "January: Milan 4°C, Palermo 12°C"). Ring/haptic pattern would need to represent local trend
  for *both* series at once, or alternate.
- **(b) Literal grid** — pick a series first (a row), then scrub points independently (a
  column) within that row, i.e. two nested navigation levels instead of one.

(b) is a real 2D interaction to design (extra gesture/control, extra VoiceOver semantics beyond
the native `<input type="range">` trick above) for a 90-second demo. Recommend (a) unless
side-by-side comparison is the centerpiece of the demo — it keeps think mode to the single
native slider already planned, and avoids inventing a second gesture that risks the same
touchmove/screen-reader conflict already flagged in this doc.

### 7.3 "Pull back to original position" — pick one, this phrase currently maps to three things

- **(A) Explain-mode interruption recovery** — after a Q&A answer interrupts exploration
  (§7.1), does the slider/focus return to the exact index the user was on before the question?
  Recommend yes — matches `team-plan.md` §7's "recovery is part of the product journey, not...
  silent substitution" principle; anything else is disorienting for a non-visual user who can't
  glance at the screen to see where they ended up.
- **(B) Series-switch reference point** — only relevant if 7.2's option (b) grid is chosen: when
  switching from Series A to Series B, does the index carry over (same x-position) or reset to
  0? If (b) is ever built, carry it over — resetting silently changes what the user thinks
  they're pointing at.
- **(C) Full demo reset** — the existing "Reset button for repeating the demonstration" already
  specified in `team-plan.md` §4/§8, which returns the whole app to the Capture state. This is
  unrelated to in-exploration recovery and already has an owner (Person 4); don't conflate it
  with (A) or (B) when discussing this with the team.

## 8. Explicit non-goals for this doc

- Does not cover the keyboard-exploration path required elsewhere in `team-plan.md` — phone-only.
- Does not replace the confirmation/correction flow in the Overview state — this is Exploration-state
  behavior only, assumes a confirmed `GraphData` object already exists.
- Does not introduce continuous sonification (tone-per-drag) — explicitly ruled out in favor of
  discrete per-point speech.
