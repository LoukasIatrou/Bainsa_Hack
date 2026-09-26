import { useEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { INITIAL_STATE, stepSpiderSense, tickWeights } from './logic'
import type { Curve, Point, SpiderSenseState } from './logic'
import './spiderSense.css'

interface SpiderSenseProps {
  curve: Curve
  width: number
  height: number
  // Circle radius in CSS px on screen, whatever the SVG is scaled to - it has to sit around a
  // fingertip, not shrink with the graph.
  radius?: number
  // A goal on the curve to guide the finger to (Overview start, next interest point).
  guideTo?: Point | null
  // Drawn under the curve (axes, labels), in the same viewBox units.
  children?: ReactNode
  // Fires on every state change. This is the hook for audio/haptics/buttons.
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
export function SpiderSense({ curve, width, height, radius: radiusPx = 60, guideTo = null, children, onStateChange }: SpiderSenseProps) {
  const [state, setState] = useState<SpiderSenseState>(INITIAL_STATE)
  const stateRef = useRef(state)
  const svgRef = useRef<SVGSVGElement>(null)
  // viewBox units per CSS px, so the ring stays the same physical size when the SVG scales.
  const [unitsPerPx, setUnitsPerPx] = useState(1)
  const radius = radiusPx * unitsPerPx
  const radiusRef = useRef(radius)
  const guideRef = useRef(guideTo)
  useEffect(() => {
    radiusRef.current = radius
    guideRef.current = guideTo
  }, [radius, guideTo])
  // Only the first finger drives the circle; a second touch (palm, other hand) is ignored.
  const activePointer = useRef<number | null>(null)
  const pulseRef = useRef<SVGCircleElement>(null)
  const onStateChangeRef = useRef(onStateChange)
  useEffect(() => {
    onStateChangeRef.current = onStateChange
  }, [onStateChange])

  function update(pointer: Point | null) {
    const next = stepSpiderSense(stateRef.current, pointer, curve, radiusRef.current, { guideTo: guideRef.current })
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

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = () => {
      const rect = svg.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        // preserveAspectRatio "meet": the tighter axis sets the scale.
        setUnitsPerPx(Math.max(width / rect.width, height / rect.height))
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [width, height])

  // A new goal re-aims the circle straight away if a finger is already down.
  useEffect(() => {
    const current = stateRef.current
    const next = stepSpiderSense(current, current.pointer, curve, radiusRef.current, { guideTo })
    stateRef.current = next
    setState(next)
    onStateChangeRef.current?.(next)
  }, [guideTo, curve])

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
        ring.setAttribute('r', String(radiusRef.current + phase * spread * unitsPerPx))
        ring.setAttribute('opacity', String(1 - phase))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [unitsPerPx])

  const curvePath = curve.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')

  const { pointer, angle, phase, lastContact, goalReached } = state
  // No direction (goal reached, end of line): even short ticks all round, so the ring stays visible.
  const weights = angle === null ? new Array<number>(TICK_COUNT).fill(0) : tickWeights(angle, TICK_COUNT)
  const u = unitsPerPx

  return (
    <svg
      ref={svgRef}
      className={`spider-sense spider-sense--${phase}${goalReached ? ' spider-sense--arrived' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      onPointerDown={(e) => {
        if (!e.isPrimary || (activePointer.current !== null && activePointer.current !== e.pointerId)) return
        activePointer.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        update(toSvgPoint(e))
      }}
      onPointerMove={(e) => {
        // A mouse hovers with no button down; let it drive the circle like the original harness.
        if (activePointer.current === null && e.pointerType === 'mouse' && e.isPrimary) {
          update(toSvgPoint(e))
          return
        }
        if (e.pointerId === activePointer.current) update(toSvgPoint(e))
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== activePointer.current) return
        activePointer.current = null
        // A mouse keeps hovering after release; a finger is gone.
        if (e.pointerType !== 'mouse') update(null)
      }}
      onPointerCancel={(e) => {
        if (e.pointerId !== activePointer.current) return
        activePointer.current = null
        update(null)
      }}
      onPointerLeave={(e) => {
        if (activePointer.current === null || e.pointerId === activePointer.current) {
          activePointer.current = null
          update(null)
        }
      }}
    >
      {children}
      <path className="spider-sense__curve" d={curvePath} />

      {guideTo && <circle className="spider-sense__goal" cx={guideTo.x} cy={guideTo.y} r={9 * u} />}

      {lastContact && <circle className="spider-sense__contact" cx={lastContact.x} cy={lastContact.y} r={5 * u} />}

      {pointer && (
        <g transform={`translate(${pointer.x} ${pointer.y})`}>
          <circle ref={pulseRef} className="spider-sense__pulse" r={radius} />
          <circle className="spider-sense__circle" r={radius} />
          {weights.map((w, i) => {
            const a = (i / TICK_COUNT) * 2 * Math.PI
            const r0 = radius + TICK_GAP * u
            const r1 = r0 + (TICK_MIN + w * (TICK_MAX - TICK_MIN)) * u
            return (
              <line
                key={i}
                className="spider-sense__tick"
                x1={Math.cos(a) * r0}
                y1={Math.sin(a) * r0}
                x2={Math.cos(a) * r1}
                y2={Math.sin(a) * r1}
                style={{ strokeWidth: 3 * u }}
                opacity={0.35 + 0.65 * w}
              />
            )
          })}
          <circle className="spider-sense__finger" r={4 * u} />
        </g>
      )}
    </svg>
  )
}
