# Research: mapping the simulated ring to real haptic ring hardware

Goal: replace `RingSimulator.tsx` (a labelled on-screen stand-in) with a real
multi-actuator ring, without changing the backend contract. This covers what
hardware exists today and how our existing `TraceSegment` data
(`angle`, `strength`, `direction`) would drive it.

## Landscape

**True multi-actuator *directional* rings are a research topic, not yet a
shipping consumer category.** Commercial smart rings (RingConn Gen 3, Dreame's
CES 2026 haptic ring, Samsung, COLMI) ship with a single vibration motor for
notification buzzes only — no spatial/directional array. The directional
multi-actuator work exists at the research-prototype / open-hardware level:

| Project | Form factor | Actuators | Control | Maturity |
|---|---|---|---|---|
| **Google VHP** ("audio-to-tactile", `github.com/google/audio-to-tactile`) | Bracelet / sleeve / phone-case reference designs, actuator layout is DIY via FPC connector | Up to 12 independent channels, arbitrary waveform | nRF52840 SoC — serial, USB, **BLE**; Arduino-compatible C/C++ firmware | Open-source hardware + firmware, actively released by Google Research. No GATT service spec published — would need a small BLE characteristic of our own on top of their firmware. |
| **tactoRing** (CHI 2017) | Ring | Multiple radial tactors around the band | Custom PCB / MCU | Academic prototype, well-cited precedent for ring-specific directional cueing |
| **Pose-Independent Soft Haptic Ring** (Kim et al., *Small Structures*, 2026) | Ring | Multichannel shape-memory-alloy actuators | Research driver board | Academic prototype; explicitly "joint-centered directional guidance" — closest published analogue to our use case |
| **HaRing** (CHI 2026) | Ring | 24-pin (4x6) pin array, custom PCB | Arduino Due + DRV8835 driver | Academic prototype, high spatial resolution but bulkier |
| Generic wristband directional-cueing study | Wristband | 12 ERM motors at 30° spacing | — | Not a product, but its finding is directly useful: **4-8 motors is the point of diminishing returns for reducing directional-cue error** — informs actuator count below |

**Most viable near-term path:** build on **Google's open-source VHP
(audio-to-tactile)** board. It's the only option here that is (a) actually
open hardware with released firmware, (b) BLE-native, and (c) supports enough
independent channels to place around a ring rather than a single buzzer. It
would need to be laid out on a ring/band PCB (following tactoRing's actuator
placement) rather than the bracelet reference design, and given a small custom
BLE GATT characteristic (VHP's firmware doesn't publish one) that a phone/glasses
companion app writes to.

## Proposed mapping: our schema -> ring actuators

Current phone PoC (`Exploration.tsx`, `RingSimulator.tsx`) has no real
actuator — it fakes direction with `navigator.vibrate()` pulse-pattern arrays
(rising = `[40,30,60,30,90]`, falling = reversed, flat = `[30]`) and draws a
position dot + a slope-angle pulse graphic. Nothing here needs to change on
the backend: `reasoning.py`'s `TraceSegment` already emits exactly the fields
a directional ring needs per segment:

- `angle` (-90..+90°, slope as drawn: 0 = flat, +90 = straight up, -90 = straight down)
- `strength` (0-1, magnitude of the move, already normalised to the value range)
- `direction` (up / down / flat / unknown)
- `endsAtTurningPoint` (bool)

Proposed hardware mapping, for an **N-actuator ring** (N=8, per the
4-8-motor finding above — enough angular resolution without over-driving a
tiny PCB):

1. **Angular placement.** Treat the ring's "3 o'clock" position (reference
   actuator 0) as *flat*, "12 o'clock" as *straight rise* (+90°), "6 o'clock"
   as *straight fall* (-90°) — i.e. actuators occupy the right-hand semicircle
   from 6 through 12 o'clock, matching the pitch deck's existing framing
   ("the side you should move toward vibrates strongest"). For a given
   segment, `actuator_angle = angle` maps directly onto that semicircle:
   `actuator_index = round((angle + 90) / 180 * (N_half - 1))`, where
   `N_half` is the actuators spanning that half (e.g. 5 of the 8 for -90..90
   in 45° steps).
2. **Sub-resolution blending.** Rather than snapping to one tactor (which the
   tactoRing/pin-array research flags as less accurate than exciting a
   neighbourhood of skin), drive the two nearest actuators with intensity
   split by angular distance — e.g. angle = 30° with 45° actuator spacing
   drives the 0° and 45° actuators at ~33%/67% relative weight.
3. **Intensity.** `strength` (already 0-1 from `reasoning.py`) maps linearly
   to PWM duty cycle, with a floor (~0.2) so weak moves stay perceptible —
   same floor concept the phone version gets implicitly from its shortest
   pulse duration (30ms).
4. **Turning points.** `endsAtTurningPoint=true` triggers a brief double-pulse
   across the two actuators nearest the turn's angle (distinct from the
   continuous sweep), replacing the phone version's separate peak/trough
   emphasis.
5. **Direction-only fallback.** If a real ring isn't available (demo mode),
   keep today's `navigator.vibrate()` patterns keyed off `direction` — no
   contract change, so the frontend degrades gracefully exactly as
   `docs/team-plan.md` §8 already specifies for hardware failure.

This means **zero backend changes** are required to move from the phone PoC
to real ring hardware: the existing `TraceSegment.angle/strength/direction`
already is the actuator-command source; only a new BLE-writing layer in the
frontend (or a small companion firmware bridge) is needed to translate it.

## Sources

- [HaRing: A Haptic Ring Interface for One-Handed Interaction with High-Dimensional Spatial Information (CHI 2026)](https://doi.org/10.1145/3772318.3791663)
- [Pose-Independent Soft Haptic Ring for Joint-Centered Directional Guidance via Multichannel Shape Memory Alloy Actuators (Small Structures, 2026)](https://onlinelibrary.wiley.com/doi/10.1002/sstr.202600017)
- [tactoRing (CHI 2017)](https://dl.acm.org/doi/10.1145/3025453.3025703)
- [Google Research: An Open Source Vibrotactile Haptics Platform for On-Body Applications](https://research.google/blog/an-open-source-vibrotactile-haptics-platform-for-on-body-applications/)
- [google/audio-to-tactile on GitHub](https://github.com/google/audio-to-tactile)
- [Wearable Haptic Bands (Hackster.io)](https://www.hackster.io/IdeaZero/wearable-haptic-bands-12ea4c)
- [Comparing Vibrotactile and Skin-Stretch Haptic Feedback for Conveying Spatial Information to Blind VR Users (arXiv 2408.06550)](https://arxiv.org/pdf/2408.06550)
