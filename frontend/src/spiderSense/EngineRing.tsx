import { useEffect, useRef } from 'react'
import { tickWeights } from './logic'

// Nico's spider-sense ring, visual only: it no longer decides anything. The Explore page tells it
// where the finger is and which way the engine's guidance points; it draws the 32 ticks, the
// pulse (faster when closer) and colours by phase. Coordinates are SVG px (1 unit = 1 CSS px).

export type RingPhase = 'searching' | 'on-curve' | 'arrived'

interface EngineRingProps {
  x: number
  y: number
  radius: number
  // Pointing direction in screen radians (0 = right, +PI/2 = down), or null for an even ring.
  angle: number | null
  // Distance to whatever it points at, in px. Drives the pulse rate.
  distance: number | null
  phase: RingPhase
}

const TICK_COUNT = 32
const TICK_GAP = 4
const TICK_MIN = 3
const TICK_MAX = 22
const PULSE_NEAR_PERIOD = 0.35
const PULSE_FAR_PERIOD = 1.6
const PULSE_FAR_DISTANCE = 300

export function EngineRing({ x, y, radius, angle, distance, phase }: EngineRingProps) {
  const pulseRef = useRef<SVGCircleElement>(null)
  const live = useRef({ radius, distance })
  useEffect(() => {
    live.current = { radius, distance }
  }, [radius, distance])

  // Own phase accumulator so a rate change never makes the pulse jump.
  useEffect(() => {
    let frame = 0
    let p = 0
    let last = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (live.current.distance ?? PULSE_FAR_DISTANCE) / PULSE_FAR_DISTANCE)
      const period = PULSE_NEAR_PERIOD + t * (PULSE_FAR_PERIOD - PULSE_NEAR_PERIOD)
      const spread = 8 + t * 30
      p = (p + (now - last) / 1000 / period) % 1
      last = now
      const ring = pulseRef.current
      if (ring) {
        ring.setAttribute('r', String(live.current.radius + p * spread))
        ring.setAttribute('opacity', String(1 - p))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const weights = angle === null ? new Array<number>(TICK_COUNT).fill(0) : tickWeights(angle, TICK_COUNT)

  return (
    <g className={`engine-ring engine-ring--${phase}`} transform={`translate(${x} ${y})`} data-testid="ring">
      <circle ref={pulseRef} className="spider-sense__pulse" r={radius} />
      <circle className="spider-sense__circle" r={radius} />
      {weights.map((w, i) => {
        const a = (i / TICK_COUNT) * 2 * Math.PI
        const r0 = radius + TICK_GAP
        const r1 = r0 + TICK_MIN + w * (TICK_MAX - TICK_MIN)
        return (
          <line
            key={i}
            className="spider-sense__tick"
            x1={Math.cos(a) * r0}
            y1={Math.sin(a) * r0}
            x2={Math.cos(a) * r1}
            y2={Math.sin(a) * r1}
            opacity={0.35 + 0.65 * w}
          />
        )
      })}
      <circle className="spider-sense__finger" r={4} />
    </g>
  )
}
