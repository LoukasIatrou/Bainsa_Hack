# Person 2: Graph reasoning (`/reason`)

**Branch:** `person2-reasoning` · **Owner:** Haris (Person 2) · **Status:** ready for review, not merged

This page explains what Person 2 built, why it works the way it does, how it was tested, and what has to be checked before it is merged into `main`.

---

## 1. What `/reason` does

Person 1 turns a photo into numbers (`GraphData`). `/reason` turns those numbers into what the Explore page needs:

```
Photo → /extract (Person 1) → GraphData → /reason (Person 2) → Explore page (Person 3 engine + Person 4 UI)
```

It is **one call** that returns everything. After it, exploring the graph needs no network, and the response can be saved as-is for fallback mode.

| Explore page need | Field | Example (US unemployment demo graph) |
|---|---|---|
| Overview button (speech) | `overview.text`: one sentence about the shape and where the line ends, spoken after Person 3's axes line; unreadable values are named at the end | "It spikes to 8.1 percent in 2020, then falls back to 4 percent by 2024." |
| Next point button | `series[].interestPoints[]`: stops in left-to-right order, each with a position (`xFraction`, `normalised`). Only big landmarks, at most 6 | start → 2019 low → 2020 peak → 2023 lowest → end |
| Explain button (speech) | `points[].explain` for any point; `interestPoints[].explain` is the same text | "2020, 8.1 percent. The highest point, up 4.4 percentage points from 2019; after this it falls." |
| Per-point data (sound, haptics) | `series[].points[]`: `value`, `normalised` (0–1), `direction`, `changeStrength`, `isMax`, `isMin`, `isTurningPoint`, a brief `readout` (value and landmark only) and `explain` | "2020: 8.1, highest." |
| Ring direction (future 360° ring) | `series[].trace[]`: the slope `angle` of each stretch of the line (0 = flat, +90 = straight up) and its `strength` | 2019→2020: +78°, strength 0.98 |
| Uncertainty | `lowConfidence`, `caveats` | "The value for Q3 could not be read, so it is left out." |
| Preset answers (optional) | `answers.trend`, `max`, `changes`, `compare` | "Highest: 8.1 percent, in 2020." |

Full field reference: [`contracts/reasoning-response.schema.json`](../contracts/reasoning-response.schema.json) and the table in [`backend/README.md`](../backend/README.md).

**Try it:** run the backend and open `/reason/mock` (or `/api/reason/mock` through the frontend proxy).

**Fallback mode:** [`contracts/examples/reason-unemployment.json`](../contracts/examples/reason-unemployment.json) is the exact `/reason/mock` response for the demo graph. The frontend can load it when the backend is unreachable; a test fails if it ever goes out of date.

---

## 2. Key decisions and why

| Decision | Why |
|---|---|
| **Every number is computed in code, never by AI** | A blind user can't check a number by looking at the graph. Code is always right and always fast. |
| **Gemini is optional and only rewords** (`USE_LLM=1`, off by default) | If its wording adds a number that isn't in the facts, or it errors, or it takes over 3 seconds, the plain sentence is used. The demo never depends on the network. It reuses Person 1's Gemini key, so there is no second provider. |
| **Gemini's `summary` from extraction is ignored** | It is unverified model output; the overview is computed from the numbers instead. |
| **The ring is the main product; audio is brief** | Team direction: the overview is one sentence, answers are one sentence, readouts are "2020: 8.1, highest." The change from the previous point is only in `explain`, heard when the user asks. |
| **The overview doesn't repeat the axes** | Person 3's engine already speaks the type, title and axes (`describeAxes`) just before it. It does say where the line ends ("…then falls back to 4 percent by 2024"). |
| **Unreadable values stay `null`, never guessed** | They are skipped in the maths, named at the end of the overview ("2020 could not be read.", up to 3 labels then "and N more") and in a caveat, and Explain says "highest readable point". Numbers are spoken as "about …" when confidence is below 0.6 (the same threshold as extraction). |
| **"Flat" means a move under 2% of the value range** | Tiny wobbles don't count as rises or falls (point `direction`). Headline shapes need a turn covering at least 30% of the range. |
| **Only big landmarks are stops** | A peak or low counts (`isTurningPoint`, `interestPoints`, `changes`) only if both its legs move at least 10% of the value range; the least prominent failing turn is dropped and the rest re-checked. The series max and min always count. At most 6 stops per series, so the ring never stops on noise. |
| **Speech uses at most 1 decimal** when the value range is over 1 ("4.9", not "4.85"; 2 only for ranges of 1 or less) | Extra digits are hard to hear and add nothing the finger can feel. The raw `value`, `delta` and `normalised` fields keep full precision. |
| **Compare is kept but not shown** | The team decided comparison isn't needed; it costs nothing to keep in the response. |
| **Demo graph: US unemployment, 2016–2024** | A single line with a dramatic 2020 spike: very clear on the ring. |

---

## 3. What was done (commit history)

| Commit | What changed |
|---|---|
| `98506c9` | First `/reason`: overview, four preset answers, per-point data, optional Gemini rewording, contract schema, test graphs, tests |
| `95ccdcb` | Fixes found by edge-case testing: kept the data's own decimals (100 → 100.9 was read as "100 to 100"), "1 degree", title punctuation, grouped ties, a caveat for mismatched lengths, tolerant unit spelling (`Â°C`, `° C`, `degC`) |
| `7dff083` | Ring-first output for the Explore page: `trace` and `interestPoints` with Explain texts; brief audio; unemployment made the default demo |
| `92ba7df` | Optional `chartAspect` so ring angles match the drawn graph; README guide; removed dead code |
| `9289e8d` | The overview became one shape sentence so the axes aren't spoken twice (matches Person 3's engine) |
| `b2d371a` | Only big landmarks as turning points and stops (10% legs, max 6 stops); `explain` on every point with the change; overview says where the line ends and names unreadable values; at most 1 spoken decimal; saved fallback JSON |

