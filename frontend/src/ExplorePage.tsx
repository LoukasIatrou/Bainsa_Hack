import { useEffect, useMemo, useRef, useState } from 'react'
import { createDistanceTicker, hapticCue } from './haptics'
import { announce, stopSpeech } from './speech'
import { SpiderSense } from './spiderSense/SpiderSense'
import { buildCurveFromPoints } from './spiderSense/logic'
import type { CurveVertex, Point, SpiderSenseState } from './spiderSense/logic'
import type { GraphData, ReasoningResponse } from './types'
import { PADDING } from './exploreLayout'

export type GraphSource = 'saved' | 'live'

interface ExplorePageProps {
  graph: GraphData
  // Person 2's /reason output. Null = unavailable; the page falls back to plain readouts.
  reasoning: ReasoningResponse | null
  source: GraphSource
  // Spoken once on entry, e.g. 'Reasoning unavailable.'
  notice?: string | null
  onReset: () => void
  onSliderMode: () => void
}

interface Goal {
  index: number
  point: Point
  kind: 'overview' | 'next'
}

function formatValue(value: number | null, unit: string | null): string {
  if (value === null) return 'unreadable'
  return unit ? `${value} ${unit}` : String(value)
}

// Landscape explore screen: the graph redrawn from data with the spider-sense ring on it, and
// four big buttons. The ring is the concept (a future physical ring does the pointing); speech
// stays short and any button interrupts it.
export function ExplorePage({ graph, reasoning, source, notice, onReset, onSliderMode }: ExplorePageProps) {
  // TODO: multi-series graphs - only the first series is explored for now.
  const series = graph.series[0]
  const reasoned = reasoning?.series[0] ?? null

  const graphRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [sense, setSense] = useState<SpiderSenseState | null>(null)
  const [goal, setGoalState] = useState<Goal | null>(null)
  const goalRef = useRef<Goal | null>(null)
  // Short entry line; the details come from Overview.
  const [intro] = useState(
    () =>
      `${source === 'saved' ? 'Saved graph. ' : ''}${notice ? `${notice} ` : ''}${graph.title}. Touch the graph, or press Overview.`,
  )
  const [lastSpoken, setLastSpoken] = useState(intro)
  const prevSense = useRef<SpiderSenseState | null>(null)
  const ticker = useMemo(() => createDistanceTicker(), [])

  function setGoal(next: Goal | null) {
    goalRef.current = next
    setGoalState(next)
  }

  function say(text: string, onEnd?: () => void) {
    setLastSpoken(text)
    announce(text, onEnd)
  }

  useEffect(() => {
    const el = graphRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setSize((s) => {
        const w = Math.floor(rect.width)
        const h = Math.floor(rect.height)
        return s && s.w === w && s.h === h ? s : { w, h }
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const curve = useMemo(
    () => (size ? buildCurveFromPoints(series.values, { width: size.w, height: size.h, padding: PADDING }) : null),
    [size, series],
  )
  const vertices = useMemo(() => curve?.vertices ?? [], [curve])

  // Points "Next point" steps through, left to right: Person 2's interest points, or a local
  // start / max / min / end fallback when reasoning is unavailable.
  const stops = useMemo(() => {
    let indices: number[]
    if (reasoned) {
      indices = [...reasoned.interestPoints].sort((a, b) => a.xFraction - b.xFraction).map((p) => p.index)
    } else {
      const known = vertices.map((v) => v.index)
      const vals = series.values
      const byValue = [...known].sort((a, b) => (vals[a] ?? 0) - (vals[b] ?? 0))
      indices = [...new Set([known[0], byValue[byValue.length - 1], byValue[0], known[known.length - 1]])]
      indices.sort((a, b) => a - b)
    }
    return indices
      .map((i) => vertices.find((v) => v.index === i))
      .filter((v): v is CurveVertex => v !== undefined)
  }, [reasoned, vertices, series])

  function nearestVertex(x: number): CurveVertex | null {
    let best: CurveVertex | null = null
    for (const v of vertices) if (!best || Math.abs(v.point.x - x) < Math.abs(best.point.x - x)) best = v
    return best
  }

  function label(index: number): string {
    return `${graph.xAxis.values[index] ?? index + 1}: ${formatValue(series.values[index], graph.yAxis.unit)}`
  }

  function explainText(index: number): string {
    return reasoned?.points[index]?.explain ?? `${label(index)}.`
  }

  function overviewText(): string {
    if (reasoning) return reasoning.overview.text
    const xs = graph.xAxis.values
    return `${graph.title}. ${xs.length} points, ${xs[0]} to ${xs[xs.length - 1]}.`
  }

  useEffect(() => {
    announce(intro)
    return () => {
      ticker.stop()
      stopSpeech()
    }
  }, [intro, ticker])

  function handleSense(next: SpiderSenseState) {
    const prev = prevSense.current
    prevSense.current = next
    setSense(next)

    ticker.setDistance(next.phase === 'searching' && next.pointer ? next.distance : null)

    if (next.phase === 'on-curve' && prev?.phase !== 'on-curve') {
      hapticCue('on-line')
    } else if (next.phase === 'on-curve' && prev?.lastContact && next.lastContact) {
      // One short tick for each data point the contact slid over.
      const lo = Math.min(prev.lastContact.x, next.lastContact.x)
      const hi = Math.max(prev.lastContact.x, next.lastContact.x)
      if (hi > lo && vertices.some((v) => v.point.x > lo && v.point.x <= hi)) hapticCue('point')
    }

    const current = goalRef.current
    if (next.goalReached && !prev?.goalReached && current) {
      hapticCue('arrived')
      setGoal(null)
      const x = graph.xAxis.values[current.index] ?? ''
      say(current.kind === 'next' ? `${x}. Explain available.` : 'Start of the line.')
    }
  }

  function overview() {
    say(overviewText())
    const first = vertices[0]
    if (first) setGoal({ index: first.index, point: first.point, kind: 'overview' })
  }

  function nextPoint() {
    // From the current goal if one is set (tap twice to skip ahead), else from the finger.
    const fromX = goalRef.current?.point.x ?? sense?.lastContact?.x ?? -Infinity
    const next = stops.find((v) => v.point.x > fromX + 1)
    if (!next) {
      setGoal(null)
      say('No more points.')
      return
    }
    setGoal({ index: next.index, point: next.point, kind: 'next' })
    say(`Next: ${graph.xAxis.values[next.index] ?? ''}.`)
  }

  function explain() {
    const index = goalRef.current?.index ?? (sense?.lastContact ? nearestVertex(sense.lastContact.x)?.index : undefined)
    if (index === undefined) {
      say('Touch the graph first.')
      return
    }
    say(explainText(index), () => hapticCue('done'))
  }

  function stop() {
    stopSpeech()
    setGoal(null)
    ticker.stop()
  }

  let phaseText = 'No touch'
  if (sense?.pointer) {
    if (sense.phase === 'on-curve' && sense.lastContact) {
      const v = nearestVertex(sense.lastContact.x)
      phaseText = `On line${v ? ` · ${label(v.index)}` : ''}${sense.atEnd ? ` · ${sense.atEnd}` : ''}`
    } else {
      phaseText = `Searching${sense.mode === 'guided' ? ' · back to the line' : ''}`
    }
  }
  if (goal) phaseText += ` · goal ${graph.xAxis.values[goal.index] ?? ''}`

  const known = series.values.filter((v): v is number => v !== null)
  const xs = graph.xAxis.values
  const showEveryX = xs.length <= 12

  return (
    <div className="explore-screen">
      <div className="explore-left">
        <div className="explore-graph" ref={graphRef}>
          {size && curve && (
            <SpiderSense
              key={`${size.w}x${size.h}`}
              curve={curve}
              width={size.w}
              height={size.h}
              guideTo={goal?.point ?? null}
              onStateChange={handleSense}
            >
              <g className="explore-axes" aria-hidden="true">
                <text className="explore-axes__title" x={PADDING} y={PADDING - 18}>
                  {graph.title}
                </text>
                <line x1={PADDING} y1={PADDING} x2={PADDING} y2={size.h - PADDING} />
                <line x1={PADDING} y1={size.h - PADDING} x2={size.w - PADDING} y2={size.h - PADDING} />
                <text x={PADDING - 6} y={PADDING + 5} textAnchor="end">
                  {Math.max(...known)}
                </text>
                <text x={PADDING - 6} y={size.h - PADDING} textAnchor="end">
                  {Math.min(...known)}
                </text>
                {vertices.map((v) =>
                  showEveryX || v === vertices[0] || v === vertices[vertices.length - 1] ? (
                    <text key={v.index} x={v.point.x} y={size.h - PADDING + 20} textAnchor="middle">
                      {xs[v.index]}
                    </text>
                  ) : null,
                )}
                {vertices.map((v) => (
                  <circle key={v.index} className="explore-axes__dot" cx={v.point.x} cy={v.point.y} r={3} />
                ))}
              </g>
            </SpiderSense>
          )}
        </div>
        <div className="explore-caption">
          <span className={`explore-badge explore-badge--${source}`}>{source === 'saved' ? 'Saved graph' : 'Live'}</span>
          <span className="explore-caption__live" aria-live="polite">
            <strong>Simulated ring</strong> · {phaseText}
            {lastSpoken && <> · Said: &ldquo;{lastSpoken}&rdquo;</>}
          </span>
          <button type="button" className="explore-link" onClick={onSliderMode}>
            Slider mode
          </button>
          <button type="button" className="explore-link" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
      <div className="explore-buttons">
        <button type="button" onClick={overview}>
          Overview
        </button>
        <button type="button" onClick={nextPoint}>
          Next point
        </button>
        <button type="button" onClick={explain}>
          Explain
        </button>
        <button type="button" onClick={stop}>
          Stop
        </button>
      </div>
    </div>
  )
}
