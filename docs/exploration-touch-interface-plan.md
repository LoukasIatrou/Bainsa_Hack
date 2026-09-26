# Exploration Touch Interface: Grid Pad + Ring (Plan)

**Handoff to: Person 4 (frontend), with Person 3 (haptic patterns) dependencies marked.**
**From: architecture session, 2026-09-26. Builds on `phone-demo-navigation.md`. Nothing in here changes the backend contract.**

Owner's request: *"we need the grid touch interface native for the phone that represents the ring etc."*
Two assumptions this plan makes. **Check both with the owner before Phase 2:**

- **"Native"** means it feels like a phone app (direct finger scrubbing, haptic ticks, no page scroll
  or zoom while dragging). It does **not** mean React Native. We stay a Vite + React web app.
- **"Grid that represents the ring"** means a touch surface where rows are series and columns are
  points. The ring stays next to it as the feedback display. A circular "dial" input was considered
  and rejected (§1.4).

---

## 1. Decision: interaction model (read this first)

### 1.1 The tension

`phone-demo-navigation.md` §1 chose a native `<input type="range">` over a custom `touchmove`
handler because of screen-reader conflicts. §7.2 recommended against a literal grid for the same
reason. Now the owner wants a touch grid. Both requirements can be met, but only if the grid is an
**additional** input and never a **replacement**. Here is why, based on how mobile screen readers
actually behave.

### 1.2 How mobile screen readers actually handle touch (this drives everything)

| Fact | iOS VoiceOver | Android TalkBack |
| --- | --- | --- |
| One-finger touch or drag | The OS takes it for touch exploration and reads whatever is under the finger. **The page gets no `pointer`/`touch` events.** | Same (explore-by-touch). The page gets no events. |
| How a slider is adjusted | Focus it, then **swipe up/down** (it has the "adjustable" trait). Dragging the thumb does **not** move it. | Volume keys, or the slider-adjust gesture of that TalkBack version. Dragging does not move it. |
| Passing touches through to the page | Double-tap and hold, then drag. Touches then reach the page. Advanced users only. | Double-tap and hold does something similar, but behaviour varies by version. Don't depend on it. |
| `role="application"` | **No effect on touch routing on mobile.** It is a desktop browse-mode concept. The web has no equivalent of iOS's `allowsDirectInteraction` / rotor "Direct Touch". | No effect on touch routing. |
| Custom `role="slider"` (APG pattern) | WebKit does not reliably turn VO swipe up/down into key events for custom sliders. Unreliable. | Somewhat better, but still behind native. |
| Detecting whether a screen reader is on | **Not possible from the web.** No API exists; AOM detection was deliberately dropped for privacy. | Same. |

Two consequences:

1. **`phone-demo-navigation.md` §1 slightly overstated the native slider's benefit.** Screen-reader
   users never *drag* it. They adjust it one step at a time with swipes or keys. So "finger scrubbing
   across the data" has never existed for screen-reader users, and a scrub surface for everyone else
   takes nothing away from them.
2. **We don't need screen-reader detection.** The OS already routes touches: when a screen reader is
   on, it consumes one-finger touches before our handlers see them. A pointer-driven surface that is
   `aria-hidden` and not focusable is **inert under a screen reader by construction**, and fully
   active when no screen reader is running. The conflict in §1 only happens if the custom surface
   *is the only way* to navigate, or if it pollutes the accessibility tree. We avoid both.

### 1.3 Options considered

| Option | Screen-reader users | Non-SR users (sighted, low-vision, blind in self-voicing mode) | Verdict |
| --- | --- | --- | --- |
| **A. Status quo.** Slider only, ring is display only | Good | Poor: a small linear slider, no grid, doesn't meet the ask | Rejected: doesn't meet the request |
| **B. Custom grid/ring replaces the slider** (`role="grid"` / `role="application"` / custom `role="slider"` with touch handlers) | **Broken.** Touch is swallowed by VO/TalkBack, `role="application"` does nothing on mobile, custom sliders don't respond to VO swipes in WebKit | Good | **Rejected.** This is exactly the failure §1 warned about |
| **C. Hybrid (recommended).** Native controls stay the single accessible input. An `aria-hidden` pointer-driven **Grid Pad** is added as a parallel input. Both write one shared cursor state | Unchanged from today (plus fixes in §2.4) | Real finger scrubbing, row per series, haptic tick per column, ring feedback | **Recommended** |

