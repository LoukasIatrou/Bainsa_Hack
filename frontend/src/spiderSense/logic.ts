// Pure state logic for the spider-sense circle. No React, no DOM - so audio/haptics can drive
// the same state machine later without going through the visual component.
//
// Coordinates are screen pixels (y grows downward). Angles are radians in the same screen
// convention: 0 = right, +PI/2 = down, -PI/2 = up.

export interface Point {
  x: number
  y: number
}

// A curve is a dense polyline, ordered by increasing x. Building it from y = f(x) is the demo
// case; buildCurveFromPoints builds the same shape from extracted series data.
export interface Curve {
  points: Point[]
  // Data points the curve was built from (buildCurveFromPoints only). `pos` is the index into
  // `points` where that data point sits; `index` is its index into xAxis.values.
  vertices?: CurveVertex[]
}

export interface CurveVertex {
  index: number
  pos: number
  point: Point
}

export interface Box {
  width: number
  height: number
  padding: number
}

// Extension point: a 'lost' phase (recovering the curve during Overview/Explain) is planned but
// intentionally not implemented. Add it here, then handle it in stepSpiderSense.
export type Phase = 'searching' | 'on-curve'

// 'free': off the line, point at the nearest part of it. 'guided' (a goal is set, e.g. Overview
// or Next point): off the line, point back to where the finger left it, so no stretch is skipped.
export type Mode = 'free' | 'guided'

export interface SpiderSenseState {
  phase: Phase
  mode: Mode
  // Current finger position, or null when nothing is touching.
  pointer: Point | null
  // Exact point where the curve was last inside the circle. Null until first contact.
  lastContact: Point | null
  // Curve segment of lastContact. The on-curve search stays near it so a spike's two sides
  // (both inside the circle near the tip) don't make the contact jump across.
  segment: number | null
  // Where the direction is currently pointing at (curve point, remembered contact, or goal).
  target: Point | null
  // Pixel distance from pointer to target. Drives the pulse.
  distance: number | null
  // Pointing direction (screen radians), or null when there is no pointer or nowhere to go
  // (end of the line in free mode, or goal reached).
  angle: number | null
  // On the line at one of its ends.
  atEnd: 'start' | 'end' | null
  // A goal is set and the finger's contact point is on it.
  goalReached: boolean
}

export const INITIAL_STATE: SpiderSenseState = {
  phase: 'searching',
  mode: 'free',
  pointer: null,
  lastContact: null,
  segment: null,
  target: null,
  distance: null,
  angle: null,
  atEnd: null,
  goalReached: false,
}

export function buildCurve(
  f: (x: number) => number,
  domain: [number, number],
  range: [number, number],
  box: Box,
  samples = 600,
): Curve {
  const [x0, x1] = domain
  const [y0, y1] = range
  const innerW = box.width - 2 * box.padding
  const innerH = box.height - 2 * box.padding
  const points: Point[] = []
  for (let i = 0; i <= samples; i++) {
    const x = x0 + ((x1 - x0) * i) / samples
    const y = f(x)
    points.push({
      x: box.padding + ((x - x0) / (x1 - x0)) * innerW,
      y: box.padding + (1 - (y - y0) / (y1 - y0)) * innerH,
    })
  }
  return { points }
}

// Spacing (screen px) of the resampled polyline. Small enough that "segments" measure arc length.
const RESAMPLE_STEP = 4

// Straight lines between data points, resampled densely. Uses the series' own min/max for the
// vertical scale (a flat series sits mid-height).
// TODO: null values are bridged (skipped) for now; they should become visible gaps that the
// circle announces rather than silently joins.
export function buildCurveFromPoints(values: (number | null)[], box: Box): Curve {
  const innerW = box.width - 2 * box.padding
  const innerH = box.height - 2 * box.padding
  const known = values.filter((v): v is number => v !== null)
  const min = Math.min(...known)
  const max = Math.max(...known)
  const n = values.length
  const data: { index: number; point: Point }[] = []
  values.forEach((v, i) => {
    if (v === null) return
    const norm = max === min ? 0.5 : (v - min) / (max - min)
    data.push({
      index: i,
      point: {
        x: box.padding + (n > 1 ? i / (n - 1) : 0.5) * innerW,
        y: box.padding + (1 - norm) * innerH,
      },
    })
  })
  const points: Point[] = []
  const vertices: CurveVertex[] = []
  data.forEach((d, k) => {
    if (k > 0) {
      const a = data[k - 1].point
      const b = d.point
      const steps = Math.max(1, Math.ceil(dist(a, b) / RESAMPLE_STEP))
      for (let s = 1; s < steps; s++) {
        points.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps })
      }
    }
    vertices.push({ index: d.index, pos: points.length, point: d.point })
    points.push(d.point)
  })
  // A single point still needs a segment for the tangent/nearest maths.
  if (points.length === 1) points.push({ ...points[0] })
  return { points, vertices }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export interface NearestResult {
  point: Point
  distance: number
  segment: number
}

// Nearest point on the curve. With `around`/`window`, only segments within `window` of segment
// `around` are searched (local tracking while the finger stays on the line).
export function nearestCurvePoint(curve: Curve, p: Point, around?: number, window?: number): NearestResult {
  const pts = curve.points
  const local = around !== undefined && window !== undefined
  const lo = local ? Math.max(0, around - window) : 0
  const hi = local ? Math.min(pts.length - 2, around + window) : pts.length - 2
  let best: NearestResult = { point: pts[lo], distance: dist(pts[lo], p), segment: lo }
  for (let i = lo; i <= hi; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    const q = { x: a.x + t * dx, y: a.y + t * dy }
    const d = dist(q, p)
    if (d < best.distance) best = { point: q, distance: d, segment: i }
  }
  return best
}

