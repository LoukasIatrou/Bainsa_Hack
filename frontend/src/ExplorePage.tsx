import { useEffect, useMemo, useRef, useState } from 'react'
import { engine } from './engine'
import type { EngineStatus, GuidanceReading, HapticPatternName } from './engine'
import { curveAt, monotonePath, monotoneTangents } from './engine/curve'
import type { PlotBox } from './engine/curve'
import { normalisedSeries, pointCount, valueRange } from './engine/graphUtils'
import { EngineRing } from './spiderSense/EngineRing'
import type { RingPhase } from './spiderSense/EngineRing'
import './spiderSense/spiderSense.css'
import type { FieldConfidence, GraphData, ReasoningResponse } from './types'

// Live = camera photo, Controlled = uploaded image, Saved = bundled demo graph.
export type GraphSource = 'live' | 'controlled' | 'saved'

interface ExplorePageProps {
  graph: GraphData
  fieldConfidence: FieldConfidence | null
  // Already known (saved graph), or null to fetch via `fetchReasoning`.
  reasoning: ReasoningResponse | null
  // Person 2's /reason, called once the plot is measured so chartAspect is the real one.
  fetchReasoning?: (chartAspect: number) => Promise<ReasoningResponse>
  source: GraphSource
  onReset: () => void
  onSliderMode: () => void
}

// Plot inner box padding inside the framed panel (room for the faint labels).
const PAD = { left: 38, right: 16, top: 14, bottom: 24 }
const SOURCE_LABEL: Record<GraphSource, string> = { live: 'Live', controlled: 'Controlled', saved: 'Saved' }

interface Finger {
  // Normalised data space: x 0..1 across the plot inner box, y 0..1 bottom to top.
  x: number
  y: number
}

function fmt(value: number | null | undefined, unit: string | null | undefined): string {
  if (value === null || value === undefined) return 'unreadable'
  return unit ? `${value} ${unit}` : String(value)
}

