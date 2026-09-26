// Person 4's menu for Person 3's engine: his default items, reordered the same, plus
// front-end workarounds for engine behaviours we may not patch in audio-haptics/:
//  - Overview stops a running Explain walk first, and speaks /reason's overview caveats.
//  - Stop ends the walk as well as speech (his stopSpeaking emits no speech:idle, so a walk
//    left running would stall).
//  - Two-finger tap back to the menu ends the walk (see installWalkGuard); "Continue from next
//    point" then resumes it one point on, which doubles as "skip".
import { engine } from './index'
import type { MenuItem } from './index'

let pausedAt: number | null = null

function stopWalk(): void {
  const step = engine.getStatus().explainStep
  if (engine.getStatus().explaining && step !== null) pausedAt = step - 1
  engine.stopExplainMode()
}

// Shared by the menu and the demo buttons, so both get the same walk workarounds.
export function runOverview(): void {
  engine.stopExplainMode()
  pausedAt = null
  engine.setMode('graph')
  engine.startOverview()
  for (const caveat of engine.getReasoning()?.overview.caveats ?? []) engine.speech.speak(caveat, 'normal')
}

export function runStop(): void {
  stopWalk()
  engine.stopSpeaking()
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
  engine.speech.speak(answer.answer, 'interrupt')
  for (const caveat of answer.caveats) engine.speech.speak(caveat, 'normal')
  const first = answer.highlight[0]
  if (first) {
    const seriesIndex = graph.series.findIndex((s) => s.name === first.series)
    if (seriesIndex >= 0) engine.explore.selectSeries(seriesIndex, { announce: false })
    engine.explore.focus(first.index, { announce: false, pattern: 'double' })
    // Then steer the finger to the evidence, like Next point does.
    engine.setMode('graph')
    engine.guidance.start(first.index)
  }
}

export function installMenu(): void {
  pausedAt = null
  const items: MenuItem[] = [
    {
      id: 'overview',
      label: 'Overview',
      hint: 'Hear the shape of the whole graph.',
      available: () => engine.getGraph() !== null,
      activate: runOverview,
    },
    {
      id: 'explain',
      label: 'Explain each point',
      hint: 'Guided walk through every point.',
      available: () => engine.getGraph() !== null && engine.getGraphKind() === 'discrete',
      activate: () => {
        pausedAt = null
        engine.setMode('graph')
        engine.startExplainMode()
      },
    },
    {
      id: 'continue',
      label: 'Continue from next point',
      hint: 'Resume the walk one point on.',
      available: () => pausedAt !== null && engine.getGraphKind() === 'discrete',
      activate: () => {
        const from = (pausedAt ?? -1) + 1
        pausedAt = null
        engine.setMode('graph')
        engine.startExplainMode(from)
      },
    },
    {
      id: 'graph',
      label: 'Explore freely',
      hint: 'Trace the curve with a finger.',
      available: () => engine.getGraph() !== null,
      activate: () => engine.setMode('graph'),
    },
    { id: 'repeat', label: 'Repeat that', activate: () => engine.replay() },
    {
      id: 'series',
      label: 'Switch series',
      available: () => (engine.getGraph()?.series.length ?? 0) > 1,
      activate: () => engine.explore.nextSeries(),
    },
    {
      id: 'stop',
      label: 'Stop speaking',
      activate: runStop,
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
