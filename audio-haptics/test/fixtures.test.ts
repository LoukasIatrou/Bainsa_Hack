/**
 * Runs the phrasing and graph-logic layers against Person 1's real fixture
 * files in `backend/fixtures/` -- the exact JSON served by
 * `GET /extract/mock?scenario=...`, read straight off disk so this test cannot
 * silently drift from the contract.
 *
 * Only the DOM-free layers are covered here (phrasing, graph-utils). Speech,
 * Web Audio and vibration need a browser and are exercised in the harness.
 *
 *   npx tsx test/fixtures.test.ts     (or: npm test)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import type { ExtractionResponse, GraphData, ReasoningResponse } from '../src/types.js';
import {
  describeExtractionStatus,
  describeFieldsNeedingConfirmation,
  describeGraphIntro,
  describePoint,
  describeSonification,
  speakNumber,
  speakUnit,
} from '../src/phrasing.js';
import { maxIndex, minIndex, pointCount, valueRange } from '../src/graph-utils.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', 'backend', 'fixtures');

const load = (scenario: string): ExtractionResponse =>
  JSON.parse(readFileSync(join(fixturesDir, `${scenario}.json`), 'utf8')) as ExtractionResponse;

let failures = 0;
let checks = 0;

function check(label: string, fn: () => void): void {
  checks += 1;
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        ${(error as Error).message.split('\n')[0]}`);
  }
}

/** Nothing spoken should ever contain a leaked null/undefined/NaN. */
function assertSpeakable(text: string, label: string): void {
  for (const bad of ['null', 'undefined', 'NaN', 'Infinity', '[object']) {
    assert.ok(
      !text.includes(bad),
      `${label}: spoken text leaked "${bad}" -> ${JSON.stringify(text)}`,
    );
  }
  assert.ok(text.trim().length > 0, `${label}: spoken text is empty`);
}

function everySpokenString(response: ExtractionResponse): string[] {
  const out: string[] = [];
  const status = describeExtractionStatus(response);
  if (status) out.push(status);
  const confirm = describeFieldsNeedingConfirmation(response.fieldConfidence);
  if (confirm) out.push(confirm);

  const graph = response.graph;
  if (graph) {
    out.push(describeGraphIntro(graph, response.fieldConfidence));
    out.push(describeSonification(graph));
    graph.series.forEach((_, s) => {
      for (let i = 0; i < pointCount(graph); i++) {
        out.push(describePoint(graph, s, i, response.fieldConfidence));
      }
    });
    if (graph.summary) out.push(graph.summary);
  }
  return out;
}

// ---------------------------------------------------------------------------

console.log('\nunits and numbers');
check('°C expands for TTS', () => assert.equal(speakUnit('°C'), 'degrees Celsius'));
check('null unit yields null', () => assert.equal(speakUnit(null), null));
check('unknown unit passes through', () => assert.equal(speakUnit('widgets'), 'widgets'));
check('negative is spoken, not a minus sign', () =>
  assert.equal(speakNumber(-4), 'negative 4'));
check('large numbers are grouped', () => assert.equal(speakNumber(1234567), '1,234,567'));
check('decimals are rounded sensibly', () => assert.equal(speakNumber(12.3456), '12.35'));

console.log('\nscenario: ok (two series, no nulls)');
{
  const res = load('ok');
  const graph = res.graph as GraphData;

  check('status ok says nothing (no needless interruption)', () =>
    assert.equal(describeExtractionStatus(res), null));
  check('no fields flagged for confirmation', () =>
    assert.equal(describeFieldsNeedingConfirmation(res.fieldConfidence), null));
  check('two series present', () => assert.equal(graph.series.length, 2));
  check('intro expands the unit', () =>
    assert.ok(describeGraphIntro(graph, res.fieldConfidence).includes('degrees Celsius')));
  check('intro states both series', () => {
    const intro = describeGraphIntro(graph, res.fieldConfidence);
    assert.ok(intro.includes('Milan') && intro.includes('Palermo'));
  });
  check('intro states the true range across both series', () => {
    assert.deepEqual(valueRange(graph), { min: 4, max: 22 });
  });
  check('high confidence is not hedged', () =>
    assert.ok(!describePoint(graph, 0, 2, res.fieldConfidence).includes('approximately')));
  check('point readout names series, label, value and position', () =>
    assert.equal(
      describePoint(graph, 0, 2, res.fieldConfidence),
      'Milan, March, 12 degrees Celsius. Point 3 of 5.',
    ));
  check('all spoken strings are clean', () =>
    everySpokenString(res).forEach((t, i) => assertSpeakable(t, `ok[${i}]`)));
}

