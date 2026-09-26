// Pure state logic for the spider-sense circle. No React, no DOM - so audio/haptics can drive
// the same state machine later without going through the visual component.
//
// Coordinates are screen pixels (y grows downward). Angles are radians in the same screen
// convention: 0 = right, +PI/2 = down, -PI/2 = up.

export interface Point {
  x: number
  y: number
}

// A curve is a dense polyline, ordered by increasing x. Building it from y = f(x) is the current
// base case, but extracted series data can produce the same shape later.
export interface Curve {
  points: Point[]
}

export interface Box {
  width: number
  height: number
  padding: number
}

// Extension point: a 'lost' phase (recovering the curve during Overview/Explain) is planned but
// intentionally not implemented. Add it here, then handle it in stepSpiderSense's switch.
export type Phase = 'searching' | 'on-curve'

export interface SpiderSenseState {
  phase: Phase
  // Current finger position, or null when nothing is touching.
  pointer: Point | null
  // Exact point where the curve was last inside the circle. Null until first contact.
  lastContact: Point | null
  // Where the direction is currently pointing at (curve point, or remembered contact).
  target: Point | null
  // Pixel distance from pointer to target. Drives the pulse.
  distance: number | null
  // Pointing direction (screen radians), or null when there is no pointer.
  angle: number | null
}

export const INITIAL_STATE: SpiderSenseState = {
  phase: 'searching',
  pointer: null,
  lastContact: null,
  target: null,
  distance: null,
  angle: null,
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

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export interface NearestResult {
  point: Point
  distance: number
  segment: number
}

export function nearestCurvePoint(curve: Curve, p: Point): NearestResult {
  const pts = curve.points
  let best: NearestResult = { point: pts[0], distance: dist(pts[0], p), segment: 0 }
  for (let i = 0; i < pts.length - 1; i++) {
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

// Advance the state machine for a new pointer position (or null = finger lifted).
export function stepSpiderSense(
  prev: SpiderSenseState,
  pointer: Point | null,
  curve: Curve,
  radius: number,
): SpiderSenseState {
  if (pointer === null) {
    // Lifting the finger ends contact but keeps the memory, so the next touch has to come back
    // to lastContact - otherwise touching down elsewhere on the curve would skip points.
    return { ...prev, phase: 'searching', pointer: null, target: null, distance: null, angle: null }
  }

  const nearest = nearestCurvePoint(curve, pointer)
  const curveInside = nearest.distance <= radius

  const onCurve = (): SpiderSenseState => ({
    phase: 'on-curve',
    pointer,
    lastContact: nearest.point,
    target: nearest.point,
    distance: nearest.distance,
    angle: tangentAngle(curve, nearest.segment),
  })

  switch (prev.phase) {
    case 'on-curve':
      if (curveInside) return onCurve()
      return towardContact(prev.lastContact ?? nearest.point, pointer)

    case 'searching': {
      if (prev.lastContact === null) {
        if (curveInside) return onCurve()
        // Never touched yet: straight up or down toward the curve only.
        const targetY = curveYAt(curve, pointer.x)
        return {
          ...prev,
          pointer,
          target: { x: pointer.x, y: targetY },
          distance: Math.abs(targetY - pointer.y),
          angle: targetY < pointer.y ? -Math.PI / 2 : Math.PI / 2,
        }
      }
      // Re-acquire only at the remembered point, not anywhere on the curve.
      // (lastContact lies on the curve, so being this close implies the curve is inside.)
      if (dist(pointer, prev.lastContact) <= radius) return onCurve()
      return towardContact(prev.lastContact, pointer)
    }

    default: {
      const unhandled: never = prev.phase
      throw new Error(`Unhandled spider-sense phase: ${String(unhandled)}`)
    }
  }
}

function towardContact(contact: Point, pointer: Point): SpiderSenseState {
  return {
    phase: 'searching',
    pointer,
    lastContact: contact,
    target: contact,
    distance: dist(pointer, contact),
    angle: Math.atan2(contact.y - pointer.y, contact.x - pointer.x),
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
