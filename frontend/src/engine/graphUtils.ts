// Ported from audio-haptics/src/graph-utils.ts (Person 3). Nulls are "could not be read", never 0.
import type { GraphData, Series } from '../types'
import type { GraphKind } from './types'

export function numericValues(series: Series): number[] {
  return series.values.filter((v): v is number => v !== null)
}

// Value range across all series (Person 2's `normalised` uses the same range), ignoring nulls.
export function valueRange(graph: GraphData): { min: number; max: number } | null {
  const all = graph.series.flatMap(numericValues)
  if (all.length === 0) return null
  return { min: Math.min(...all), max: Math.max(...all) }
}

export function maxIndex(series: Series): number {
  let best = -1
  let bestValue = -Infinity
  series.values.forEach((v, i) => {
    if (v !== null && v > bestValue) {
      bestValue = v
      best = i
    }
  })
  return best
}

export function minIndex(series: Series): number {
  let best = -1
  let bestValue = Infinity
  series.values.forEach((v, i) => {
    if (v !== null && v < bestValue) {
      bestValue = v
      best = i
    }
  })
  return best
}

function previousReadable(series: Series, index: number): number | null {
  for (let i = index - 1; i >= 0; i--) {
    const v = series.values[i]
    if (v !== null && v !== undefined) return v
  }
  return null
}

function nextReadable(series: Series, index: number): number | null {
  for (let i = index + 1; i < series.values.length; i++) {
    const v = series.values[i]
    if (v !== null && v !== undefined) return v
  }
  return null
}

export function isLocalExtremum(series: Series, index: number): boolean {
  const value = series.values[index]
  if (value === null || value === undefined) return false
  const prev = previousReadable(series, index)
  const next = nextReadable(series, index)
  if (prev === null && next === null) return false
  const hiPrev = prev === null || value > prev
  const hiNext = next === null || value > next
  const loPrev = prev === null || value < prev
  const loNext = next === null || value < next
  return (hiPrev && hiNext) || (loPrev && loNext)
}

export function pointCount(graph: GraphData): number {
  return graph.series.reduce((max, s) => Math.max(max, s.values.length), graph.xAxis.values.length)
}

export function xLabel(graph: GraphData, index: number): string {
  return graph.xAxis.values[index] ?? `position ${index + 1}`
}

export const CONTINUOUS_POINT_THRESHOLD = 40
export const NUMERIC_CONTINUOUS_THRESHOLD = 25

// Exactly Person 3's heuristic: many points, or 25+ bare numeric labels, is a sampled curve.
export function inferGraphKind(graph: GraphData): GraphKind {
  const labels = graph.xAxis.values
  if (labels.length >= CONTINUOUS_POINT_THRESHOLD) return 'continuous'
  const allNumeric = labels.length > 0 && labels.every((v) => v.trim() !== '' && !Number.isNaN(Number(v)))
  if (allNumeric && labels.length >= NUMERIC_CONTINUOUS_THRESHOLD) return 'continuous'
  return 'discrete'
}

export function normalise(value: number, min: number, max: number): number {
  if (max === min) return 0.5
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

// One series in normalised data space (0 = graph min, 1 = graph max, over ALL series).
export function normalisedSeries(graph: GraphData, seriesIndex: number): (number | null)[] {
  const series = graph.series[seriesIndex]
  const range = valueRange(graph)
  if (!series || !range) return []
  return series.values.map((v) => (v === null ? null : normalise(v, range.min, range.max)))
}