### 1.4 Recommendation: Option C, with a rectangular pad rather than a circular dial

Two input channels, one cursor. Neither channel knows about the other.

- **Accessible channel (source of truth for semantics):** series toggle buttons (rows), the native
  range slider (columns), and new "Previous/Next notable point" buttons (§3). Everything works with
  VoiceOver or TalkBack on, and with a keyboard.
- **Direct-touch channel:** the `GridPad`. It is `aria-hidden="true"`, has no `tabindex`, and uses
  `touch-action: none`. Under a screen reader it is inert (bonus: the double-tap-and-hold passthrough
  works on it). Without a screen reader it is the main way to play with the data. That covers sighted
  judges, low-vision users, and **blind users running the app in self-voicing mode with the screen
  reader off**. `voice-over-status.md` already names self-voicing mode as the realistic demo
  fallback, and in that mode the pad is the best experience we have.
- **The ring stays output only.** It sits next to the pad and shows position, slope pulse and
  notable-point ticks.

**Why a rectangular pad instead of making the ring itself draggable:**

- Left-to-right matches the chart's x-axis and the reconstructed graph panel, so low-vision users and
  judges see a direct spatial mapping.
- A closed circle has a wrap-around point where dragging past the top jumps from the last point to
  the first. That is disorienting without sight.
- The thumb hides the part of the circle it is on.
- Blind self-voicing users can find a rectangle's edges by feel against the screen bezel. A circle's
  angle can't be found by feel.

**Can a demo judge feel the ring concept?** Yes. Every pad movement drives the ring, so "finger on the
grid, ring responds" *is* the ring demo.

### 1.5 Resolving §7.2 (grid vs. combined readout)

**Resolved as (b), the literal grid, built only from native controls.** The current `Exploration.tsx`
already does this (series `aria-pressed` buttons for rows, slider for columns; see its header
comment), which contradicts the doc's earlier leaning toward (a). The §7.2 worry was *inventing a
second gesture*. Row selection through buttons invents nothing, and the pad's row selection lives
only in the non-SR channel. The real data (`docs/capture-examples`) has 1–2 series of 5–10 points,
so the grid is at most 2×10. Keep (a), the combined "January: Milan 4, Palermo 12" readout, as a
possible later addition. It is not needed now.

### 1.6 §7.3-B (carry `pointIndex` across series): still holds

On the pad, **the row is locked at `pointerdown`**. Moving vertically during a drag does not switch
series. To switch, lift the finger and touch the other row. Because the column comes from the x
position, lifting and touching a new row at the same x keeps the same column, so carry-over works
naturally. The series buttons keep today's carry-over behaviour. All series share `xAxis.values`, so
`points.length` matches across series and no clamping is needed.

---

## 2. Component architecture

### 2.1 Target tree

```
Exploration.tsx                (layout + wiring only)
├─ series buttons              (unchanged, aria-pressed)          [accessible channel]
├─ RingSimulator.tsx           (output; props extended)            [aria-hidden visual + static SR note]
├─ GridPad.tsx       NEW       (pointer input; aria-hidden)         [direct-touch channel]
├─ p.point-readout             (visual only; aria-live REMOVED, see 2.4)
├─ input[type=range]           (adds aria-valuetext)               [accessible channel]
├─ Prev/Next notable buttons   NEW (§3)                            [accessible channel]
├─ App voice toggle            NEW (aria-pressed)                  (see 2.4)
└─ Back
useExploreCursor.ts  NEW       (the one cursor + all side effects)
```

### 2.2 `useExploreCursor` is the single choke point