console.log('\nscenario: low_confidence (null value, null unit, 0.4/0.5 confidence)');
{
  const res = load('low_confidence');
  const graph = res.graph as GraphData;
  const series = graph.series[0]!;

  check('fixture really does contain a null value', () =>
    assert.equal(series.values.filter((v) => v === null).length, 1));
  check('fixture really does have a null unit', () =>
    assert.equal(graph.yAxis.unit, null));

  check('low confidence is announced with a percentage', () => {
    const line = describeExtractionStatus(res);
    assert.ok(line && line.includes('52 percent'), `got: ${line}`);
  });
  check('backend message is passed through, not dropped', () => {
    const line = describeExtractionStatus(res)!;
    assert.ok(line.includes('cropped'), `got: ${line}`);
  });
  check('names exactly the low-confidence fields', () =>
    assert.equal(
      describeFieldsNeedingConfirmation(res.fieldConfidence),
      'Please check the vertical axis and data values.',
    ));
  check('unreadable unit is stated once in the intro', () =>
    assert.ok(describeGraphIntro(graph, res.fieldConfidence).includes('unit could not be read')));
  check('intro counts the unreadable point', () =>
    assert.ok(describeGraphIntro(graph, res.fieldConfidence).includes('One point could not be read')));
  check('null value is spoken as unreadable, never skipped or zeroed', () =>
    assert.equal(
      describePoint(graph, 0, 2, res.fieldConfidence),
      'Q3, value could not be read. Point 3 of 4.',
    ));
  check('low series confidence hedges the value', () =>
    assert.ok(describePoint(graph, 0, 1, res.fieldConfidence).includes('approximately')));
  check('no unit is appended when the unit is null', () =>
    assert.equal(describePoint(graph, 0, 1, res.fieldConfidence), 'Q2, approximately 145. Point 2 of 4.'));
  check('maxIndex skips the null (Q4=210, not the null at Q3)', () =>
    assert.equal(maxIndex(series), 3));
  check('minIndex skips the null (Q1=120)', () => assert.equal(minIndex(series), 0));
  check('range ignores the null', () =>
    assert.deepEqual(valueRange(graph), { min: 120, max: 210 }));
  check('all spoken strings are clean', () =>
    everySpokenString(res).forEach((t, i) => assertSpeakable(t, `low[${i}]`)));
}

console.log('\nscenario: error (no graph at all)');
{
  const res = load('error');
  check('fixture really has no graph', () => assert.equal(res.graph, null));
  check('failure is announced', () => {
    const line = describeExtractionStatus(res);
    assert.ok(line && line.startsWith('Extraction failed.'), `got: ${line}`);
  });
  check('recovery action is spoken', () => {
    const line = describeExtractionStatus(res)!;
    assert.ok(/retake|upload/i.test(line), `got: ${line}`);
  });
  check('no confirmation prompt without fieldConfidence', () =>
    assert.equal(describeFieldsNeedingConfirmation(res.fieldConfidence), null));
  check('all spoken strings are clean', () =>
    everySpokenString(res).forEach((t, i) => assertSpeakable(t, `err[${i}]`)));
}

// ---------------------------------------------------------------------------
// Person 2's graph fixtures, copied from origin/person2-reasoning. Richer and
// more realistic than the starter fixtures: a crossing two-series graph and a
// single series with a sharp spike.
// ---------------------------------------------------------------------------

const loadLocal = (name: string): ExtractionResponse =>
  JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8')) as ExtractionResponse;

