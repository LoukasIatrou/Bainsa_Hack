import { useEffect, useMemo, useRef, useState } from 'react'
import { engine, fromPointerEvent, normalise, pointCount, valueRange } from './engine'
import type { EngineStatus } from './engine'
import type { PlotBox } from './engine/curve'
import { lineRuns, runsCurve, runsPath } from './engine/line'
import { explainPoint, installMenu, installWalkGuard } from './engine/menu'
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
  // Spoken before the title on arrival (e.g. a low-confidence warning).
  notice?: string
  onReset: () => void
  onSliderMode: () => void
}

// Plot inner box padding inside the framed panel: room for the faint labels, and top/bottom room
// so the ring isn't cut off at the highest and lowest points.
const PAD = { left: 38, right: 24, top: 36, bottom: 34 }
// Honest labels (Person 3's runbook): say whether this is a live photo or the known graph.
const SOURCE_LABEL: Record<GraphSource, string> = { live: 'live capture', controlled: 'uploaded image', saved: 'cached extraction' }

// The Explore screen. Graph mode: the framed graph; the pointer (mouse or finger) is the simulated
// ring, which first points to the START of the line, then along it to the end; each point is
// explained when the finger reaches it, and the red circle marks that current point. Menu mode: a
// full screen list of actions (swipe to move, tap to choose). A double-tap switches modes (laptop:
// double-click, right-click or M). Every sound and buzz comes from Person 3's engine.
export function ExplorePage({ graph, fieldConfidence, reasoning, fetchReasoning, source, notice = '', onReset, onSliderMode }: ExplorePageProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [status, setStatus] = useState<EngineStatus>(() => engine.getStatus())
  const modeRef = useRef(status.mode)
  const [seriesIndex, setSeriesIndex] = useState(0)
  const [lastSpoken, setLastSpoken] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const started = useRef(false)
  // Tagged with the curve it was computed on: a new curve (resize, series switch) starts over.
  // `current` = the data point the finger last reached (red circle; explained on arrival).
  const [senseState, setSenseState] = useState<{ curve: Curve | null; s: SpiderSenseState; current: number | null }>({
    curve: null,
    s: INITIAL_STATE,
    current: null,
  })
  const senseRef = useRef(senseState)
  const stepRef = useRef<(p: Point | null) => void>(() => {})
  // Mouse clicks pick a menu item directly; touch goes through Person 3's gestures instead.
  const lastPointerType = useRef<string>('')

  // --- engine events --------------------------------------------------------
  useEffect(() => {
    const off = engine.on((event) => {
      if (event.type === 'status:change') {
        modeRef.current = event.status.mode
        setStatus(event.status)
        setSeriesIndex(engine.explore.currentSeries)
      } else if (event.type === 'speech:caption') setLastSpoken(event.text)
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
    installMenu(onReset)
    const intro = (prefix: string) => {
      // Straight into the graph: the ring points to the start of the line, then along it.
      engine.setMode('graph')
      engine.speech.speak(
        `${prefix}${notice}${graph.title}. Follow the ring to the start of the line. Double-tap opens the menu.`,
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
          intro('')
        })
        .catch(() => intro('Reasoning unavailable. '))
    } else {
      intro('Reasoning unavailable. ')
    }
  }, [box, graph, fieldConfidence, reasoning, fetchReasoning, source, onReset, notice])

  // --- pointer input -----------------------------------------------------------
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    // Padding-corrected: normalised against the inner plot element, y up.
    const toData = (clientX: number, clientY: number) =>
      plotRef.current ? fromPointerEvent({ clientX, clientY }, plotRef.current) : null
    engine.setPointerConverter(toData)
    let active: number | null = null
    const inMenu = () => modeRef.current === 'menu'
    // Ring drawing (graph mode only); the engine does its own guidance from the drag gesture.
    const draw = (e: PointerEvent) => {
      if (inMenu() || !panelRef.current) return
      const r = panelRef.current.getBoundingClientRect()
      stepRef.current({ x: e.clientX - r.left, y: e.clientY - r.top })
    }
    // A mouse in menu mode clicks items directly (see onClick below), so it skips the gestures.
    const toGestures = (e: PointerEvent) => !(e.pointerType === 'mouse' && inMenu())

    // Taps are ours: a double-tap switches modes, a single tap does what Person 3's tap did
    // (graph: re-read the point; menu: choose). A tap is withheld from the engine (sent as a
    // cancel) so its own tap handler never fires first. Drags, swipes and long press stay his.
    const TAP_MS = 300
    const TAP_MOVE = 12
    const DOUBLE_MS = 350
    let downAt = 0
    let downX = 0
    let downY = 0
    let moved = 0
    let lastTap = 0
    let single: ReturnType<typeof setTimeout> | null = null
    const onTap = () => {
      const now = performance.now()
      if (single !== null && now - lastTap < DOUBLE_MS) {
        clearTimeout(single)
        single = null
        lastTap = 0
        engine.menu.toggleMode()
        return
      }
      lastTap = now
      single = setTimeout(() => {
        single = null
        if (inMenu()) engine.menu.activate()
        else engine.speakCurrentPoint()
      }, DOUBLE_MS)
    }

    const down = (e: PointerEvent) => {
      lastPointerType.current = e.pointerType
      if (e.button === 2) return // right-click: contextmenu handler
      // Only the first finger counts: a second one would be Person 3's two-finger toggle, and the
      // menu is double-tap only.
      if (active !== null && e.pointerId !== active) return
      active = e.pointerId
      downAt = performance.now()
      downX = e.clientX
      downY = e.clientY
      moved = 0
      if (toGestures(e)) {
        // No capture for a mouse in the menu: it would retarget the click away from the item.
        try {
          el.setPointerCapture?.(e.pointerId)
        } catch {
          // capture is a convenience; the gesture is the point
        }
        engine.gestures.pointerDown(e)
      }
      draw(e)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId === active) {
        moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY))
        if (toGestures(e)) engine.gestures.pointerMove(e)
        draw(e)
      } else if (active === null && e.pointerType === 'mouse' && !inMenu()) {
        // A mouse is the simulated ring: it steers on hover too, no button needed. Like Person 3's
        // demo page, hover also feeds engine.guide so the buzz follows the mouse. Engine first,
        // then the ring: a point's explanation must come after (and cut off) the engine's readout.
        const f = toData(e.clientX, e.clientY)
        if (f) engine.guide(f.x, f.y)
        draw(e)
      }
    }
    const end = (e: PointerEvent, cancel: boolean) => {
      if (e.pointerId !== active) return
      active = null
      if (!toGestures(e)) return
      const tap = !cancel && e.button !== 2 && performance.now() - downAt < TAP_MS && moved < TAP_MOVE
      if (tap) {
        engine.gestures.pointerCancel(e)
        onTap()
      } else if (cancel) engine.gestures.pointerCancel(e)
      else engine.gestures.pointerUp(e)
    }
    const up = (e: PointerEvent) => end(e, false)
    const cancel = (e: PointerEvent) => end(e, true)
    const context = (e: MouseEvent) => {
      // Android fires contextmenu on a long press: that must not open the menu (long press
      // explains the point). Only a real mouse right-click switches modes.
      e.preventDefault()
      if (lastPointerType.current === 'mouse') engine.menu.toggleMode()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    el.addEventListener('contextmenu', context)
    return () => {
      if (single !== null) clearTimeout(single)
      engine.setPointerConverter(null)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      el.removeEventListener('contextmenu', context)
    }
  }, [])

  // --- keyboard (laptop / projector): M toggles, arrows move, Enter chooses ------
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const k = e.key
      if (k === 'm' || k === 'M') engine.menu.toggleMode()
      else if (modeRef.current !== 'menu') return
      else if (k === 'ArrowDown' || k === 'ArrowRight') engine.menu.next()
      else if (k === 'ArrowUp' || k === 'ArrowLeft') engine.menu.previous()
      else if (k === 'Enter' || k === ' ') engine.menu.activate()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // --- geometry -------------------------------------------------------------
  const n = pointCount(graph)
  const range = useMemo(() => valueRange(graph), [graph])
  const series = graph.series[seriesIndex]
  const ys = useMemo(
    () => (series && range ? series.values.map((v) => (v === null ? null : normalise(v, range.min, range.max))) : []),
    [series, range],
  )
  const runs = useMemo(() => (box ? lineRuns(ys, box) : []), [ys, box])
  const path = useMemo(() => runsPath(runs), [runs])
  const curve = useMemo(() => (runs.length ? runsCurve(runs) : null), [runs])
  const px = (x: number) => (box ? box.left + x * box.width : 0)
  const py = (y: number) => (box ? box.top + (1 - y) * box.height : 0)
  const xAt = (i: number) => (n > 1 ? i / (n - 1) : 0.5)

  // --- ring: Nico's spider-sense logic on the line ------------------------------
  // Before the line is picked up it points to the START; on the line it points ALONG it toward
  // the end (or toward the engine's target: Next point, Maximum, Minimum); off the line it points
  // back to where the finger left.
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
      if (!curve) return
      const same = senseRef.current.curve === curve
      const prev = same ? senseRef.current.s : INITIAL_STATE
      let current = same ? senseRef.current.current : null
      const next = stepSpiderSense(prev, p, curve, ringRadius, { guideTo: goal, startAt: startPoint })
      // Reaching a data point makes it the current point and explains it once.
      const reach = Math.max(10, ringRadius * 0.35)
      if (next.phase === 'on-curve' && next.lastContact) {
        const c = next.lastContact
        let best = -1
        let bestD = Infinity
        ys.forEach((y, i) => {
          if (y === null) return
          const d = Math.hypot(px(xAt(i)) - c.x, py(y) - c.y)
          if (d < bestD) {
            bestD = d
            best = i
          }
        })
        if (best >= 0 && bestD <= reach && best !== current) {
          current = best
          explainPoint(best)
        }
      }
      senseRef.current = { curve, s: next, current }
      setSenseState(senseRef.current)
    }
  })

  const sense = senseState.curve === curve ? senseState.s : INITIAL_STATE
  const currentPoint = senseState.curve === curve ? senseState.current : null
  const contact = sense.lastContact
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

  const inMenu = status.mode === 'menu'
  const items = inMenu ? engine.menu.visible : []
  const modeLabel = inMenu ? 'Menu mode' : 'Graph mode'
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

      <div className="explore__body" ref={bodyRef}>
        <div
          className="explore__panel"
          ref={panelRef}
          role="application"
          aria-label={`Graph: ${graph.title}`}
          aria-hidden={inMenu}
        >
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
              {/* A dot on every data point, like the photographed graph. */}
              {ys.map((y, i) =>
                y === null ? null : (
                  <circle key={i} className="explore__dot" cx={px(xAt(i))} cy={py(y)} r={5} data-testid="dot" />
                ),
              )}
              {/* Yellow: where Next point / Maximum / Minimum is guiding to. */}
              {target !== null && targetValue !== null && target !== currentPoint && (
                <circle
                  className="explore__goal"
                  cx={px(xAt(target))}
                  cy={py(targetValue)}
                  r={11}
                  data-testid="target"
                  data-index={target}
                />
              )}
              {/* Red: the current point (the start, until the line is picked up there). */}
              {currentPoint !== null && ys[currentPoint] != null ? (
                <circle
                  className="explore__target"
                  cx={px(xAt(currentPoint))}
                  cy={py(ys[currentPoint] as number)}
                  r={9}
                  data-testid="current"
                  data-index={currentPoint}
                />
              ) : (
                startPoint && (
                  <circle className="explore__target" cx={startPoint.x} cy={startPoint.y} r={9} data-testid="start" />
                )
              )}
              {contact && <circle className="spider-sense__contact" cx={contact.x} cy={contact.y} r={5} />}
              {ring && <EngineRing {...ring} radius={ringRadius} />}
            </svg>
          )}
        </div>

        {inMenu && (
          <ul className="explore__menu" role="listbox" aria-label="Menu" data-testid="menu">
            {items.map((item, i) => (
              <li
                key={item.id}
                role="option"
                aria-selected={i === status.menuPosition.index}
                className={i === status.menuPosition.index ? 'explore__menu-item is-focused' : 'explore__menu-item'}
                onClick={() => {
                  // Touch already went through the gestures (tap = choose the focused item).
                  if (lastPointerType.current !== 'mouse') return
                  engine.menu.focus(item.id)
                  engine.menu.activate()
                }}
              >
                <span className="explore__menu-label">{item.label}</span>
                {item.hint && <span className="explore__menu-hint">{item.hint}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="explore__mode" data-testid="mode">
        {modeLabel}
      </p>
      {/* Screen readers still get what was spoken; it's not shown on screen. */}
      <p className="sr-only" aria-live="polite" data-testid="said">
        {lastSpoken}
      </p>

      {helpOpen && (
        <div className="explore__help" role="dialog" aria-label="Gestures">
          <p className="explore__help-head">Two modes; a double-tap switches between them.</p>
          <ul>
            <li>
              <b>Graph</b>: move or drag to follow the ring; it points to the start of the line, then along it.
              Each point is explained when you reach it; the red circle marks it. Tap re-reads it.
            </li>
            <li>
              <b>Menu</b>: swipe right or down for the next action, left or up for the previous one; tap to choose.
              Actions: Overview, Next point, Explain, Maximum, Minimum, Start over.
            </li>
            <li>Laptop: double-click, right-click or M switches modes; arrow keys move in the menu; Enter chooses.</li>
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