Today, speech and vibration fire in a `useEffect` keyed on `[seriesIndex, pointIndex]`. That can't
tell *why* the index changed, so a notable-point jump can't speak `interestPoint.explain`. It also
can't re-announce when a jump lands on the index you are already on. Move all side effects into one
imperative function:

```ts
type CursorSource = 'slider' | 'pad-drag' | 'pad-tap' | 'series' | 'notable'

interface ExploreCursor {
  seriesIndex: number
  pointIndex: number
  series: SeriesInsight
  point: PointInsight
  pulseKey: number                 // increments on every committed move -> restarts ring pulse
  goTo(pointIndex: number, source: CursorSource, seriesIndex?: number): void
  nextNotable(): void              // wraps goTo(..., 'notable'); boundary handling in §3
  prevNotable(): void
}
```

Rules inside `goTo`:

- **Deduplicate `pad-drag` only.** If series and index haven't changed, do nothing. Pointer-move fires
  many times inside one column. Every other source always announces, even on the same index, because
  a deliberate press deserves feedback.
- **Speech content by source:**
  - `pad-drag` speaks the short `point.readout`, because fast drags cancel speech anyway.
  - `notable` speaks `interestPoint.explain`.
  - `series` speaks `${series.name}. ${point.explain}`.
  - Everything else speaks `point.explain`.
  - All speech goes through `announce()`, which is gated by the App voice toggle (2.4).
- **Haptics:** `navigator.vibrate(pattern)` where supported, using Person 3's mapping (dependency,
  `phone-demo-navigation.md` §5). Add a distinct pattern for landing on an interest point
  (`voice-over-status.md` records the team decision that "notable point here" is a vibration, not
  speech).
- **Focus:** `goTo` **never moves focus**. Under VO, moving focus is disorienting. Under self-voicing,
  focus doesn't matter.

### 2.3 `GridPad.tsx`

```ts
interface GridPadProps {
  rows: { name: string; normalised: (number | null)[]; notable: number[] }[]  // from SeriesInsight
  activeRow: number
  activeIndex: number
  onSelect(row: number, index: number, source: 'pad-drag' | 'pad-tap'): void
}
```

- Root: `<div aria-hidden="true" className="grid-pad">`. No `tabindex`, no focusable children
  (otherwise it fails axe `aria-hidden-focus`).
- Use Pointer Events, not `touchmove`:
  - On `pointerdown`, call `setPointerCapture`, lock `row = floor(y / rowHeight)`, compute the column,
    and call `onSelect(…, 'pad-tap')`.
  - On `pointermove`, if the pointer is captured, recompute only the column and call
    `onSelect(…, 'pad-drag')`.
  - On `pointerup`/`pointercancel`, release capture.
- Column mapping: equal bins, `index = clamp(floor((x - left) / width * n), 0, n - 1)`. Draw the
  column cells with the same bins so what you see matches what you hear.
- CSS:
  - `.grid-pad { touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }`
    stops scroll, pinch, text selection and the long-press callout while scrubbing.
  - `html, body { overscroll-behavior: none; }` stops Android pull-to-refresh.
- **Edge insets: at least 24px horizontal margin from the screen edge.** A drag starting at the left
  edge triggers iOS Safari's swipe-back and Android gesture-nav back, which would navigate away in the
  middle of the demo. This is a real risk.
- Row height: at least 64px. Minimum column width at n=10 on a 375px screen is about 30px, which is
  fine for scrubbing. Tap precision matters less because users drag to the value they want.
- Visuals (for sighted and low-vision users): each row shows its series as a sparkline built from
  `points[].normalised` (gaps where null). The active row is highlighted, with a column marker at
  `activeIndex` and small ticks at `interestPoints[].index`. Follow the global CLAUDE.md contrast
  rule of at least 3:1 for UI parts, and check both themes.

### 2.4 Speech-channel fixes (existing bugs, needed before any of this ships)

Right now, with VoiceOver on, one slider step can produce **four** voices:

