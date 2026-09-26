// Smooth line through the real data, for the Explore panel and the spider-sense ring.
//
// Monotone cubic (Fritsch-Carlson) between the readable points, sampled densely: smooth like the
// harness curve Haris liked, but it passes exactly through every data value and never overshoots
// between two of them, so the drawing never suggests a value the graph doesn't have. Unreadable
// values (null) split the line into separate runs - drawn as gaps, never bridged.
// Input values are normalised (0..1, y up); output points are panel px (y down).

import type { Curve, Point } from '../spiderSense/logic'
import type { PlotBox } from './curve'

const SAMPLES_PER_SEGMENT = 24

export function smoothRuns(ys: (number | null)[], box: PlotBox): Point[][] {
  const n = ys.length
  const px = (i: number) => box.left + (n > 1 ? i / (n - 1) : 0.5) * box.width
  const py = (y: number) => box.top + (1 - y) * box.height

  const runs: { i: number; y: number }[][] = []
  let current: { i: number; y: number }[] = []
  ys.forEach((y, i) => {
    if (y === null || y === undefined) {
      if (current.length) runs.push(current)
      current = []
    } else current.push({ i, y })
  })
  if (current.length) runs.push(current)

  return runs.map((run) => {
    const xs = run.map((p) => px(p.i))
    const vs = run.map((p) => py(p.y))
    const m = run.length
    if (m === 1) return [{ x: xs[0], y: vs[0] }]

    // Secant slopes, then tangents limited so no segment overshoots its end values.
    const d: number[] = []
    for (let k = 0; k < m - 1; k++) d.push((vs[k + 1] - vs[k]) / (xs[k + 1] - xs[k]))
    const t: number[] = new Array<number>(m)
    t[0] = d[0]
    t[m - 1] = d[m - 2]
    for (let k = 1; k < m - 1; k++) t[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2
    for (let k = 0; k < m - 1; k++) {
      if (d[k] === 0) {
        t[k] = 0
        t[k + 1] = 0
        continue
      }
      const a = t[k] / d[k]
      const b = t[k + 1] / d[k]
      const s = a * a + b * b
      if (s > 9) {
        const tau = 3 / Math.sqrt(s)
        t[k] = tau * a * d[k]
        t[k + 1] = tau * b * d[k]
      }
    }

    const out: Point[] = []
    for (let k = 0; k < m - 1; k++) {
      const h = xs[k + 1] - xs[k]
      for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
        const u = s / SAMPLES_PER_SEGMENT
        const h00 = 2 * u ** 3 - 3 * u ** 2 + 1
        const h10 = u ** 3 - 2 * u ** 2 + u
        const h01 = -2 * u ** 3 + 3 * u ** 2
        const h11 = u ** 3 - u ** 2
        out.push({ x: xs[k] + u * h, y: h00 * vs[k] + h10 * h * t[k] + h01 * vs[k + 1] + h11 * h * t[k + 1] })
      }
    }
    out.push({ x: xs[m - 1], y: vs[m - 1] })
    return out
  })
}

export function runsPath(runs: Point[][]): string {
  return runs
    .map((run) =>
      run.length === 1
        ? `M${run[0].x.toFixed(1)},${run[0].y.toFixed(1)}h0.01`
        : run.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(''),
    )
    .join(' ')
}

// One polyline for the spider-sense logic. Runs are joined here (the ring can follow across a
// gap); the drawing still shows the gap and the engine announces the unreadable point.
export function runsCurve(runs: Point[][]): Curve {
  const points = runs.flat()
  if (points.length === 1) points.push({ ...points[0] })
  return { points }
}
