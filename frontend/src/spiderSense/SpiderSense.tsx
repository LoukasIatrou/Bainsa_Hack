import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { INITIAL_STATE, stepSpiderSense, tickWeights } from './logic'
import type { Curve, Point, SpiderSenseState } from './logic'
import './spiderSense.css'

interface SpiderSenseProps {
  curve: Curve
  width: number
  height: number
  radius?: number
  // Fires on every state change. This is the hook for audio/haptics/buttons later.
  onStateChange?: (state: SpiderSenseState) => void
}

const TICK_COUNT = 32
const TICK_GAP = 4
const TICK_MIN = 3
const TICK_MAX = 22

// Pulse: closer to the target = faster and tighter ("warmer"). Values in px and seconds.
const PULSE_NEAR_PERIOD = 0.35
const PULSE_FAR_PERIOD = 1.6
const PULSE_FAR_DISTANCE = 300

function pulseParams(distance: number | null) {
  const t = Math.min(1, (distance ?? PULSE_FAR_DISTANCE) / PULSE_FAR_DISTANCE)
  return {
    period: PULSE_NEAR_PERIOD + t * (PULSE_FAR_PERIOD - PULSE_NEAR_PERIOD),
    spread: 8 + t * 30,
  }
}

// Remount (change `key`) to fully restart: clears lastContact, phase and pointer.
export function SpiderSense({ curve, width, height, radius = 46, onStateChange }: SpiderSenseProps) {
  const [state, setState] = useState<SpiderSenseState>(INITIAL_STATE)
  const stateRef = useRef(state)
  const svgRef = useRef<SVGSVGElement>(null)
  const pulseRef = useRef<SVGCircleElement>(null)
  const onStateChangeRef = useRef(onStateChange)
  useEffect(() => {
    onStateChangeRef.current = onStateChange
  }, [onStateChange])

  function update(pointer: Point | null) {
    const next = stepSpiderSense(stateRef.current, pointer, curve, radius)
    stateRef.current = next
    setState(next)
    onStateChangeRef.current?.(next)
  }

  function toSvgPoint(event: PointerEvent<SVGSVGElement>): Point {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    }
  }

  // The pulse runs on its own phase accumulator so changing the rate doesn't make the ring jump,
  // which a CSS animation-duration change would.
  useEffect(() => {
    let frame = 0
    let phase = 0
    let last = performance.now()
    const tick = (now: number) => {
      const { period, spread } = pulseParams(stateRef.current.distance)
      phase = (phase + (now - last) / 1000 / period) % 1
      last = now
      const ring = pulseRef.current
      if (ring) {
        ring.setAttribute('r', String(radius + phase * spread))
        ring.setAttribute('opacity', String(1 - phase))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [radius])

  const curvePath = curve.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')

  const { pointer, angle, phase, lastContact } = state
  const weights = angle === null ? null : tickWeights(angle, TICK_COUNT)

  return (
    <svg
      ref={svgRef}
      className={`spider-sense spider-sense--${phase}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        update(toSvgPoint(e))
      }}
      onPointerMove={(e) => update(toSvgPoint(e))}
      onPointerUp={(e) => {
        // A mouse keeps hovering after release; a finger is gone.
        if (e.pointerType !== 'mouse') update(null)
      }}
      onPointerCancel={() => update(null)}
      onPointerLeave={() => update(null)}
    >
      <path className="spider-sense__curve" d={curvePath} />

      {lastContact && <circle className="spider-sense__contact" cx={lastContact.x} cy={lastContact.y} r={5} />}

      {pointer && (
        <g transform={`translate(${pointer.x} ${pointer.y})`}>
          <circle ref={pulseRef} className="spider-sense__pulse" r={radius} />
          <circle className="spider-sense__circle" r={radius} />
          {weights?.map((w, i) => {
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
      )}
    </svg>
  )
}