console.log("\nscenario: mobile_italy_japan (two crossing series, multi-word unit)");
{
  const res = loadLocal('mobile_italy_japan');
  const graph = res.graph as GraphData;
  const italy = graph.series[0]!;
  const japan = graph.series[1]!;

  check('12 points across two series', () => {
    assert.equal(pointCount(graph), 12);
    assert.equal(graph.series.length, 2);
  });
  check('multi-word unit passes through unmangled', () =>
    assert.equal(speakUnit('per 100 people'), 'per 100 people'));
  check('unit is spoken in the point readout', () =>
    assert.ok(describePoint(graph, 0, 0, res.fieldConfidence).includes('per 100 people')));
  check('series cross: Italy starts above Japan and ends below', () => {
    assert.ok(italy.values[0]! > japan.values[0]!);
    assert.ok(italy.values[11]! < japan.values[11]!);
  });
  check('range spans both series, not just the first', () =>
    assert.deepEqual(valueRange(graph), { min: 104, max: 169 }));
  check('per-series extremes are independent', () => {
    assert.equal(maxIndex(italy), 1);
    assert.equal(maxIndex(japan), 11);
  });
  check('all spoken strings are clean', () =>
    everySpokenString(res).forEach((t, i) => assertSpeakable(t, `mobile[${i}]`)));
}

console.log("\nscenario: unemployment_us (percent unit, sharp spike)");
{
  const res = loadLocal('unemployment_us');
  const graph = res.graph as GraphData;
  const series = graph.series[0]!;

  check('percent sign expands for TTS', () => assert.equal(speakUnit('%'), 'percent'));
  check('point readout says percent, not a bare symbol', () => {
    const line = describePoint(graph, 0, 4, res.fieldConfidence);
    assert.ok(line.includes('percent'), `got: ${line}`);
    assert.ok(!line.includes('%'), `raw % leaked: ${line}`);
  });
  check('the 2020 spike is the maximum', () => {
    assert.equal(maxIndex(series), 4);
    assert.equal(series.values[4], 8.1);
  });
  check('decimal values survive the readout', () =>
    assert.ok(describePoint(graph, 0, 7, res.fieldConfidence).includes('3.6')));
  check('single series omits the redundant name prefix', () =>
    assert.ok(describePoint(graph, 0, 0, res.fieldConfidence).startsWith('2016,')));
  check('all spoken strings are clean', () =>
    everySpokenString(res).forEach((t, i) => assertSpeakable(t, `unemp[${i}]`)));
}

// ---------------------------------------------------------------------------
// Person 2's REAL /reason output, copied from their branch's
// contracts/examples/. Guards the contract seam between their endpoint and this
// engine: if their payload shape moves, this fails here rather than on stage.
// ---------------------------------------------------------------------------

