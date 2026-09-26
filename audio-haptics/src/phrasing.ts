/**
 * GraphData -> speakable strings.
 *
 * Person 2 supplies prose summaries and answers; turning *data* into words is
 * Person 3's job. Two rules drive everything here, both from the team brief:
 *
 *  1. Never silently invent or overstate. A null value is spoken as unreadable,
 *     never skipped and never interpolated. Low field confidence earns an
 *     explicit hedge.
 *  2. Nothing exists only as sound. Anything the sonification conveys also has
 *     a text equivalent (`describeSonification`).
 */

import type {
  ExtractionResponse,
  FieldConfidence,
  GraphData,
  Series,
} from './types.js';
import { maxIndex, minIndex, pointCount, valueRange, xLabel } from './graph-utils.js';

/** Below this, a field gets a spoken caveat. */
export const LOW_CONFIDENCE = 0.7;

/**
 * Symbols and abbreviations that TTS engines read inconsistently or skip
 * entirely. Deliberately conservative -- an ambiguous abbreviation (`m` for
 * metres or minutes?) is better left as-is than guessed wrong. Extend as real
 * extracted units appear.
 */
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
};

/** Expand a unit for speech. Returns null when there is no unit to speak. */
export function speakUnit(unit: string | null | undefined): string | null {
  if (unit === null || unit === undefined) return null;
  const trimmed = unit.trim();
  if (trimmed === '') return null;
  return UNIT_LEXICON[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * Format a number for speech: sensible rounding, an explicit "negative" rather
 * than a minus sign that TTS may drop, and thousands grouping.
 */
export function speakNumber(value: number): string {
  if (!Number.isFinite(value)) return 'an unreadable number';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  const body = Math.abs(rounded).toLocaleString('en-US');
  return rounded < 0 ? `negative ${body}` : body;
}

function seriesIsHedged(fieldConfidence?: FieldConfidence | null): boolean {
  return fieldConfidence !== null
    && fieldConfidence !== undefined
    && fieldConfidence.series < LOW_CONFIDENCE;
}

/** "12 degrees Celsius", "approximately 12", "value could not be read". */
export function speakValue(
  value: number | null,
  graph: GraphData,
  fieldConfidence?: FieldConfidence | null,
  options: { includeUnit?: boolean } = {},
): string {
  if (value === null) return 'value could not be read';

  const hedge = seriesIsHedged(fieldConfidence) ? 'approximately ' : '';
  const unit = options.includeUnit === false ? null : speakUnit(graph.yAxis.unit);
  return unit ? `${hedge}${speakNumber(value)} ${unit}` : `${hedge}${speakNumber(value)}`;
}

/**
 * A single point readout, spoken on every exploration move.
 * "Milan, March, 12 degrees Celsius. Point 3 of 5."
 *
 * The unit is included here even though `describeGraphIntro` also states it:
 * a listener arriving mid-exploration should not have to remember it. Callers
 * can drop it with `includeUnit: false` if it proves too chatty in rehearsal.
 */
export function describePoint(
  graph: GraphData,
  seriesIndex: number,
  pointIndex: number,
  fieldConfidence?: FieldConfidence | null,
  options: { includeUnit?: boolean; includePosition?: boolean } = {},
): string {
  const series = graph.series[seriesIndex];
  if (!series) return 'No such series.';

  const parts: string[] = [];
  if (graph.series.length > 1) parts.push(series.name);
  parts.push(xLabel(graph, pointIndex));

  const raw = series.values[pointIndex];
  const value = raw === undefined ? null : raw;
  parts.push(speakValue(value, graph, fieldConfidence, options));

  const head = `${parts.join(', ')}.`;
  if (options.includePosition === false) return head;
  return `${head} Point ${pointIndex + 1} of ${pointCount(graph)}.`;
}

function listSeriesNames(graph: GraphData): string {
  const names = graph.series.map((s) => s.name);
  if (names.length === 0) return 'no series';
  if (names.length === 1) return names[0]!;
  const last = names[names.length - 1]!;
  return `${names.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * Spoken before Person 2's summary so the listener has a frame to hang it on:
 * graph type, title, both axes, series names, value range and point count.
 * Also where unit-unreadable and low-confidence caveats are stated once,
 * rather than repeated on every point.
 */
export function describeGraphIntro(
  graph: GraphData,
  fieldConfidence?: FieldConfidence | null,
): string {
  const sentences: string[] = [];

  const titleCaveat = fieldConfidence && fieldConfidence.title < LOW_CONFIDENCE
    ? ', though the title may be misread'
    : '';
  sentences.push(`${graph.graphType} graph, titled ${graph.title}${titleCaveat}.`);

  const count = pointCount(graph);
  const first = xLabel(graph, 0);
  const last = xLabel(graph, count - 1);
  sentences.push(
    `Horizontal axis, ${graph.xAxis.label}: ${count} points from ${first} to ${last}.`,
  );

  const unit = speakUnit(graph.yAxis.unit);
  if (unit) {
    sentences.push(`Vertical axis, ${graph.yAxis.label}, in ${unit}.`);
  } else {
    // unit === null in the contract means it could not be read -- say so once,
    // rather than leaving every value sounding bare and unexplained.
    sentences.push(`Vertical axis, ${graph.yAxis.label}. The unit could not be read.`);
  }

  sentences.push(
    graph.series.length === 1
      ? `One series: ${listSeriesNames(graph)}.`
      : `${graph.series.length} series: ${listSeriesNames(graph)}.`,
  );

  const range = valueRange(graph);
  if (range) {
    sentences.push(
      `Values range from ${speakNumber(range.min)} to ${speakNumber(range.max)}.`,
    );
  } else {
    sentences.push('No values could be read from this graph.');
  }

  const unreadable = countUnreadable(graph);
  if (unreadable > 0) {
    sentences.push(
      unreadable === 1
        ? 'One point could not be read.'
        : `${unreadable} points could not be read.`,
    );
  }

  return sentences.join(' ');
}

export function countUnreadable(graph: GraphData): number {
  return graph.series.reduce(
    (total, s) => total + s.values.filter((v) => v === null).length,
    0,
  );
}

/**
 * The graph's shape in words -- highs, lows and how many points.
 *
 * Used when no summary is available from either the extraction or /reason, so
 * the overview never falls silent. Deliberately says nothing about sound: the
 * demo does not sonify, and describing a channel that is not playing would be
 * a lie about what the user is hearing.
 */
export function describeShape(graph: GraphData, seriesIndices?: number[]): string {
  const indices = seriesIndices ?? graph.series.map((_, i) => i);
  const sentences: string[] = [];

  for (const i of indices) {
    const series = graph.series[i];
    if (!series) continue;
    sentences.push(describeSeriesShape(graph, series));
  }

  if (sentences.length === 0) return 'No values could be read from this graph.';
  if (countUnreadable(graph) > 0) {
    sentences.push('Some points could not be read and are announced as such.');
  }
  return sentences.join(' ');
}

/**
 * The text equivalent of the sonification, so the shape information is never
 * available only as sound. Only meaningful when sonification is actually in
 * use; `describeShape` is the neutral version.
 */
export function describeSonification(graph: GraphData, seriesIndices?: number[]): string {
  const indices = seriesIndices ?? graph.series.map((_, i) => i);
  const sentences: string[] = [
    `Sonification plays ${pointCount(graph)} points from left to right. Pitch rises with value.`,
  ];

  for (const i of indices) {
    const series = graph.series[i];
    if (!series) continue;
    sentences.push(describeSeriesShape(graph, series));
  }

  if (countUnreadable(graph) > 0) {
    sentences.push('Unreadable points are marked with a distinct sound rather than silence.');
  }

  return sentences.join(' ');
}

function describeSeriesShape(graph: GraphData, series: Series): string {
  const hi = maxIndex(series);
  const lo = minIndex(series);
  if (hi === -1) return `${series.name}: no readable values.`;

  const multi = graph.series.length > 1;
  const prefix = multi ? `${series.name}: ` : '';
  // Without a series-name prefix this starts the sentence, so it needs a capital.
  const highest = `${multi ? 'h' : 'H'}ighest at ${xLabel(graph, hi)}, ${speakNumber(series.values[hi] as number)}`;
  const lowest = `lowest at ${xLabel(graph, lo)}, ${speakNumber(series.values[lo] as number)}`;
  return `${prefix}${highest}; ${lowest}.`;
}

/**
 * What to say about the extraction itself. Returns null when there is nothing
 * worth interrupting the user for.
 *
 * The 'error' branch matters: `contracts/extraction-response.schema.json`
 * returns no graph at all in that case, so this is the only thing the engine
 * can say, and it has to include the recovery action.
 */
export function describeExtractionStatus(response: ExtractionResponse): string | null {
  if (response.status === 'error') {
    return response.message
      ? `Extraction failed. ${response.message}`
      : 'Extraction failed. No chart could be read from the image. Please retake or upload a clearer photo.';
  }

  if (response.status === 'low_confidence') {
    const percent = response.graph
      ? `, ${Math.round(response.graph.confidence * 100)} percent`
      : '';
    const reason = response.message ? ` ${response.message}` : '';
    return `Extraction confidence is low${percent}.${reason} Please confirm the details before exploring.`;
  }

  return null;
}

/**
 * Which specific fields need user confirmation, for the confirmation step.
 * Spoken, so the correction flow is reachable without looking at the screen.
 */
export function describeFieldsNeedingConfirmation(
  fieldConfidence: FieldConfidence | null | undefined,
): string | null {
  if (!fieldConfidence) return null;
  const labels: Record<keyof FieldConfidence, string> = {
    graphType: 'graph type',
    title: 'title',
    xAxis: 'horizontal axis',
    yAxis: 'vertical axis',
    series: 'data values',
  };

  const low = (Object.keys(labels) as (keyof FieldConfidence)[])
    .filter((key) => fieldConfidence[key] < LOW_CONFIDENCE)
    .map((key) => labels[key]);

  if (low.length === 0) return null;
  const last = low[low.length - 1]!;
  const list = low.length === 1 ? last : `${low.slice(0, -1).join(', ')} and ${last}`;
  return `Please check the ${list}.`;
}

/**
 * The short "Explain" readout for the Explore page: where the point is, what
 * it is worth, and why it is interesting. Deliberately much shorter than
 * `describeGraphIntro` -- it is spoken every time the user lands on a point,
 * so it has to stay out of the way.
 */
export function describePointOfInterest(
  graph: GraphData,
  seriesIndex: number,
  pointIndex: number,
  interest: { isMax?: boolean; isMin?: boolean; isTurningPoint?: boolean } = {},
  fieldConfidence?: FieldConfidence | null,
): string {
  const series = graph.series[seriesIndex];
  if (!series) return 'No such series.';

  const parts: string[] = [`${xLabel(graph, pointIndex)},`];
  const raw = series.values[pointIndex];
  parts.push(speakValue(raw === undefined ? null : raw, graph, fieldConfidence));

  const notes: string[] = [];
  if (interest.isMax) notes.push('the highest point');
  else if (interest.isMin) notes.push('the lowest point');
  else if (interest.isTurningPoint) notes.push('a turning point');

  if (pointIndex === 0) notes.push('the start of the curve');
  else if (pointIndex === pointCount(graph) - 1) notes.push('the end of the curve');

  const head = parts.join(' ');
  return notes.length > 0 ? `${head}. This is ${notes.join(', and ')}.` : `${head}.`;
}

/**
 * Axes and graph type only -- what the Overview button says before handing
 * over to haptic guidance. Shorter than `describeGraphIntro`, which also
 * covers series, range and unreadable counts.
 */
export function describeAxes(
  graph: GraphData,
  fieldConfidence?: FieldConfidence | null,
): string {
  const unit = speakUnit(graph.yAxis.unit);
  const titleCaveat = fieldConfidence && fieldConfidence.title < LOW_CONFIDENCE
    ? ', though the title may be misread'
    : '';
  const vertical = unit
    ? `Vertical axis, ${graph.yAxis.label}, in ${unit}.`
    : `Vertical axis, ${graph.yAxis.label}. The unit could not be read.`;
  return [
    `${graph.graphType} graph, titled ${graph.title}${titleCaveat}.`,
    `Horizontal axis, ${graph.xAxis.label}, from ${xLabel(graph, 0)} to ${xLabel(graph, pointCount(graph) - 1)}.`,
    vertical,
  ].join(' ');
}
