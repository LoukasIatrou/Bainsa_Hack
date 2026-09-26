# Prior art: haptic/audio graph accessibility for BLV users

Research pass to check what already exists before claiming novelty for the pitch deck. Honest
verdict, not a marketing summary.

## Closest prior art

**Directly on-point (LLM chart extraction + BLV exploration, no haptics):**
- **"Making Charts Speak: LLM-Based Conversational Chart Question Answering for Blind and
  Low-Vision Users"** (CHI '26 EA) and the related **GraphWhisper** system — LLM prompting
  extracts data directly from a chart image, then answers free-form questions for BLV users.
  94% QA accuracy across 185 questions, 15 BLV participants. This is the closest match to our
  extraction+reasoning half (vision model → structured chart understanding → spoken answers),
  but it is conversational/audio-only — no haptic layer, no directional ring, no deterministic
  turning-point/trace-segment model.
- **ChartFormer** (arXiv 2405.19117) — vision-language model converting chart images to tactile
  SVGs (for physical embossed/refreshable tactile displays, not wearable haptics).
- **Alt4Blind** (arXiv 2405.19111) — AI-assisted alt-text authoring for charts, not real-time
  exploration.

**Directly on-point (haptic shape exploration of graphs, no LLM/vision extraction):**
- **Slide-Tone and Tilt-Tone** (Fan et al., CHI '22, Stanford Shape Lab) — 1-DOF audio-haptic
  finger-slider devices that convey graph *shape* (slope/curvature) to BLV users via finger
  position and fingerpad tilt. Evaluated with 8 BLV participants. This is the closest match to
  our trace-segment "angle + strength" model and ring pulse concept, but the input is a
  purpose-built slider device with a physical track, not a wearable ring, and there's no
  upstream image-extraction pipeline — the graph data is pre-loaded, not photographed.
- **F2T** (IEEE Access, 2021) — 2-DOF force-feedback architecture for 2D data, same category
  (dedicated haptic hardware, not wearable, no vision pipeline).
- **ChartA11y** (ASSETS '24) — smartphone touchscreen + vibration motor, radius-based scanning
  as the finger moves over a rendered chart. Wearable-adjacent (uses the phone's own vibration
  motor, like our prototype) but requires touching a rendered chart on screen, not a
  ring-on-finger directional cue, and starts from structured data, not a photo.

**Adjacent (ring/finger-worn haptics, not chart-specific):**
- Smart-ring haptics is an active commercial/research space (RingConn Gen 3 vibration motor,
  piezo-actuator rings, an 18g three-axis force-sensing haptic ring in *Nature Electronics*
  2025, Apple's finger-angle haptic-band patent, a patented texture-based 4-direction ring).
  None of this is graph/chart-specific — it's general notification/navigation haptics.
- Broader BLV haptic-wearable literature (ACM TACCESS systematic review, 2025 navigation
  scoping review) confirms finger-worn haptics is an accepted, actively-studied modality for
  BLV users, and flags the real open problem: fingers are also the primary sensing organ for
  BLV users, so a haptic ring must not block normal tactile use of that finger.

## What is NOT already out there (as far as this pass could find)

No paper or product combines all of:
1. A vision-LLM forced-JSON extraction step from an arbitrary photographed chart (not
   pre-loaded structured data, not a purpose-built scanner),
2. a deterministic (non-LLM) reasoning layer that computes turning points, per-segment slope
   angle/strength, and four preset Q&A answers from that structured data, and
3. a wearable **ring** — as opposed to a slider, smartwatch, or handheld scanner — that encodes
   the segment's slope *direction and strength* as a positional + directional vibration pattern,
   paired with synchronized speech.

Slide-Tone/Tilt-Tone proves the "haptic slope cue" idea works with BLV users, and
GraphWhisper/Making-Charts-Speak proves the "vision-LLM extraction, then answer questions"
idea works. Nobody found in this pass has put both together with a finger-ring form factor and
a live camera-to-data pipeline.

## Bottom line (honest, not oversold)

**The individual pieces are not novel.** LLM-based chart extraction for BLV users exists and
already outperforms this prototype in evaluated accuracy (GraphWhisper: 94% QA accuracy, 15
participants; this project has zero formal user testing). Haptic slope-shape feedback for
graphs exists and has been validated with BLV users (Slide-Tone/Tilt-Tone). Finger-worn haptic
rings are a maturing commercial category.

**What's plausibly novel is the specific combination and form factor**: end-to-end
camera-photo → forced-JSON vision extraction → deterministic turning-point/slope reasoning →
directional ring-haptic + speech exploration, in a phone-only prototype designed to degrade
gracefully to a physical ring or Meta-glasses camera later. That integration, not any single
component, is the pitch-worthy claim — and it should be presented as "a novel integration of
validated pieces," not "we invented haptic graph accessibility."

## Sources

- Making Charts Speak / GraphWhisper — https://doi.org/10.1145/3772363.3799030
- ChartFormer — https://arxiv.org/pdf/2405.19117
- Alt4Blind — https://arxiv.org/pdf/2405.19111
- Slide-Tone and Tilt-Tone (CHI '22) — https://dl.acm.org/doi/10.1145/3491102.3517790
- ChartA11y (ASSETS '24) — https://dl.acm.org/doi/fullHtml/10.1145/3663548.3675611
- How Can Haptic Feedback Assist People with BLV: Systematic Literature Review (ACM TACCESS) —
  https://dl.acm.org/doi/10.1145/3711931
- Navigation Assistance Via Haptic Technology for BLV: Scoping Review —
  https://journals.sagepub.com/doi/10.1177/10711813251360706
- Computing Smart Rings: Systematic Literature Review — https://arxiv.org/pdf/2502.02459
- An 18-g haptic feedback ring with three-axis force-sensing skin (Nature Electronics) —
  https://www.nature.com/articles/s41928-025-01515-x