console.log("\nPerson 2's real ReasoningResponse");
{
  const reasoning = JSON.parse(
    readFileSync(join(here, 'fixtures', 'reason-unemployment.json'), 'utf8'),
  ) as ReasoningResponse;
  const graph = loadLocal('unemployment_us').graph as GraphData;
  const points = reasoning.series[0]!.points;

  check('every field this engine reads is present', () => {
    for (const key of ['overview', 'answers', 'series', 'range', 'lowConfidence', 'phrasing']) {
      assert.ok(key in reasoning, `missing top-level "${key}"`);
    }
    for (const p of points) {
      for (const key of ['index', 'x', 'value', 'normalised', 'changeStrength',
        'direction', 'isMax', 'isMin', 'isTurningPoint', 'readout']) {
        assert.ok(key in p, `point ${p.index} missing "${key}"`);
      }
    }
  });

  check('all four preset answers exist with highlight and caveats', () => {
    for (const q of ['trend', 'max', 'changes', 'compare'] as const) {
      const a = reasoning.answers[q];
      assert.ok(a, `missing answer "${q}"`);
      assert.equal(typeof a.answer, 'string');
      assert.ok(Array.isArray(a.highlight), `${q}.highlight is not an array`);
      assert.ok(Array.isArray(a.caveats), `${q}.caveats is not an array`);
    }
  });

  check('series names match the graph, so name-keyed lookup resolves', () => {
    for (const s of reasoning.series) {
      assert.ok(
        graph.series.some((g) => g.name === s.name),
        `/reason series "${s.name}" has no match in the graph`,
      );
    }
  });

  check('highlight series names resolve to a real series', () => {
    for (const q of ['trend', 'max', 'changes', 'compare'] as const) {
      for (const h of reasoning.answers[q].highlight) {
        assert.ok(
          graph.series.some((g) => g.name === h.series),
          `highlight in "${q}" names unknown series "${h.series}"`,
        );
      }
    }
  });

  check('point indices align with the graph x-axis', () =>
    points.forEach((p, i) => {
      assert.equal(p.index, i, `point ${i} has index ${p.index}`);
      assert.equal(p.x, graph.xAxis.values[i]);
      assert.equal(p.value, graph.series[0]!.values[i]);
    }));

  check('normalised stays within 0-1, so pitch mapping cannot go out of range', () =>
    points.forEach((p) => {
      if (p.normalised === null) return;
      assert.ok(p.normalised >= 0 && p.normalised <= 1, `normalised ${p.normalised}`);
    }));

  check('changeStrength stays within 0-1', () =>
    points.forEach((p) => {
      if (p.changeStrength === null) return;
      assert.ok(p.changeStrength >= 0 && p.changeStrength <= 1, `changeStrength ${p.changeStrength}`);
    }));

  check('direction is one of the four values the engine switches on', () =>
    points.forEach((p) =>
      assert.ok(['up', 'down', 'flat', 'unknown'].includes(p.direction), p.direction)));

  check('the 2020 spike is flagged isMax, which selects the double pulse', () => {
    const spike = points[4]!;
    assert.equal(spike.x, '2020');
    assert.equal(spike.isMax, true);
    assert.equal(spike.normalised, 1);
  });

  check('the 2019 trough is flagged isTurningPoint', () => {
    assert.equal(points[3]!.x, '2019');
    assert.equal(points[3]!.isTurningPoint, true);
  });

  check('every readout is speakable', () =>
    points.forEach((p) => assertSpeakable(p.readout, `readout[${p.index}]`)));

  check('overview and answers are speakable', () => {
    assertSpeakable(reasoning.overview.text, 'overview');
    for (const q of ['trend', 'max', 'changes', 'compare'] as const) {
      assertSpeakable(reasoning.answers[q].answer, q);
    }
  });
}

// ---------------------------------------------------------------------------
// Person 1's REAL capture output (docs/capture-examples/). Messier than the
// hand-written fixtures: untitled graphs, missing units, bar charts rejected.
// This is what the engine will actually be handed on the day.
// ---------------------------------------------------------------------------

console.log("\nPerson 1's real captures");
{
  const dir = join(here, '..', '..', 'docs', 'capture-examples');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

  check('capture examples are present', () => assert.ok(files.length >= 7));

  for (const file of files) {
    const res = JSON.parse(readFileSync(join(dir, file), 'utf8')) as ExtractionResponse;

    check(`${file}: every spoken string is clean`, () =>
      everySpokenString(res).forEach((t, i) => assertSpeakable(t, `${file}[${i}]`)));

    if (res.status === 'error') {
      check(`${file}: failure is spoken with a recovery action`, () => {
        const line = describeExtractionStatus(res);
        assert.ok(line, 'error status produced nothing to say');
        assert.ok(line!.startsWith('Extraction failed.'), line!);
      });
      continue;
    }

    const graph = res.graph as GraphData;

    check(`${file}: point readout matches the agreed "{x}, {value}{unit}" shape`, () => {
      const line = describePoint(graph, 0, 0, res.fieldConfidence, { includePosition: false });
      // docs/phone-demo-navigation.md 2: the x label must reach the listener,
      // because it is the only way they learn where they are.
      assert.ok(line.includes(graph.xAxis.values[0]!), `x label missing from: ${line}`);
    });

    if (graph.yAxis.unit === null || graph.yAxis.unit === undefined) {
      check(`${file}: missing unit is announced once, not repeated per point`, () => {
        assert.ok(describeGraphIntro(graph, res.fieldConfidence).includes('unit could not be read'));
        const point = describePoint(graph, 0, 0, res.fieldConfidence);
        assert.ok(!point.includes('could not be read'), `unit caveat leaked into: ${point}`);
      });
    }
  }
}

// ---------------------------------------------------------------------------

console.log('\nspoken output, for reading by eye:\n');
for (const scenario of ['ok', 'low_confidence', 'error']) {
  console.log(`--- ${scenario} ---`);
  for (const line of everySpokenString(load(scenario))) console.log(`  ${line}`);
  console.log('');
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
