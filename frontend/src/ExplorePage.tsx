import { useEffect, useMemo, useRef, useState } from 'react'
import { engine, fromPointerEvent, normalise, pointCount, valueRange } from './engine'
import type { EngineStatus, GuidanceReading, HapticPatternName } from './engine'
import { linePath } from './engine/curve'
import { installMenu, installWalkGuard } from './engine/menu'
import type { PlotBox } from './engine/curve'
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
const MENU_HINTS = 'swipe → ↓ next · swipe ← ↑ previous · tap: choose · long press: repeat · 2-finger tap: graph'
const GRAPH_HINTS = 'drag: trace the line · tap: read point · long press: explain point · 2-finger tap: menu'

interface Finger {
  // Normalised data space: x 0..1 across the plot inner box, y 0..1 bottom to top.
  x: number
  y: number
}

function fmt(value: number | null | undefined, unit: string | null | undefined): string {
  if (value === null || value === undefined) return 'unreadable'
  return unit ? `${value} ${unit}` : String(value)
}

// The Explore screen: one framed graph panel, no buttons. Input goes to Person 3's engine
// (engine.gestures: menu mode / graph mode, two-finger tap toggles); every sound and buzz comes
// from the engine. This component only draws: the line, and the spider-sense ring from the
// engine's guidance reading and status.
export function ExplorePage({ graph, fieldConfidence, reasoning, fetchReasoning, source, onReset, onSliderMode }: ExplorePageProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [status, setStatus] = useState<EngineStatus>(() => engine.getStatus())
  const modeRef = useRef(status.mode)
  const [seriesIndex, setSeriesIndex] = useState(0)
  const [finger, setFinger] = useState<Finger | null>(null)
  const [reading, setReading] = useState<GuidanceReading | null>(null)
  const [lastSpoken, setLastSpoken] = useState('')
  const [lastPattern, setLastPattern] = useState<HapticPatternName | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const started = useRef(false)

  // --- engine events --------------------------------------------------------
  useEffect(() => {
    const off = engine.on((event) => {
      if (event.type === 'status:change') {
        modeRef.current = event.status.mode
        setStatus(event.status)
        setSeriesIndex(engine.explore.currentSeries)
        if (event.status.mode === 'menu') {
          setFinger(null)
          setReading(null)
        }
      } else if (event.type === 'speech:caption') setLastSpoken(event.text)
      else if (event.type === 'haptic:pattern') setLastPattern(event.pattern)
      else if (event.type === 'focus:change') setSeriesIndex(event.series)
    })
    const offGuard = installWalkGuard()
    return () => {
      off()
      offGuard()
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

  // --- load graph, then reasoning (order matters: setGraph clears reasoning) --
  useEffect(() => {
    if (!box || started.current) return
    started.current = true
    engine.setGraph(graph, fieldConfidence, { announce: false })
    installMenu()
    engine.setMode('menu')
    const intro = (notice: string) => {
      engine.speech.speak(
        `${notice}${graph.title}. Menu: swipe to move, tap to choose. Two-finger tap switches to the graph.`,
        'interrupt',
      )
      const first = engine.menu.current
      if (first) engine.speech.speak(`${first.label}. 1 of ${engine.menu.position.total}.`, 'normal')
      setLoaded(true)
    }
    // The frontend types follow contracts/reasoning-response.schema.json; Person 3's copy of that
    // type is narrower (no explain/trace/interestPoints). Same JSON, so cast at this one call.
    const toEngine = (r: ReasoningResponse) => r as unknown as Parameters<typeof engine.setReasoning>[0]
    if (reasoning) {
      engine.setReasoning(toEngine(reasoning))
      intro(source === 'saved' ? 'Saved graph. ' : '')
    } else if (fetchReasoning) {
      engine.speech.speak('Reading the graph.', 'interrupt')
      // chartAspect = drawn plot height / width, measured, so slope words match what is felt.
      fetchReasoning(box.height / box.width)
        .then((r) => {
          engine.setReasoning(toEngine(r))
          intro('')
        })
        .catch(() => intro('Reasoning unavailable. '))
    } else {
      intro('Reasoning unavailable. ')
    }
  }, [box, graph, fieldConfidence, reasoning, fetchReasoning, source])

  // --- pointer input -> engine.gestures --------------------------------------
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    // Padding-corrected: normalised against the inner plot element, y up.
    const toData = (clientX: number, clientY: number): Finger | null =>
      plotRef.current ? fromPointerEvent({ clientX, clientY }, plotRef.current) : null
    engine.setPointerConverter(toData)
    let active: number | null = null
    // Drawing only: the engine does the guidance itself from its drag gesture.
    const draw = (e: PointerEvent) => {
      if (modeRef.current !== 'graph') return
      const f = toData(e.clientX, e.clientY)
      setFinger(f)
      setReading(f ? engine.guidance.read(f.x, f.y) : null)
    }
    const down = (e: PointerEvent) => {
      el.setPointerCapture?.(e.pointerId)
      engine.gestures.pointerDown(e)
      if (active === null) {
        active = e.pointerId
        draw(e)
      } else {
        // A second finger is a command (two-finger tap), not tracing.
        setFinger(null)
      }
    }
    const move = (e: PointerEvent) => {
      engine.gestures.pointerMove(e)
      if (e.pointerId === active) draw(e)
    }
    const end = (e: PointerEvent, cancel: boolean) => {
      if (cancel) engine.gestures.pointerCancel(e)
      else engine.gestures.pointerUp(e)
      if (e.pointerId === active) {
        active = null
        setFinger(null)
        setReading(null)
      }
    }
    const up = (e: PointerEvent) => end(e, false)
    const cancel = (e: PointerEvent) => end(e, true)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    return () => {
      engine.setPointerConverter(null)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
    }
  }, [])

  // --- geometry -------------------------------------------------------------
  const n = pointCount(graph)
  const range = useMemo(() => valueRange(graph), [graph])
  const series = graph.series[seriesIndex]
  const ys = useMemo(
    () => (series && range ? series.values.map((v) => (v === null ? null : normalise(v, range.min, range.max))) : []),
    [series, range],
  )
  const path = useMemo(() => (box ? linePath(ys, box) : ''), [ys, box])
  const px = (x: number) => (box ? box.left + x * box.width : 0)
  const py = (y: number) => (box ? box.top + (1 - y) * box.height : 0)
  const xAt = (i: number) => (n > 1 ? i / (n - 1) : 0.5)

  // --- ring from the engine's guidance reading + target ---------------------
  const target = status.targetIndex
  const targetValue = target !== null ? (ys[target] ?? null) : null
  let ring: { x: number; y: number; angle: number | null; distance: number | null; phase: RingPhase } | null = null
  let contact: { x: number; y: number } | null = null
  let reached: number | null = null
  if (finger && box && reading) {
    const fx = px(finger.x)
    const fy = py(finger.y)
    let angle: number | null = null
    let distance: number | null = null
    let phase: RingPhase = 'searching'
    if (reading.state === 'on-curve' && reading.curveY !== null) {
      phase = 'on-curve'
      contact = { x: fx, y: py(reading.curveY) }
      if (Math.abs(finger.x - xAt(reading.index)) * (n - 1) < 0.3 && ys[reading.index] !== null) reached = reading.index
      // Along the segment under the finger, toward the target if there is one.
      const i = Math.min(n - 2, Math.max(0, Math.floor(finger.x * (n - 1))))
      const a = ys[i]
      const b = ys[i + 1]
      const tangent =
        a !== null && a !== undefined && b !== null && b !== undefined
          ? Math.atan2(-(b - a) * box.height, box.width / Math.max(1, n - 1))
          : 0
      if (target !== null && reading.index === target) {
        phase = 'arrived'
        distance = 0
      } else if (target !== null) {
        angle = xAt(target) < finger.x ? tangent + Math.PI : tangent
        distance = Math.abs(xAt(target) - finger.x) * box.width
      } else {
        angle = finger.x >= 0.995 ? null : tangent
        distance = 0
      }
    } else if (reading.state === 'off-chart') {
      angle = Math.atan2(py(0.5) - fy, px(0.5) - fx)
      distance = 300
    } else if (target !== null && targetValue !== null) {
      const tx = px(xAt(target))
      const ty = py(targetValue)
      angle = Math.atan2(ty - fy, tx - fx)
      distance = Math.hypot(tx - fx, ty - fy)
    } else if (reading.push !== 'none') {
      // Same direction the engine's rising / falling pulse is giving.
      angle = reading.push === 'up' ? -Math.PI / 2 : Math.PI / 2
      distance = Math.abs(reading.delta ?? 1) * box.height
    }
    ring = { x: fx, y: fy, angle, distance, phase }
  }
  const ringRadius = size ? Math.min(60, Math.max(40, size.h * 0.14)) : 50

  // --- status line ---------------------------------------------------------
  const parts = ['simulated ring']
  if (status.mode === 'menu') {
    parts.push(`menu: ${status.menuItem ?? '-'} (${status.menuPosition.index + 1}/${status.menuPosition.total})`)
  } else {
    parts.push('graph')
    if (reading && finger) {
      parts.push(
        reading.state === 'on-curve'
          ? 'on line'
          : reading.state === 'off-chart'
            ? 'off chart'
            : reading.curveY === null
              ? 'gap'
              : `searching ${reading.push}`,
      )
      if (reading.state !== 'off-chart') {
        parts.push(`${graph.xAxis.values[reading.index] ?? ''}: ${fmt(series?.values[reading.index], graph.yAxis.unit)}`)
      }
    } else parts.push('no touch')
  }
  if (status.explaining && status.explainStep) parts.push(`explaining ${status.explainStep} of ${n}`)
  else if (target !== null) parts.push(`target ${graph.xAxis.values[target] ?? target + 1}`)
  if (graph.series.length > 1) parts.push(`line ${seriesIndex + 1}/${graph.series.length}: ${series?.name}`)
  if (status.graphKind === 'continuous') parts.push('continuous')
  if (lastPattern) parts.push(`buzz ${lastPattern}`)

  const xs = graph.xAxis.values
  const labelIdx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])]

  return (
    <div className="explore" data-loaded={loaded ? 'true' : 'false'} data-mode={status.mode}>
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

      <div className="explore__panel" ref={panelRef} role="application" aria-label={`Graph: ${graph.title}`}>
        {box && (
          <div
            className="explore__plot"
            ref={plotRef}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            data-testid="plot"
          />
        )}
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
      <p className="explore__hints">{status.mode === 'menu' ? MENU_HINTS : GRAPH_HINTS}</p>

      {helpOpen && (
        <div className="explore__help" role="dialog" aria-label="Gestures">
          <p className="explore__help-head">Two modes; a two-finger tap switches between them.</p>
          <ul>
            <li>
              <b>Menu</b>: swipe right or down for the next action, left or up for the previous one; tap to choose;
              long press repeats it. Actions: Overview, Explain each point, Explore freely, Repeat, Switch series
              (several lines only), Stop speaking.
            </li>
            <li>
              <b>Graph</b>: drag one finger to trace; the ring and buzz point you to the line. Tap re-reads the point,
              long press explains it.
            </li>
            <li>Buzz: rising / falling = move up / down, double = on the point, long = edge or unreadable.</li>
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