### Demo graphs (`backend/fixtures/`)

| File | Source | Used for |
|---|---|---|
| `unemployment_us.json` | FRED `UNRATE`, annual average, 2016–2024: 4.9, 4.4, 3.9, 3.7, **8.1**, 5.4, 3.7, 3.6, 4.0 % | **Main demo** |
| `mobile_italy_japan.json` | World Bank `IT.CEL.SETS.P2`, mobile subscriptions per 100 people, 2011–2022 | Two-series test |
| `ok.json`, `low_confidence.json` | Person 1's fixtures | Monotonic and uncertainty tests |

The chart photographed in the demo should be **made from these exact numbers** (dots on the points, large labels, a y-axis unit), so extraction accuracy can be checked against known values.

---

## 4. How it was tested

| Check | Result |
|---|---|
| Automated tests (`cd backend && uv run pytest`) | ✅ 42 passed (incl. a wobble that adds no stops, a noisy series capped at 6 stops, no 2-decimal numbers in speech, 2020 unreadable, and the saved fallback JSON staying current) |
| 16 awkward inputs: missing values, a single point, all values missing, negative numbers, more values than x-labels, 3 series, ties, zig-zags, very large numbers, tiny wobbles | ✅ no crashes; every response matches the contract schema; about 6 ms per call |
| Lint (`ruff`) | ✅ clean |
| Real server, called through Person 4's frontend proxy (`/api/reason`) | ✅ works end to end |
| Merges cleanly with the current `main` | ✅ no conflicts |
| Person 3's branch reads these fields correctly | ✅ compatible (only fields were added, none removed) |

---

## 5. Checklist before merging

### Must do
- [ ] **Real photo end to end:** photograph the printed unemployment chart, then run `/extract` → `/reason`. Check that the extracted values match the table above and that the overview and Explain texts are still right. *(Not done yet: it needs Person 1's pipeline and a Gemini key.)*
- [ ] **Person 3 confirms the overview change:** their `startOverview()` speaks `describeAxes` and then `overview.text`; the axes should now be heard only once.
- [ ] **Person 3 accepts the short readouts:** `readout` no longer includes "up 5 from February" (brief audio); the change is now in `points[].explain`. Their code comment still expects the delta.
- [ ] **Person 3 checks the turning points:** `isTurningPoint` now marks only big landmarks (both legs at least 10% of the range), so small wobbles no longer get a 'peak' double-pulse or a Next-point stop. The demo stops are unchanged.
- [ ] **Run the tests after merging `main` in:** `cd backend && uv sync && uv run pytest`.
- [ ] **Test on the Android phone:** Overview → Next point → Explain → Stop, with the real `/reason` response (not the local fallback).

### Should do
- [ ] **Suggested for Person 3: use `interestPoints` for Next point and `points[].explain` for Explain.** Person 3 currently computes their own stops (from `isTurningPoint`) and sentences. Reading these two fields instead is about a 10-line change and makes the stops and wording match everywhere (including the 6-stop cap and "readable" wording when values are missing).
- [ ] **Person 4: fallback mode.** Load `contracts/examples/reason-unemployment.json` when `/reason` can't be reached.
- [ ] **Person 1: fix the fixture encoding.** `/extract/mock` reads fixture files without `encoding="utf-8"`, so on Windows "°C" arrives as "Â°C". (`/reason` already tolerates this; the fix is one line in `backend/app/main.py`: `read_text(encoding="utf-8")`.)
- [ ] **Spoken prompts → vibration cues:** the team decided "Explain available" and "Go to next point" should be vibrations, but Person 3's engine currently speaks them.
- [ ] **TalkBack check:** with Android's screen reader on, finger movement is captured by TalkBack and may not reach the page. Test it; the simplest demo option is TalkBack off, with the app speaking for itself.

### Optional
- [ ] **Gemini rewording:** set `USE_LLM=1` with a key and listen. Keep it only if it sounds clearly better; the plain text is demo-ready.
- [ ] **`chartAspect`:** if the frontend draws the graph, send its height ÷ width so `trace` angles match. This only matters if `trace` is used (a future 360° ring).
- [ ] **Overview style:** once the real confidence of photo extractions is known, choose between `OVERVIEW_STYLE=brief` and `uncertainty_first` (the latter puts "Values are approximate." first).

---

## 6. Known limitations

- **Evenly spaced x-axis assumed:** positions and angles treat each x-label as one equal step (fine for years, months and quarters).
- **Compare** uses the first two series only; it isn't shown in the UI.
- **Gemini rewording** covers the overview and the preset answers, not the Explain texts or readouts.
- **The thresholds are judgement calls:** 2% of the range for "flat", 10% for a landmark, 30% for the headline shape. They are relative to the range, so a graph that only wobbles (e.g. 100 to 100.9) still has landmarks. The series max and min are always landmarks, even when one leg is small (the 2023 low in the demo rises only 0.4 to 2024).
- **The 6-stop cap** applies to `interestPoints` only; on a very noisy series `isTurningPoint` and `changes` can still list more big turns than there are stops.
- **Explain changes** are measured from the previous readable point, so after a gap the change can span two steps ("up 1.7 percentage points from 2019").

---

## 7. How to run

```bash
cd backend
uv sync
cp .env.example .env        # add GEMINI_API_KEY for /extract; USE_LLM=0 by default
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
uv run pytest               # 42 tests
```

Then open `http://localhost:8000/reason/mock` (US unemployment) or `http://localhost:8000/docs`.