1. VO reads the slider's raw value ("3"), because there is no `aria-valuetext`.
2. `announce()` speaks `explain` through `speechSynthesis`.
3. `.point-readout` `role="status" aria-live="polite"` is read.
4. `.ring-label` `role="status" aria-live="polite"` is read ("Simulated ring: rising pulse").

Fixes:

- **Slider:** add `aria-valuetext={point.readout}`. The screen reader then reads meaningful values
  natively as part of adjusting.
- **Remove `role="status"`/`aria-live`** from `.point-readout`. It duplicates both the slider's value
  text and app speech.
- **Remove `aria-live`** from `.ring-label`. Keep the visible "Simulated ring: …" text, which
  satisfies team-plan §6/§7. Add one static visually-hidden sentence near the ring: "Ring panel is a
  visual simulation; no ring hardware is connected." Team-plan §6 says the simulator is "a visual
  explanation for judges, not a replacement for nonvisual access", so it shouldn't announce on every
  step.
- **App voice toggle:** a button with `aria-pressed`, default **on**, saved to `localStorage`.
  - `announce()` returns early when it is off.
  - We can't detect a screen reader, so screen-reader users switch app voice off once (the label says
    so: "App voice (turn off if using VoiceOver/TalkBack)").
  - This also covers the team-plan §6 pause requirement for exploration speech. A general
    pause/replay control is still owed separately (`voice-over-status.md` §4).

### 2.5 `RingSimulator.tsx` changes

- **Pulse doesn't replay on repeated directions (bug).** `.ring-pulse--rising` only animates when the
  class *changes*, so two rising steps in a row show one pulse. Add `key={pulseKey}` on the pulse
  element so every move remounts it. This matters most on iOS, where the pulse is the *only* stand-in
  for haptics.
- **Start and end sit on the same spot (bug).** `dotAngle = progress * 360` puts index 0 and the last
  index both at 12 o'clock. Change it to an open arc: `dotAngle = START + progress * 300`, with the
  60° gap at the bottom marking start and end.
- New prop `notableFractions: number[]` from `interestPoints[].xFraction`, drawn as ticks on the arc.
- Wrap the ring's visual parts in `aria-hidden="true"`. The static SR note from 2.4 is the only
  accessible content.
- Keep `progress` from `incomingSegment.endFraction` and `angle` from `trace`. The physics stays
  as is.

---

## 3. Surfacing `interestPoints`

**Use buttons, not gestures.** "Previous notable" and "Next notable" are two native `<button>`s placed
right after the slider in reading order. Buttons are reachable by VO/TalkBack swipe navigation and by
keyboard. A custom swipe gesture would bring back the §1 conflict. Web pages can't add custom VO rotor
items, so buttons are the only reliable mechanism.

- Next: the first `interestPoints[k].index > pointIndex`. Prev: the last one `< pointIndex`. Choose
  based on the current index, so it still works after slider or pad moves.
- Speak `interestPoint.explain` (already capped at 6 stops, with friendly wording, by
  `Reasoner.interest_points`). Don't write sentences in the frontend.
- **Boundary:** don't wrap, because a jump from the last point to the first is disorienting. Use
  `aria-disabled="true"` (not `disabled`, which drops focus under VO and TalkBack), and when pressed,
  speak "No more notable points after {x}." Focus stays on the button.
- Series switch: the notable list follows the active series, and `pointIndex` carries over.
- Pad and ring: ticks at notable columns, plus the distinct "notable" haptic when a drag crosses one
  (Person 3 pattern). The pad does **not** snap to notable points, because snapping makes it
  impossible to reach the points next to them.
- Slider: no change. Notable points are reachable through the buttons.

---

## 4. Data flow and backend contract

**No backend changes needed.** Everything comes from the `ReasoningResponse` that is already wired
(`App.tsx` → `reasonGraph` → `Exploration`):