// Direction the curve is heading at a segment, oriented toward increasing x. Full 360°, so a
// steep climb points up and a steep drop points down.
export function tangentAngle(curve: Curve, segment: number): number {
  const pts = curve.points
  const i = Math.max(0, Math.min(pts.length - 2, segment))
  const a = pts[i]
  const b = pts[i + 1]
  return Math.atan2(b.y - a.y, b.x - a.x)
}

// Curve height at a given screen x (clamped to the curve's ends). Used for the initial
// up/down-only search.
export function curveYAt(curve: Curve, x: number): number {
  const pts = curve.points
  if (x <= pts[0].x) return pts[0].y
  const last = pts[pts.length - 1]
  if (x >= last.x) return last.y
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
      return a.y + t * (b.y - a.y)
    }
  }
  return last.y
}

export interface StepOptions {
  // A goal on the curve (Overview start, next interest point). Switches to guided mode.
  guideTo?: Point | null
  // Where the line must first be picked up. Until then the ring points here, and touching the
  // line anywhere else doesn't count - so exploring always starts from the start.
  startAt?: Point | null
}

// Contact within this fraction of the radius from the goal counts as arrived.
const GOAL_REACH = 0.3
// Within this many px of a curve end counts as "at the end".
const END_REACH = 6

// Advance the state machine for a new pointer position (or null = finger lifted).
export function stepSpiderSense(
  prev: SpiderSenseState,
  pointer: Point | null,
  curve: Curve,
  radius: number,
  options: StepOptions = {},
): SpiderSenseState {
  const goal = options.guideTo ?? null
  const mode: Mode = goal ? 'guided' : 'free'

  if (pointer === null) {
    // Lifting the finger ends contact but keeps the memory, so the next touch has to come back
    // to lastContact - otherwise touching down elsewhere on the curve would skip points.
    return { ...prev, mode, phase: 'searching', pointer: null, target: null, distance: null, angle: null, atEnd: null }
  }

  const pts = curve.points
  const first = pts[0]
  const last = pts[pts.length - 1]
  // Local window: about one circle's worth of arc either side of the last contact.
  const window = Math.ceil(radius / RESAMPLE_STEP) + 2
  const local = prev.phase === 'on-curve' && prev.segment !== null
  const nearest = local ? nearestCurvePoint(curve, pointer, prev.segment!, window) : nearestCurvePoint(curve, pointer)
  const curveInside = nearest.distance <= radius

  const onCurve = (hit: NearestResult): SpiderSenseState => {
    const atEnd = dist(hit.point, first) <= END_REACH ? 'start' : dist(hit.point, last) <= END_REACH ? 'end' : null
    let angle: number | null = tangentAngle(curve, hit.segment)
    let goalReached = false
    if (goal) {
      if (dist(hit.point, goal) <= radius * GOAL_REACH) {
        goalReached = true
        angle = null
      } else {
        // Along the line toward the goal, which may mean backwards.
        const goalSeg = nearestCurvePoint(curve, goal).segment
        if (goalSeg < hit.segment) angle += Math.PI
        else if (goalSeg === hit.segment) angle = Math.atan2(goal.y - hit.point.y, goal.x - hit.point.x)
      }
    } else if (atEnd === 'end') {
      // Nothing further right: don't point off the graph.
      angle = null
    }
    return {
      phase: 'on-curve',
      mode,
      pointer,
      lastContact: hit.point,
      segment: hit.segment,
      target: hit.point,
      distance: hit.distance,
      angle,
      atEnd,
      goalReached,
    }
  }

  const start = options.startAt ?? null
  if (start && prev.lastContact === null) {
    if (dist(pointer, start) <= radius) return onCurve(nearestCurvePoint(curve, pointer, 0, window))
    return toward(start, pointer, prev, mode)
  }

  if (curveInside && (local || prev.lastContact === null)) return onCurve(nearest)

  // Off the line, or never on it yet.
  if (prev.lastContact === null) {
    if (goal) return toward(goal, pointer, prev, mode)
    // Never touched yet: straight up or down toward the curve, clamped to its x-range.
    const targetX = Math.max(first.x, Math.min(last.x, pointer.x))
    return toward({ x: targetX, y: curveYAt(curve, targetX) }, pointer, prev, mode)
  }

  if (mode === 'guided') {
    // Re-acquire only at the remembered point, not anywhere on the curve.
    // (lastContact lies on the curve, so being this close implies the curve is inside.)
    if (dist(pointer, prev.lastContact) <= radius) {
      return onCurve(nearestCurvePoint(curve, pointer, prev.segment ?? 0, window))
    }
    return toward(prev.lastContact, pointer, prev, mode)
  }

  // Free: the nearest part of the line.
  const global = local ? nearestCurvePoint(curve, pointer) : nearest
  if (global.distance <= radius) return onCurve(global)
  return toward(global.point, pointer, prev, mode)
}

function toward(target: Point, pointer: Point, prev: SpiderSenseState, mode: Mode): SpiderSenseState {
  return {
    ...prev,
    phase: 'searching',
    mode,
    pointer,
    target,
    distance: dist(pointer, target),
    angle: Math.atan2(target.y - pointer.y, target.x - pointer.x),
    atEnd: null,
    goalReached: false,
  }
}

// Tick length weights around the circumference: 1 in the pointing direction, falling off as
// cos^3 of the angular distance, 0 on the far half.
export function tickWeights(angle: number, count = 32): number[] {
  const weights: number[] = []
  for (let i = 0; i < count; i++) {
    const tickAngle = (i / count) * 2 * Math.PI
    const c = Math.cos(tickAngle - angle)
    weights.push(c > 0 ? c * c * c : 0)
  }
  return weights
}
