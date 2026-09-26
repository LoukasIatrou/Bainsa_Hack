// Ported from audio-haptics/src/phrasing.ts (Person 3): same wording, so swapping to Person 3's
// engine changes nothing the user hears. Never invent: a null is spoken as unreadable.
import type { ExtractionResponse, FieldConfidence, GraphData } from '../types'
import { pointCount, xLabel } from './graphUtils'

export const LOW_CONFIDENCE = 0.7

const UNIT_LEXICON: Record<string, string> = {
  '°c': 'degrees Celsius',
  '°f': 'degrees Fahrenheit',
  c: 'degrees Celsius',
  f: 'degrees Fahrenheit',
  k: 'kelvin',
  '%': 'percent',
  $: 'dollars',
  usd: 'dollars',
  '€': 'euros',
  eur: 'euros',
  '£': 'pounds',
  gbp: 'pounds',
  kg: 'kilograms',
  km: 'kilometres',
  'km/h': 'kilometres per hour',
  kph: 'kilometres per hour',
  mph: 'miles per hour',
  ms: 'milliseconds',
  kb: 'kilobytes',
  mb: 'megabytes',
  gb: 'gigabytes',
  tb: 'terabytes',
}

export function speakUnit(unit: string | null | undefined): string | null {
  if (unit === null || unit === undefined) return null
  const trimmed = unit.trim()
  if (trimmed === '') return null
  return UNIT_LEXICON[trimmed.toLowerCase()] ?? trimmed
}

export function speakNumber(value: number): string {
  if (!Number.isFinite(value)) return 'an unreadable number'
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100
  const body = Math.abs(rounded).toLocaleString('en-US')
  return rounded < 0 ? `negative ${body}` : body
}

export function speakValue(value: number | null, graph: GraphData, fieldConfidence?: FieldConfidence | null): string {
  if (value === null) return 'value could not be read'
  const hedge = fieldConfidence && fieldConfidence.series < LOW_CONFIDENCE ? 'approximately ' : ''
  const unit = speakUnit(graph.yAxis.unit)
  return unit ? `${hedge}${speakNumber(value)} ${unit}` : `${hedge}${speakNumber(value)}`
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'no series'
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// What Overview says before Person 2's shape sentence: type, title, both axes.
export function describeAxes(graph: GraphData, fieldConfidence?: FieldConfidence | null): string {
  const unit = speakUnit(graph.yAxis.unit)
  const titleCaveat = fieldConfidence && fieldConfidence.title < LOW_CONFIDENCE ? ', though the title may be misread' : ''
  const vertical = unit
    ? `Vertical axis, ${graph.yAxis.label}, in ${unit}.`
    : `Vertical axis, ${graph.yAxis.label}. The unit could not be read.`
  return [
    `${graph.graphType} graph, titled ${graph.title}${titleCaveat}.`,
    `Horizontal axis, ${graph.xAxis.label}, from ${xLabel(graph, 0)} to ${xLabel(graph, pointCount(graph) - 1)}.`,
    vertical,
  ].join(' ')
}

// Multi-series graphs: Overview names every line (Person 3's describeGraphIntro wording).
export function describeSeriesList(graph: GraphData): string | null {
  if (graph.series.length < 2) return null
  return `${graph.series.length} series: ${listNames(graph.series.map((s) => s.name))}.`
}

export function describeExtractionStatus(response: ExtractionResponse): string | null {
  if (response.status === 'error') {
    return response.message
      ? `Extraction failed. ${response.message}`
      : 'Extraction failed. No chart could be read from the image. Please retake or upload a clearer photo.'
  }
  if (response.status === 'low_confidence') {
    const percent = response.graph ? `, ${Math.round(response.graph.confidence * 100)} percent` : ''
    const reason = response.message ? ` ${response.message}` : ''
    return `Extraction confidence is low${percent}.${reason} Please confirm the details before exploring.`
  }
  return null
}

export function describeFieldsNeedingConfirmation(fieldConfidence: FieldConfidence | null | undefined): string | null {
  if (!fieldConfidence) return null
  const labels: Record<keyof FieldConfidence, string> = {
    graphType: 'graph type',
    title: 'title',
    xAxis: 'horizontal axis',
    yAxis: 'vertical axis',
    series: 'data values',
  }
  const low = (Object.keys(labels) as (keyof FieldConfidence)[])
    .filter((key) => fieldConfidence[key] < LOW_CONFIDENCE)
    .map((key) => labels[key])
  if (low.length === 0) return null
  return `Please check the ${listNames(low)}.`
}

// Explain fallback when /reason is unavailable (Person 3's describePointOfInterest).
export function describePointOfInterest(
  graph: GraphData,
  seriesIndex: number,
  pointIndex: number,
  interest: { isMax?: boolean; isMin?: boolean; isTurningPoint?: boolean } = {},
  fieldConfidence?: FieldConfidence | null,
): string {
  const series = graph.series[seriesIndex]
  if (!series) return 'No such series.'
  const raw = series.values[pointIndex]
  if (raw === null || raw === undefined) return `${xLabel(graph, pointIndex)} could not be read.`
  const head = `${xLabel(graph, pointIndex)}, ${speakValue(raw, graph, fieldConfidence)}`
  const notes: string[] = []
  if (interest.isMax) notes.push('the highest point')
  else if (interest.isMin) notes.push('the lowest point')
  else if (interest.isTurningPoint) notes.push('a turning point')
  if (pointIndex === 0) notes.push('the start of the curve')
  else if (pointIndex === pointCount(graph) - 1) notes.push('the end of the curve')
  return notes.length > 0 ? `${head}. This is ${notes.join(', and ')}.` : `${head}.`
}