| UI need | Field |
| --- | --- |
| Pad sparklines | `series[].points[].normalised` |
| Column readout / explain | `points[].readout`, `points[].explain` |
| Ring position + slope pulse | `trace[].endFraction`, `trace[].angle`, `direction` |
| Notable buttons, ticks | `interestPoints[].index`, `.xFraction`, `.explain` |
| Row names | `series[].name` |

Optional, not recommended now: `ReasonRequest.chartAspect` (default 0.6) sets the slope angles to
match the *photographed* chart. Don't send the pad's aspect ratio. The ring's job is to match what a
sighted person saw on the original graph, not on our pad.

---

## 5. Accessibility test plan (specific to the gesture-conflict risk)

Run on the **actual demo device**. Put an on-screen debug counter in the pad for Phase 0 only,
showing the count of pointer events received and the last `goTo` source. That makes "inert under
screen reader" observable instead of assumed.

### 5.1 iOS VoiceOver (Safari)

| # | Action | Pass criterion |
| --- | --- | --- |
| V1 | Touch-explore (drag one finger) across the pad | Pointer counter stays **0**. Cursor doesn't move. VO reads nothing for the pad area |
| V2 | Double-tap-and-hold on the pad, then drag | Cursor scrubs (passthrough). This is a bonus: if it fails, note it, it isn't a blocker |
| V3 | Swipe to the slider | VO reads the label, `aria-valuetext` (readout, not "3"), and "adjustable" |
| V4 | Swipe up/down on the slider across the whole series | **Exactly one point per swipe.** First and last reachable. (Older WebKit sometimes stepped by a percentage of the range instead of `step`. If points are skipped, see Phase 0 fallback) |
| V5 | Same as V4 with App voice **on**, then **off** | On: VO and app voice overlap (expected, and the toggle label says so). Off: exactly one utterance per step |
| V6 | Series button, double-tap | Announces the pressed state. Index stays the same. The next slider adjust reads the new series at the same x |
| V7 | Next/Prev notable, repeatedly to the boundary | Focus stays on the button. `explain` is spoken. At the boundary "No more notable points…" is spoken, and the button is announced dimmed/unavailable but still focused |
| V8 | Swipe through the whole screen in order | Order: title → series → ring SR note → slider → notable prev/next → voice toggle → back. The pad never appears |
| V9 | Repeat V3–V7 with Screen Curtain on (triple-tap with three fingers) | The full journey works with no screen |

### 5.2 Android TalkBack (Chrome)

