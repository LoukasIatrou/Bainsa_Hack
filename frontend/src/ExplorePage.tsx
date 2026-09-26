import { useEffect, useMemo, useRef, useState } from 'react'
import { engine, fromPointerEvent, normalise, pointCount, valueRange } from './engine'
import type { EngineStatus, GuidanceReading, HapticPatternName } from './engine'
import { installMenu, installWalkGuard, runAsk, runOverview, runStop } from './engine/menu'
import type { PlotBox } from './engine/curve'
import { runsCurve, runsPath, smoothRuns } from './engine/smooth'
import { EngineRing } from './spiderSense/EngineRing'
import { INITIAL_STATE, stepSpiderSense } from './spiderSense/logic'
import type { Curve, Point, SpiderSenseState } from './spiderSense/logic'
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
// Top/bottom room so the ring isn't cut off at the highest and lowest points.
const PAD = { left: 38, right: 24, top: 36, bottom: 34 }
// Honest labels (Person 3's runbook): say whether this is a live photo or the known graph.
const SOURCE_LABEL: Record<GraphSource, string> = { live: 'live capture', controlled: 'uploaded image', saved: 'cached extraction' }
const MENU_HINTS = 'swipe → ↓ next · swipe ← ↑ previous · tap: choose · long press: repeat · 2-finger tap: graph'
const GRAPH_HINTS = 'move / drag: follow the ring from the start · tap: read point · long press: explain point · 2-finger tap: menu'

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
  const [lastMeaning, setLastMeaning] = useState('')
  const [hasReasoning, setHasReasoning] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // The ring follows the pointer (mouse hover or finger) and always shows the way along the line.
  // Tagged with the curve it was computed on: a new curve (resize, series switch) starts over.
  const [senseState, setSenseState] = useState<{ curve: Curve | null; s: SpiderSenseState }>({
    curve: null,
    s: INITIAL_STATE,
  })
  const senseRef = useRef(senseState)
  const pointerRef = useRef<Point | null>(null)
  const stepRef = useRef<(p: Point | null) => void>(() => {})
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
      else if (event.type === 'haptic:pattern') {
        setLastPattern(event.pattern)
        setLastMeaning(event.meaning)
      }
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
      // Straight into the graph: the ring points to the start of the line, then along it.
      engine.setMode('graph')
      engine.speech.speak(
        `${notice}${graph.title}. Follow the ring to the start of the line. Two-finger tap opens the menu.`,
        'interrupt',
      )
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
          setHasReasoning(true)
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
      const r = el.getBoundingClientRect()
      stepRef.current({ x: e.clientX - r.left, y: e.clientY - r.top })
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
      // A mouse is the simulated ring: it steers on hover too, no button needed. Like Person 3's
      // demo page, hover also feeds engine.guide so the buzz and readouts follow the mouse.
      if (e.pointerId === active) draw(e)
      else if (active === null && e.pointerType === 'mouse') {
        draw(e)
        const f = toData(e.clientX, e.clientY)
        if (f && modeRef.current === 'graph') engine.guide(f.x, f.y)
      }
    }
    const end = (e: PointerEvent, cancel: boolean) => {
      if (cancel) engine.gestures.pointerCancel(e)
      else engine.gestures.pointerUp(e)
      if (e.pointerId === active) {
        active = null
        // Lifting keeps the ring where it was, so it is always visible.
        if (e.pointerType !== 'mouse') {
          setFinger(null)
          setReading(null)
        }
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
  const runs = useMemo(() => (box ? smoothRuns(ys, box) : []), [ys, box])
  const path = useMemo(() => runsPath(runs), [runs])
  const curve = useMemo(() => (runs.length ? runsCurve(runs) : null), [runs])
  const px = (x: number) => (box ? box.left + x * box.width : 0)
  const py = (y: number) => (box ? box.top + (1 - y) * box.height : 0)
  const xAt = (i: number) => (n > 1 ? i / (n - 1) : 0.5)

  // --- ring: Nico's spider-sense logic on the smooth line ---------------------
  // Before the line is picked up it points to the START; on the line it points ALONG it toward
  // the end (or toward the engine's Explain target); off the line it points back to where the
  // finger left. Speech and buzz still come from Person 3's engine.
  const target = status.targetIndex
  const targetValue = target !== null ? (ys[target] ?? null) : null
  const startPoint = runs.length ? runs[0][0] : null
  const lastRun = runs.length ? runs[runs.length - 1] : null
  const endPoint = lastRun ? lastRun[lastRun.length - 1] : null
  const goal: Point | null = target !== null && targetValue !== null ? { x: px(xAt(target)), y: py(targetValue) } : endPoint
  const ringRadius = size ? Math.min(60, Math.max(40, size.h * 0.14)) : 50

  // Rebuilt each render (after commit) so pointer events always step with the current curve/goal.
  useEffect(() => {
    stepRef.current = (p: Point | null) => {
      pointerRef.current = p
      if (!curve) return
      const prev = senseRef.current.curve === curve ? senseRef.current.s : INITIAL_STATE
      const next = stepSpiderSense(prev, p, curve, ringRadius, { guideTo: goal, startAt: startPoint })
      if (next.goalReached && !prev.goalReached && target === null) {
        engine.speech.speak('End of graph.', 'interrupt')
      }
      senseRef.current = { curve, s: next }
      setSenseState(senseRef.current)
    }
  })

  const sense = senseState.curve === curve ? senseState.s : INITIAL_STATE

  const contact = sense.lastContact
  const reached = sense.goalReached && target !== null ? target : null
  const ring =
    sense.pointer && box
      ? {
          x: sense.pointer.x,
          y: sense.pointer.y,
          angle: sense.angle,
          distance: sense.distance,
          phase: (sense.goalReached ? 'arrived' : sense.phase) as 'searching' | 'on-curve' | 'arrived',
        }
      : null

  // --- status line ---------------------------------------------------------
  const parts = ['simulated ring']
  if (status.mode === 'menu') {
    parts.push(`menu: ${status.menuItem ?? '-'} (${status.menuPosition.index + 1}/${status.menuPosition.total})`)
  } else {
    parts.push('graph')
    parts.push(
      sense.pointer === null
        ? 'move to start'
        : sense.goalReached
          ? target === null ? 'end of graph' : 'on the point'
          : sense.phase === 'on-curve'
            ? 'on line, follow it'
            : sense.lastContact === null
              ? 'go to the start'
              : 'back to the line',
    )
    if (reading && finger) {
      if (reading.state !== 'off-chart') {
        parts.push(`${graph.xAxis.values[reading.index] ?? ''}: ${fmt(series?.values[reading.index], graph.yAxis.unit)}`)
      }
    } else parts.push('no touch')
  }
  if (status.explaining && status.explainStep) parts.push(`explaining ${status.explainStep} of ${n}`)
  else if (target !== null) parts.push(`target ${graph.xAxis.values[target] ?? target + 1}`)
  if (graph.series.length > 1) parts.push(`line ${seriesIndex + 1}/${graph.series.length}: ${series?.name}`)
  if (status.graphKind === 'continuous') parts.push('continuous')
  if (lastPattern) parts.push(`pulse ${lastPattern}: ${lastMeaning}`)

  // Saved graphs arrive with their reasoning; live ones get it from /reason.
  const canAsk = reasoning !== null || hasReasoning
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

      <div className="explore__body">
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
            {sense.lastContact === null && startPoint && (
              <circle className="explore__target" cx={startPoint.x} cy={startPoint.y} r={7} data-testid="start" />
            )}
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

      {/* The demo walkthrough's steps (docs/person3-demo.md). Gestures still work for a blind user. */}
      <nav className="explore__actions" aria-label="Actions">
        <button type="button" className="explore__action explore__action--primary" onClick={runOverview}>
          Overview
        </button>
        <button type="button" className="explore__action" onClick={() => engine.nextPoint()}>
          Next point
        </button>
        <button type="button" className="explore__action" onClick={() => engine.explain()}>
          Explain
        </button>
        <button
          type="button"
          className="explore__action"
          disabled={!canAsk}
          title={canAsk ? undefined : 'Needs /reason'}
          onClick={() => runAsk('max')}
        >
          Where is the maximum?
        </button>
        <button type="button" className="explore__action explore__action--ghost" onClick={runStop}>
          Stop speaking
        </button>
        <button
          type="button"
          className="explore__action explore__action--ghost"
          onClick={() => {
            engine.stopAll()
            onReset()
          }}
        >
          Start over
        </button>
      </nav>
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
