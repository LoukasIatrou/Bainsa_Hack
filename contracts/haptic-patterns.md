# Haptic patterns

Owner: Person 3 (audio and haptic systems). Consumed by Person 4's visual
simulator.

The team brief names five pulse patterns but assigns no meaning or timing to
them, and asks Persons 3 and 4 to agree the mapping once and use it
consistently in both the ring behaviour and the simulator. This file is that
agreement. The same table is the single source of truth in code, exported as
`HAPTIC_PATTERNS` from `@bainsa/audio-haptics`, so the simulator and the motor
cannot drift apart.

## The five patterns

Timings use the `navigator.vibrate()` convention: **even indices are vibration
durations in milliseconds, odd indices are the silent gaps between them.**

| Pattern   | Timings (ms)        | Total | Ramp | Meaning |
| --------- | ------------------- | ----- | ---- | ------- |
| `short`   | `60`                | 60    | none | Focus moved to a point; its value was read. |
| `double`  | `50, 60, 50`        | 160   | none | Local extremum reached — a peak or a trough. |
| `long`    | `300`               | 300   | none | Boundary: start or end of series, cannot move further. Also fired on an unreadable point. |
| `rising`  | `40, 40, 60, 40, 90`| 270   | up   | Value increased from the previous readable point. |
| `falling` | `90, 40, 60, 40, 40`| 270   | down | Value decreased from the previous readable point. |

`ramp` tells the simulator how to render intensity across the pattern: `up`
grows each pulse, `down` shrinks it, `none` keeps them equal. On the phone the
ramp is carried by the pulse durations themselves, which is the only intensity
control `navigator.vibrate` offers.

## Two modes, one vocabulary

The same five patterns serve both interaction modes, so the user only ever
learns one vocabulary.

### Guidance mode (Explore page, finger on the chart)

The user drags a finger over the graph and is steered onto the curve, then
along it.

| Situation | Pattern |
| --------- | ------- |
| Curve is above the finger — move up | `rising` |
| Curve is below the finger — move down | `falling` |
| Finger is on the curve (arrival) | `double` |
| Following the curve, crossing into a new x position | `short` |
| Finger has left the chart area | `long` |

The direction pulse **repeats, and speeds up as the finger closes in** — about
every 700 ms when far away, down to about 140 ms when nearly there. Proximity is
the feedback; the pattern itself does not change.

Coordinates are normalised **data** space: `y` = 0 at the graph minimum and 1 at
the maximum, so y increases *upward*. A DOM `clientY` grows downward, so it must
be flipped first — `fromPointerEvent()` does this. Getting it wrong inverts every
direction cue, which is the one bug in this area that will not be obvious from
reading the code.

Within 6% of the value range counts as "on the curve". Over a stretch where the
value could not be read, no direction is given at all rather than a guessed one.

### Exploration mode (arrow keys / buttons)

## When each one fires during exploration

Per move, the engine picks exactly one pattern, in this order:

1. Value is `null` (unreadable) → `long`
2. Already at the first or last point and moving further → `long`
3. Point is a local extremum → `double`
4. Value rose from the previous readable point → `rising`
5. Value fell → `falling`
6. Otherwise (flat, or no previous point) → `short`

`jumpToMax` and `jumpToMin` always fire `double`.

Note that in a monotonic series the first and last points are genuine local
extrema, so they correctly fire `double` rather than `rising`/`falling`.

## Channels

A pattern is played on every available channel at once, and the engine emits one
`haptic:pattern` event naming which ones actually fired:

| Channel         | What it is                                   | Available when |
| --------------- | -------------------------------------------- | -------------- |
| `vibration`     | `navigator.vibrate()` on the phone            | API present and a user has interacted with the page |
| `simulator`     | The `haptic:pattern` event for Person 4's UI  | Always |
| `audio-tactile` | A 60–100 Hz buzz through Web Audio            | Web Audio available and audio unlocked |

**Honesty caveat for the status label.** `navigator.vibrate` exists in desktop
Chrome and silently does nothing, and the API offers no way to tell a real motor
from a no-op. `engine.haptics.vibrationRequested` therefore means "we asked",
not "the user felt it". Label the demo accordingly — the brief forbids
presenting a simulation as live hardware.

There is no physical ring in this build. The transport layer is pluggable, so a
BLE ring could be added later as a fourth channel without changing any caller.
