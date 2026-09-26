// The graph's line for the Explore panel and the spider-sense ring: straight segments between the
// real data points, exactly like the photographed graph (sharp corners at each point, nothing
// rounded or invented). Sampled densely so the ring's "segments" measure distance along the line.
// Unreadable values (null) split the line into separate runs - drawn as gaps, never bridged.
// Input values are normalised (0..1, y up); output points are panel px (y down).

import type { Curve, Point } from '../spiderSense/logic'
import type { PlotBox } from './curve'

// Spacing of the samples along each segment, in px.
const STEP = 4

export function lineRuns(ys: (number | null)[], box: PlotBox): Point[][] {
  const n = ys.length
  const px = (i: number) => box.left + (n > 1 ? i / (n - 1) : 0.5) * box.width
  const py = (y: number) => box.top + (1 - y) * box.height

  const runs: Point[][] = []
  let current: Point[] = []
  ys.forEach((y, i) => {
    if (y === null || y === undefined) {
      if (current.length) runs.push(current)
      current = []
      return
    }
    const p = { x: px(i), y: py(y) }
    const prev = current[current.length - 1]
    if (prev) {
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / STEP))
      for (let s = 1; s < steps; s++) {
        current.push({ x: prev.x + ((p.x - prev.x) * s) / steps, y: prev.y + ((p.y - prev.y) * s) / steps })
      }
    }
    current.push(p)
  })
  if (current.length) runs.push(current)
  return runs
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