// The Explore screen: one framed graph panel, driven entirely by gestures. Every sound and
// vibration goes through `engine`; this component only draws and routes input.
export function ExplorePage({ graph, fieldConfidence, reasoning, fetchReasoning, source, onReset, onSliderMode }: ExplorePageProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [status, setStatus] = useState<EngineStatus>(() => engine.getStatus())
  const statusRef = useRef(status)
  const [seriesIndex, setSeriesIndex] = useState(0)
  const [finger, setFinger] = useState<Finger | null>(null)
  const fingerRef = useRef<Finger | null>(null)
  const [reading, setReading] = useState<GuidanceReading | null>(null)
  const [lastSpoken, setLastSpoken] = useState('')
  const [lastPattern, setLastPattern] = useState<HapticPatternName | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const started = useRef(false)
  const resumeFrom = useRef<number | null>(null)

  // --- engine wiring ------------------------------------------------------
  useEffect(() => {
    const off = engine.on((event) => {
      if (event.type === 'status:change') {
        statusRef.current = event.status
        setStatus(event.status)
      } else if (event.type === 'speech:caption') setLastSpoken(event.text)
      else if (event.type === 'haptic:pattern') setLastPattern(event.pattern)
    })
    return () => {
      off()
      engine.stopAll()
    }
  }, [])

  // --- measure the panel --------------------------------------------------
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      const w = Math.floor(r.width)
      const h = Math.floor(r.height)
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const box: PlotBox | null = useMemo(
    () =>
      size
        ? {
            left: PAD.left,
            top: PAD.top,
            width: Math.max(1, size.w - PAD.left - PAD.right),
            height: Math.max(1, size.h - PAD.top - PAD.bottom),
          }
        : null,
    [size],
  )
  const boxRef = useRef(box)
  useEffect(() => {
    boxRef.current = box
  }, [box])

  // --- load graph + reasoning into the engine, then speak the entry line --
  useEffect(() => {
    if (!box || started.current) return
    started.current = true
    engine.setGraph(graph, fieldConfidence)
    const hint =
      engine.getGraphKind() === 'continuous' ? 'Double-tap for an overview.' : 'Double-tap for an overview, hold to explain.'
    const intro = (notice: string) => {
      engine.speech.speak(`${notice}${graph.title}. ${hint}`, 'interrupt')
      setLoaded(true)
    }
    if (reasoning) {
      engine.setReasoning(reasoning)
      intro(source === 'saved' ? 'Saved graph. ' : '')
    } else if (fetchReasoning) {
      engine.speech.speak('Reading the graph.', 'interrupt')
      // chartAspect = drawn plot height / width, measured, so slope words match what is felt.
      fetchReasoning(box.height / box.width)
        .then((r) => {
          engine.setReasoning(r)
          intro('')
        })
        .catch(() => intro('Reasoning unavailable. '))
    } else {
      intro('Reasoning unavailable. ')
    }
  }, [box, graph, fieldConfidence, reasoning, fetchReasoning, source])

  // --- geometry -------------------------------------------------------------
  const n = pointCount(graph)
  const ys = useMemo(() => normalisedSeries(graph, seriesIndex), [graph, seriesIndex])
  const tangents = useMemo(() => monotoneTangents(ys), [ys])
  const path = useMemo(() => (box ? monotonePath(ys, box) : ''), [ys, box])
  const series = graph.series[seriesIndex]
  const range = valueRange(graph)

  const px = (x: number) => (box ? box.left + x * box.width : 0)
  const py = (y: number) => (box ? box.top + (1 - y) * box.height : 0)
  const xAt = (i: number) => (n > 1 ? i / (n - 1) : 0.5)

  // --- input -> engine.guide ---------------------------------------------
  // Stable across renders (refs only), so gesture/key listeners bind once.
  const input = useRef({
    guideAt(f: Finger | null) {
      fingerRef.current = f
      setFinger(f)
      setReading(f ? engine.guide(f.x, f.y) : null)
    },
    clientToFinger(clientX: number, clientY: number): Finger | null {
      const svg = panelRef.current?.querySelector('svg')
      const b = boxRef.current
      if (!svg || !b) return null
      const r = svg.getBoundingClientRect()
      // Padding-corrected: normalised against the inner plot box, not the whole panel.
      return { x: (clientX - r.left - b.left) / b.width, y: 1 - (clientY - r.top - b.top) / b.height }
    },
    overview() {
      resumeFrom.current = null
      engine.startOverview()
    },
    explain() {
      // Hold again after a Stop resumes the walk where it paused.
      engine.startExplainMode(resumeFrom.current ?? 0)
      resumeFrom.current = null
    },
    skip() {
      if (statusRef.current.explaining) engine.skipToNextExplanation()
      else {
        engine.speech.speak('Nothing to skip. Hold to explain.', 'interrupt')
        engine.playPattern('long')
      }
    },
    stop() {
      const step = statusRef.current.explainStep
      if (statusRef.current.explaining && step) resumeFrom.current = step - 1
      engine.stopExplainMode()
      engine.stopSpeaking()
    },
    switchSeries(delta: number) {
      const total = graph.series.length
      if (total < 2) {
        engine.speech.speak('This graph has only one line.', 'interrupt')
        engine.playPattern('long')
        return
      }
      const next = (engine.explore.currentSeries + delta + total) % total
      engine.explore.selectSeries(next)
      resumeFrom.current = null
      setSeriesIndex(next)
      engine.speech.speak(`Showing ${graph.series[next]?.name}, line ${next + 1} of ${total}.`, 'interrupt')
    },
  })

  // Pointer input. The finger drives guidance through the engine's own pointer entry points
  // (Person 3's engine.gestures + setPointerConverter), so when his engine is swapped in its
  // gesture layer takes over unchanged. The page only tracks the finger to draw the ring.
  // TODO(Haris): bind `input.current` commands (overview / explain / skip / stop / switchSeries)
  // once the gesture mapping is decided (spec mapping vs Person 3's menu mode).
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const c = input.current
    engine.setPointerConverter((cx, cy) => c.clientToFinger(cx, cy))
    let active: number | null = null
    const draw = (e: PointerEvent) => {
      const f = c.clientToFinger(e.clientX, e.clientY)
      fingerRef.current = f
      setFinger(f)
      setReading(f ? engine.guidance.read(f.x, f.y) : null)
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') el.setPointerCapture?.(e.pointerId)
      engine.gestures.pointerDown(e)
      if (active === null) {
        active = e.pointerId
        draw(e)
      }
    }
    const move = (e: PointerEvent) => {
      if (active === null && e.pointerType === 'mouse') {
        // Laptop: a hovering mouse explores like a finger.
        c.guideAt(c.clientToFinger(e.clientX, e.clientY))
        return
      }
      engine.gestures.pointerMove(e)
      if (e.pointerId === active) draw(e)
    }
    const up = (e: PointerEvent) => {
      engine.gestures.pointerUp(e)
      if (e.pointerId !== active) return
      active = null
      if (e.pointerType !== 'mouse') c.guideAt(null)
    }
    const cancel = (e: PointerEvent) => {
      engine.gestures.pointerCancel(e)
      if (e.pointerId === active) {
        active = null
        c.guideAt(null)
      }
    }
    const leave = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && active === null) c.guideAt(null)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    el.addEventListener('pointerleave', leave)
    return () => {
      engine.setPointerConverter(null)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      el.removeEventListener('pointerleave', leave)
    }
  }, [])

  // --- ring from guidance state -------------------------------------------
  const target = status.targetIndex
  const targetValue = target !== null ? (ys[target] ?? null) : null
  let ring: { x: number; y: number; angle: number | null; distance: number | null; phase: RingPhase } | null = null
  let contact: { x: number; y: number } | null = null
  let reached: number | null = null
  if (finger && box) {
    const fx = px(finger.x)
    const fy = py(finger.y)
    const r = reading
    let angle: number | null = null
    let distance: number | null = null
    let phase: RingPhase = 'searching'
    if (r?.state === 'on-curve' && r.curveY !== null) {
      phase = 'on-curve'
      contact = { x: fx, y: py(r.curveY) }
      if (Math.abs(finger.x - xAt(r.index)) * (n - 1) < 0.3 && ys[r.index] !== null) reached = r.index
      // Along the drawn spline, toward the target if there is one.
      const e = 0.002
      const a = curveAt(ys, tangents, finger.x - e)
      const b = curveAt(ys, tangents, finger.x + e)
      const tangent = a !== null && b !== null ? Math.atan2(-(b - a) * box.height, 2 * e * box.width) : 0
      if (target !== null) {
        if (r.index === target) {
          phase = 'arrived'
          distance = 0
        } else {
          angle = xAt(target) < finger.x ? tangent + Math.PI : tangent
          distance = Math.abs(xAt(target) - finger.x) * box.width
        }
      } else {
        angle = finger.x >= 0.995 ? null : tangent
        distance = 0
      }
    } else if (r?.state === 'off-chart') {
      angle = Math.atan2(py(0.5) - fy, px(0.5) - fx)
      distance = 300
    } else if (target !== null && targetValue !== null) {
      const tx = px(xAt(target))
      const ty = py(targetValue)
      angle = Math.atan2(ty - fy, tx - fx)
      distance = Math.hypot(tx - fx, ty - fy)
    } else if (r?.push === 'up' || r?.push === 'down') {
      angle = r.push === 'up' ? -Math.PI / 2 : Math.PI / 2
      distance = Math.abs(r.delta ?? 1) * box.height
    }
    ring = { x: fx, y: fy, angle, distance, phase }
  }
  const ringRadius = size ? Math.min(60, Math.max(40, size.h * 0.14)) : 50

  // --- status line ---------------------------------------------------------
  const where = !finger || !reading
    ? 'no touch'
    : reading.state === 'on-curve'
      ? 'on line'
      : reading.state === 'off-chart'
        ? 'off chart'
        : reading.curveY === null
          ? 'gap'
          : `searching ${reading.push}`
  const parts = ['simulated ring', where]
  if (reading && finger && reading.state !== 'off-chart') {
    parts.push(`${graph.xAxis.values[reading.index] ?? ''}: ${fmt(series?.values[reading.index], graph.yAxis.unit)}`)
  }
  if (status.explaining && status.explainStep) parts.push(`explaining ${status.explainStep} of ${n}`)
  else if (target !== null) parts.push(`target ${graph.xAxis.values[target] ?? target + 1}`)
  if (graph.series.length > 1) parts.push(`line ${seriesIndex + 1}/${graph.series.length}: ${series?.name}`)
  if (status.graphKind === 'continuous') parts.push('continuous')
  if (lastPattern) parts.push(`buzz ${lastPattern}`)

  const xs = graph.xAxis.values
  const labelIdx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])]

  return (
    <div className="explore" data-loaded={loaded ? 'true' : 'false'}>
      <header className="explore__top">
        <span className="explore__title">{graph.title}</span>
        <span className="explore__badge">{SOURCE_LABEL[source]}</span>
        <button
          type="button"
          className="explore__help-tab"
          aria-expanded={helpOpen}
          aria-label="Gesture help"
          onClick={() => setHelpOpen((o) => !o)}
        >
          ?
        </button>
      </header>

      <div className="explore__panel" ref={panelRef} role="application" aria-label={`Graph: ${graph.title}. Drag to explore.`}>
        {size && box && (
          <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
            <g className="explore__labels">
              {range && (
                <>
                  <text x={box.left - 6} y={box.top + 4} textAnchor="end">
                    {range.max}
                  </text>
                  <text x={box.left - 6} y={box.top + box.height} textAnchor="end">
                    {range.min}
                  </text>
                </>
              )}
              {labelIdx.map((i) => (
                <text
                  key={i}
                  x={px(xAt(i))}
                  y={box.top + box.height + 17}
                  textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                >
                  {xs[i]}
                </text>
              ))}
            </g>
            <path className="explore__curve" d={path} data-testid="curve" />
            {target !== null && targetValue !== null && (
              <circle
                className="explore__target"
                cx={px(xAt(target))}
                cy={py(targetValue)}
                r={7}
                data-testid="target"
                data-index={target}
              />
            )}
            {reached !== null && ys[reached] != null && (
              <circle className="explore__reached" cx={px(xAt(reached))} cy={py(ys[reached] as number)} r={6} />
            )}
            {contact && <circle className="spider-sense__contact" cx={contact.x} cy={contact.y} r={5} />}
            {ring && <EngineRing {...ring} radius={ringRadius} />}
          </svg>
        )}
      </div>

      <p className="explore__status" data-testid="status">
        {parts.join(' · ')}
      </p>
      <p className="explore__said" aria-live="polite" data-testid="said">
        {lastSpoken}
      </p>
      <p className="explore__hints">drag one finger: explore · the ring and vibration point to the line</p>

      {helpOpen && (
        <div className="explore__help" role="dialog" aria-label="Gestures">
          <ul>
            <li>Drag one finger: explore. The ring and vibration point you to the line.</li>
            <li>Double vibration: you reached the point. Long: edge, or a value that could not be read.</li>
          </ul>
          <p className="explore__help-links">
            <button type="button" onClick={onSliderMode}>
              Slider mode
            </button>
            <button type="button" onClick={onReset}>
              New photo
            </button>
          </p>
        </div>
      )}
    </div>
  )
}
