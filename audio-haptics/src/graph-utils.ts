/**
 * Small shared helpers over GraphData. Every one of these has to treat a null
 * value as "could not be read" rather than as zero -- the brief forbids
 * silently inventing data, and `contracts/graph-data.schema.json` makes nulls
 * a normal case, not an error.
 */

import type { GraphData, GraphKind, Series } from './types.js';

export function numericValues(series: Series): number[] {
  return series.values.filter((v): v is number => v !== null);
}

/** Value range across the given series (all of them by default), ignoring nulls. */
export function valueRange(
  graph: GraphData,
  seriesIndices?: number[],
): { min: number; max: number } | null {
  const indices = seriesIndices ?? graph.series.map((_, i) => i);
  const all: number[] = [];
  for (const i of indices) {
    const s = graph.series[i];
    if (s) all.push(...numericValues(s));
  }
  if (all.length === 0) return null;
  return { min: Math.min(...all), max: Math.max(...all) };
}

/** Index of the highest non-null value, or -1 if the series has no readable values. */
export function maxIndex(series: Series): number {
  let best = -1;
  let bestValue = -Infinity;
  series.values.forEach((v, i) => {
    if (v !== null && v > bestValue) {
      bestValue = v;
      best = i;
    }
  });
  return best;
}

/** Index of the lowest non-null value, or -1 if the series has no readable values. */
export function minIndex(series: Series): number {
  let best = -1;
  let bestValue = Infinity;
  series.values.forEach((v, i) => {
    if (v !== null && v < bestValue) {
      bestValue = v;
      best = i;
    }
  });
  return best;
}

/**
 * Whether the point is a local extremum, comparing against the nearest
 * readable neighbours on each side so a null does not hide a peak.
 */
export function isLocalExtremum(series: Series, index: number): boolean {
  const value = series.values[index];
  if (value === null || value === undefined) return false;

  const prev = previousReadable(series, index);
  const next = nextReadable(series, index);
  if (prev === null && next === null) return false;

  const higherThanPrev = prev === null || value > prev;
  const higherThanNext = next === null || value > next;
  const lowerThanPrev = prev === null || value < prev;
  const lowerThanNext = next === null || value < next;

  return (higherThanPrev && higherThanNext) || (lowerThanPrev && lowerThanNext);
}

export function previousReadable(series: Series, index: number): number | null {
  for (let i = index - 1; i >= 0; i--) {
    const v = series.values[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

export function nextReadable(series: Series, index: number): number | null {
  for (let i = index + 1; i < series.values.length; i++) {
    const v = series.values[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/**
 * Direction relative to the previous readable point.
 * 'flat' also covers "no previous point to compare against".
 */
export function direction(series: Series, index: number): 'up' | 'down' | 'flat' {
  const value = series.values[index];
  if (value === null || value === undefined) return 'flat';
  const prev = previousReadable(series, index);
  if (prev === null) return 'flat';
  if (value > prev) return 'up';
  if (value < prev) return 'down';
  return 'flat';
}

/** Number of x-axis positions, taken as the longest of the axis and the series. */
export function pointCount(graph: GraphData): number {
  return graph.series.reduce(
    (max, s) => Math.max(max, s.values.length),
    graph.xAxis.values.length,
  );
}

export function xLabel(graph: GraphData, index: number): string {
  return graph.xAxis.values[index] ?? `position ${index + 1}`;
}

/**
 * Guess whether a graph is a sampled function or a set of labelled points.
 *
 * A densely sampled curve has many points and bare numeric x labels; a real
 * data series has few points with meaningful labels ("March", "Q3", "2020").
 * The threshold is a heuristic, so callers can always override it with
 * `engine.setGraphKind()` -- getting it wrong only changes which modes are
 * offered, never what is spoken.
 */
export function inferGraphKind(graph: GraphData): GraphKind {
  const labels = graph.xAxis.values;
  if (labels.length >= CONTINUOUS_POINT_THRESHOLD) return 'continuous';

  // All-numeric labels with no gaps read as a sampled domain rather than
  // categories, but only once there are enough of them to trace meaningfully.
  const allNumeric = labels.length > 0 && labels.every((v) => v.trim() !== '' && !Number.isNaN(Number(v)));
  if (allNumeric && labels.length >= NUMERIC_CONTINUOUS_THRESHOLD) return 'continuous';

  return 'discrete';
}

/** At or above this many points, stopping on each one stops being useful. */
export const CONTINUOUS_POINT_THRESHOLD = 40;
/** Numeric labels need to be denser than categorical ones to count as continuous. */
export const NUMERIC_CONTINUOUS_THRESHOLD = 25;

/** Normalise a value into 0-1 across a range, clamped. Flat ranges map to the middle. */
export function normalise(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  const n = (value - min) / (max - min);
  return Math.min(1, Math.max(0, n));
}
