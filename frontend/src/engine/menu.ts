// Person 4's menu for Person 3's engine (menu mode: swipe to move, tap to choose; two-finger tap,
// right-click or M switches back to the graph). Items follow the demo walkthrough. Every action
// that points at the graph switches to graph mode, so the ring can guide the finger there.
//
// Front-end workarounds for engine behaviours we may not patch in audio-haptics/:
//  - Overview stops a running Explain walk first, and speaks /reason's overview caveats.
//  - His ask() cuts its own answer off (see runAsk).
//  - Returning to the menu mid-walk ends the walk (installWalkGuard).
import { engine } from './index'
import type { MenuItem } from './index'

function stopWalk(): void {
  engine.stopExplainMode()
}

// Person 2's explanation for a point of the current line ('2020, 8.1 percent. The highest point,
// up 4.4 percentage points from 2019; after this it falls.'), or Person 3's own wording without
// /reason. The engine's reasoning object is the /reason JSON; its type just omits `explain`.
export function explainPoint(index: number): void {
  const graph = engine.getGraph()
  if (!graph) return
  const series = graph.series[engine.explore.currentSeries] ?? graph.series[0]
  const reasoning = engine.getReasoning() as unknown as {
    series?: { name: string; points: { index: number; explain?: string }[] }[]
  } | null
  const text = reasoning?.series?.find((s) => s.name === series.name)?.points.find((p) => p.index === index)?.explain
  engine.explore.focus(index, { announce: false })
  if (text) engine.speech.speak(text, 'interrupt')
  else engine.explain()
}

export function runOverview(): void {
  stopWalk()
  engine.setMode('graph')
  engine.startOverview()
  for (const caveat of engine.getReasoning()?.overview.caveats ?? []) engine.speech.speak(caveat, 'normal')
}

// Preset question. His ask() speaks the answer with 'interrupt' and then focuses the point,
// whose readout is also 'interrupt' - so the answer is cut off before it is heard. Same steps
// here, but the move to the point is silent (one 'double' pulse), so the answer plays in full.
export function runAsk(question: 'max'): void {
  const answer = engine.getReasoning()?.answers?.[question]
  const graph = engine.getGraph()
  if (!answer || !graph) {
    engine.ask(question)
    return
  }
  // Switch mode BEFORE speaking: the engine announces "Graph mode..." with 'interrupt', which
  // would otherwise cut the answer off.
  engine.setMode('graph')
  engine.speech.speak(answer.answer, 'interrupt')
  for (const caveat of answer.caveats) engine.speech.speak(caveat, 'normal')
  const first = answer.highlight[0]
  if (first) {
    const seriesIndex = graph.series.findIndex((s) => s.name === first.series)
    if (seriesIndex >= 0) engine.explore.selectSeries(seriesIndex, { announce: false })
    guideTo(first.index)
  }
}

// /reason has no "minimum" preset answer, so find the lowest readable value of the current line
// and speak Person 2's explanation for that point (fallback: a plain sentence).
export function runMin(): void {
  const graph = engine.getGraph()
  if (!graph) return
  const series = graph.series[engine.explore.currentSeries] ?? graph.series[0]
  let index = -1
  series.values.forEach((v, i) => {
    if (v !== null && (index < 0 || v < (series.values[index] as number))) index = i
  })
  if (index < 0) {
    engine.speech.speak('No values could be read.', 'interrupt')
    return
  }
  // The engine's reasoning object is Person 2's /reason JSON; its type just omits `explain`.
  const reasoning = engine.getReasoning() as unknown as {
    series?: { name: string; points: { index: number; explain?: string }[] }[]
  } | null
  const explain = reasoning?.series?.find((s) => s.name === series.name)?.points.find((p) => p.index === index)?.explain
  const unit = graph.yAxis.unit ? ` ${graph.yAxis.unit}` : ''
  engine.setMode('graph') // before speaking, see runAsk
  engine.speech.speak(
    explain ? `Lowest point. ${explain}` : `Lowest: ${series.values[index]}${unit}, at ${graph.xAxis.values[index]}.`,
    'interrupt',
  )
  guideTo(index)
}

// Mark the point silently (one 'double' pulse) and steer the finger to it. Callers have already
// switched to graph mode.
function guideTo(index: number): void {
  engine.explore.focus(index, { announce: false, pattern: 'double' })
  engine.guidance.start(index)
}

export function installMenu(onStartOver: () => void): void {
  const hasGraph = () => engine.getGraph() !== null
  const items: MenuItem[] = [
    { id: 'overview', label: 'Overview', hint: 'Axes and the shape of the graph.', available: hasGraph, activate: runOverview },
    {
      id: 'next',
      label: 'Next point',
      hint: 'Guides you to the next peak or low.',
      available: hasGraph,
      activate: () => {
        stopWalk()
        engine.setMode('graph')
        engine.nextPoint()
      },
    },
    {
      id: 'explain',
      label: 'Explain',
      hint: 'Describes the point you are on.',
      available: hasGraph,
      activate: () => {
        engine.setMode('graph')
        explainPoint(engine.explore.currentPoint)
      },
    },
    { id: 'max', label: 'Maximum', hint: 'Where is the highest value?', available: hasGraph, activate: () => runAsk('max') },
    { id: 'min', label: 'Minimum', hint: 'Where is the lowest value?', available: hasGraph, activate: runMin },
    {
      id: 'start-over',
      label: 'Start over',
      hint: 'Back to the camera.',
      activate: () => {
        engine.stopAll()
        onStartOver()
      },
    },
  ]
  engine.menu.setItems(items)
}

// Returning to the menu mid-walk ends the walk (his menu toggle leaves it running).
export function installWalkGuard(): () => void {
  return engine.on((event) => {
    if (event.type === 'status:change' && event.status.mode === 'menu' && event.status.explaining) stopWalk()
  })
}