| # | Action | Pass criterion |
| --- | --- | --- |
| T1 | Explore-by-touch across the pad | Pointer counter stays 0 |
| T2 | Adjust the slider (volume keys, and the device's TalkBack slider gesture) | One step per action. `aria-valuetext` is read |
| T3 | **Double-tap while the slider is focused** | Check the value does **not** jump to the middle. TalkBack activates by sending a click at the centre of the element, which can set a range input to 50%. If it jumps, record it and make sure the notable buttons plus V4-style fallback stay usable |
| T4 | Step through with `navigator.vibrate` | Our pattern is felt, and can be told apart from TalkBack's own focus-change vibration (if not, ask Person 3 to lengthen or strengthen the patterns) |
| T5 | V6, V7, V8 equivalents | Same criteria |

### 5.3 Self-voicing mode (no screen reader, eyes closed)

| # | Action | Pass criterion |
| --- | --- | --- |
| S1 | Find the pad start by sliding a thumb in from the bezel | Starting at the inset edge does **not** trigger browser or OS back navigation |
| S2 | Drag slowly across a row | One haptic plus one readout per column. No speech backlog after lifting |
| S3 | Drag diagonally across rows | Row stays locked to where the finger went down |
| S4 | Lift, then touch the other row at the same x | Same column, new series (§7.3-B) |
| S5 | Drag vertically on the pad | No page scroll, no pull-to-refresh, no zoom |
| S6 | iOS | Ring pulse visibly replays on *every* step, including repeated same-direction steps |

Also run axe (or `/a11y-check`) and confirm there are no `aria-hidden-focus` violations and the slider
has an accessible name.

---

## 6. Phased build plan (riskiest first)

**Phase 0: device spike (~45 min). Go/no-go on the interaction model.**
This is the only phase that can invalidate the plan, so it goes first.

1. **Decide the demo device** (iPhone vs Android). The decision changes:
   - T3/T4 relevance.
   - Whether the ring pulse is the only haptic story (iOS).
   - Whether to try the optional iOS haptic hack in Phase 4.
2. Throwaway changes to the current build:
   - Add `aria-valuetext` to the slider.
   - Add a bare `aria-hidden` div with `touch-action: none` and pointer handlers that call
     `setPointIndex` and increment an on-screen counter.
3. Run V1, V3, V4 (or T1–T3) plus S1 and S5.
4. **Go** if the pad is inert under the screen reader and the slider steps one point at a time.
   **Fallback** if V4 or T2/T3 fail: add plain "Previous point / Next point" buttons next to the
   slider. Buttons always work, so the plan survives. **Stop and rethink** only if V1/T1 fails (the
   page gets touches under a screen reader). That is not expected.

Output: a filled-in pass/fail table from §5, posted to the team.

**Phase 1: cursor and speech hygiene (~45 min).** Verify with V3, V5, V6, and T2.

- Add `useExploreCursor`, and move speech and vibration from `useEffect` into `goTo`.
- Apply the §2.4 fixes: `aria-valuetext`, remove the two live regions, add the App voice toggle.
- Ring: add the `pulseKey` remount and the open arc.

**Phase 2: GridPad (~60–90 min).** Verify with V1, V8, and S1–S5.

- Rows and sparklines, pointer capture, row lock, equal bins, edge insets, `touch-action`,
  `overscroll-behavior`, active marker.
- Wire through `goTo(…, 'pad-drag' | 'pad-tap')`.
- Remove the Phase 0 debug counter, or keep it behind `?debug`.

**Phase 3: notable points (~30 min).** Verify with V7 and T5.

- Prev/Next notable buttons with `aria-disabled` boundaries.
- Ticks on the pad and the ring.
- Notable-landing haptic (needs Person 3's pattern; use a placeholder `[20, 40, 20]` until then).

**Phase 4: polish (optional, timebox 30 min).**

- Ring visual spec (SVG).
- Check contrast in both themes.
- *Optional iOS experiment:* iOS 18 Safari fires a system haptic when an
  `<input type="checkbox" switch>` is toggled through its label inside a user gesture. It can serve as
  a tick on iPhone. It is a hack, may stop working in any iOS update, and **must not** be presented as
  real ring hardware. Skip it if short on time.

**Phase 5: full test pass + rehearsal (~30 min).**

- All of §5 on the demo device.
- Rehearse the 90-second demo (team-plan §10). Say out loud which parts are simulated.

---

## 7. Top risks

1. **Screen reader and app voice talking over each other.** It is unavoidable without detection. The
   App voice toggle mitigates it, but only if the demo operator remembers to set it. Put it in the
   demo checklist.
2. **Platform slider quirks (V4 step size, T3 double-tap to middle).** Verified in Phase 0. The
   fallback is buttons.
3. **Edge-swipe back navigation during pad drags.** It kills a live demo instantly. Mitigated by
   insets. Test S1 on the real device, because simulators don't reproduce it.

## 8. Handed back / dependencies

- **Person 3:** trend thresholds (`phone-demo-navigation.md` §5), a distinct "notable point"
  vibration pattern, and patterns that can be told apart from TalkBack's own focus haptics (T4).
- **Owner:** confirm the two assumptions at the top ("native" = web, "grid" = rectangular pad with the
  ring as feedback).
- **Not in scope here:** §7.3-A (returning after an explain-mode interruption). Because the cursor
  lives in `useExploreCursor` inside `Exploration`, Q&A shown *inside* Exploration keeps the position
  for free. If Q&A is a separate App state, lift the hook's state into `App.tsx`.
- **Deferred:** a combined multi-series readout (§7.2 option (a)), and a static `<table>` data view
  as an extra non-visual fallback.
