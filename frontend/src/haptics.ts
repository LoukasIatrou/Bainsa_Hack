// Phone vibration for the Explore page. The on-screen ring does the pointing; this only adds
// feel: a tick that speeds up as the finger nears the line, one short tick per data point
// crossed, and a triple tick on landing on the line.
// TODO: replace with Person 3's engine (createSpiderSenseBinding) once it imports cleanly
// under the frontend's strict tsconfig.

const NEAR_INTERVAL = 90 // ms between ticks right next to the target
const FAR_INTERVAL = 700 // ms between ticks far away
const FAR_DISTANCE = 300 // px at which ticks are slowest

export type HapticCue = 'point' | 'on-line' | 'arrived' | 'done'

const CUES: Record<HapticCue, number | number[]> = {
  point: 15,
  'on-line': [30, 50, 30, 50, 30],
  arrived: [120],
  done: [40],
}

function vibrate(pattern: number | number[]): void {
  // Not supported on iOS/desktop; the ring still works visually.
  navigator.vibrate?.(pattern)
}

export function hapticCue(cue: HapticCue): void {
  vibrate(CUES[cue])
}

export interface DistanceTicker {
  // Distance to the target in px, or null to stop ticking (on the line, finger lifted).
  setDistance(distance: number | null): void
  stop(): void
}

export function createDistanceTicker(): DistanceTicker {
  let distance: number | null = null
  let timer: number | null = null

  const schedule = () => {
    if (distance === null) {
      timer = null
      return
    }
    const t = Math.min(1, distance / FAR_DISTANCE)
    timer = window.setTimeout(() => {
      if (distance !== null) vibrate(10)
      schedule()
    }, NEAR_INTERVAL + t * (FAR_INTERVAL - NEAR_INTERVAL))
  }

  return {
    setDistance(d) {
      distance = d
      if (d !== null && timer === null) schedule()
    },
    stop() {
      distance = null
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      vibrate(0)
    },
  }
}
