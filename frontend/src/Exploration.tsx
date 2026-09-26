import { useEffect, useState } from 'react'
import { RingSimulator } from './RingSimulator'
import type { PullDirection } from './RingSimulator'
import { engine, isLocalExtremum } from './engine'
import type { HapticPatternName } from './engine'
import type { GraphData } from './types'

interface ExplorationProps {
  graph: GraphData
  onBack: () => void
}

// docs/phone-demo-navigation.md §7.2, option (b): series are rows, points are columns.
// Switching rows keeps the current column (§7.3-B) so the user stays oriented at the same
// x-position instead of silently jumping back to the start of the new series.
//
// Vibrations are Person 3's five HAPTIC_PATTERNS (contracts/haptic-patterns.md), in his
// exploration order: unreadable -> long, extremum -> double, rise -> rising, fall -> falling,
// otherwise short.

function getPullDirection(previous: number | null, current: number | null): PullDirection {
  if (previous === null || current === null) return 'unknown'
  if (current > previous) return 'rising'
  if (current < previous) return 'falling'
  return 'flat'
}

function formatValue(value: number | null, unit: string | null | undefined): string {
  if (value === null) return 'unknown value'
  return unit ? `${value}${unit}` : `${value}`
}

export function Exploration({ graph, onBack }: ExplorationProps) {
  const [seriesIndex, setSeriesIndex] = useState(0)
  const [pointIndex, setPointIndex] = useState(0)

  const series = graph.series[seriesIndex]
  const lastPointIndex = graph.xAxis.values.length - 1
  const currentValue = series.values[pointIndex]
  const previousValue = pointIndex > 0 ? series.values[pointIndex - 1] : null
  const direction = getPullDirection(previousValue, currentValue)
  const pointLabel = graph.xAxis.values[pointIndex]

  useEffect(() => {
    // docs/phone-demo-navigation.md §2: discrete speech per point.
    engine.speech.speak(`${series.name}. ${pointLabel}: ${formatValue(currentValue, graph.yAxis.unit)}`, 'interrupt')

    // iOS Safari has no navigator.vibrate - the ring's visual pulse layer carries it there.
    let pattern: HapticPatternName = 'short'
    if (currentValue === null) pattern = 'long'
    else if (isLocalExtremum(series, pointIndex)) pattern = 'double'
    else if (direction === 'rising') pattern = 'rising'
    else if (direction === 'falling') pattern = 'falling'
    engine.playPattern(pattern)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesIndex, pointIndex])

  return (
    <div className="exploration-screen">
      <h1>{graph.title}</h1>

      {graph.series.length > 1 && (
        <div className="series-row" aria-label="Series">
          {graph.series.map((s, i) => (
            <button
              key={s.name}
              type="button"
              aria-pressed={i === seriesIndex}
              className="series-tab"
              onClick={() => setSeriesIndex(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <RingSimulator index={pointIndex} length={graph.xAxis.values.length} direction={direction} />

      <p className="point-readout" role="status" aria-live="polite">
        {series.name}, {pointLabel}: {formatValue(currentValue, graph.yAxis.unit)}
      </p>

      <input
        type="range"
        className="point-slider"
        min={0}
        max={lastPointIndex}
        step={1}
        value={pointIndex}
        onChange={(event) => setPointIndex(Number(event.target.value))}
        aria-label={`${graph.xAxis.label} position, ${series.name}`}
      />

      <button type="button" onClick={onBack} className="exploration-back">
        Back
      </button>
    </div>
  )
}
