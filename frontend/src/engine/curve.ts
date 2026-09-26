// Monotone cubic interpolation (the d3 curveMonotoneX slope rule): passes exactly through every
// data point and never overshoots between them. Shared by the drawing and the local engine's
// on-curve test, so "on the line" means the line the user sees.
//
// Values are normalised (0..1) per x index, null = unreadable. Segments only exist between two
// consecutive readable points: a null is a GAP, never bridged.

function sign(x: number): number {
  return x < 0 ? -1 : 1
}

// Tangent (dy per x step) at each readable point, computed within its run of readable points.
export function monotoneTangents(ys: (number | null)[]): (number | null)[] {
  const n = ys.length
  const m: (number | null)[] = new Array(n).fill(null)
  const slope = (k: number): number | null => {
    const a = ys[k]
    const b = ys[k + 1]
    return a === null || a === undefined || b === null || b === undefined ? null : b - a
  }
  for (let k = 0; k < n; k++) {
    if (ys[k] === null) continue
    const s0 = k > 0 ? slope(k - 1) : null
    const s1 = k < n - 1 ? slope(k) : null
    if (s0 !== null && s1 !== null) {
      const p = (s0 + s1) / 2
      m[k] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
    }
  }
  // Run ends: d3's one-sided rule, from the neighbouring interior tangent.
  for (let k = 0; k < n; k++) {
    if (ys[k] === null || m[k] !== null) continue
    const s0 = k > 0 ? slope(k - 1) : null
    const s1 = k < n - 1 ? slope(k) : null
    if (s1 !== null) m[k] = m[k + 1] !== null ? (3 * s1 - (m[k + 1] as number)) / 2 : s1
    else if (s0 !== null) m[k] = m[k - 1] !== null ? (3 * s0 - (m[k - 1] as number)) / 2 : s0
    else m[k] = 0
  }
  return m
}

// Curve height at normalised x (0..1), or null over a gap. Near an isolated or edge-of-gap point
// (within a quarter step) its own value counts, so the ends of a drawn segment stay reachable.
export function curveAt(ys: (number | null)[], m: (number | null)[], x: number): number | null {
  const n = ys.length
  if (n === 0) return null
  if (n === 1) return ys[0] ?? null
  const pos = Math.min(Math.max(0, x), 1) * (n - 1)
  const i = Math.min(n - 2, Math.floor(pos))
  const t = pos - i
  const y0 = ys[i]
  const y1 = ys[i + 1]
  if (y0 !== null && y0 !== undefined && y1 !== null && y1 !== undefined) {
    const m0 = m[i] ?? 0
    const m1 = m[i + 1] ?? 0
    const t2 = t * t
    const t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1
  }
  if (t <= 0.25 && y0 !== null && y0 !== undefined) return y0
  if (t >= 0.75 && y1 !== null && y1 !== undefined) return y1
  return null
}

export interface PlotBox {
  left: number
  top: number
  width: number
  height: number
}

// SVG path for one series, one sub-path per run of readable points (gaps stay open).
export function monotonePath(ys: (number | null)[], box: PlotBox): string {
  const n = ys.length
  const m = monotoneTangents(ys)
  const step = n > 1 ? box.width / (n - 1) : 0
  const px = (i: number) => box.left + (n > 1 ? i * step : box.width / 2)
  const py = (y: number) => box.top + (1 - y) * box.height
  let d = ''
  for (let i = 0; i < n; i++) {
    const y = ys[i]
    if (y === null || y === undefined) continue
    const prev = i > 0 ? ys[i - 1] : null
    if (prev === null || prev === undefined) {
      d += `M${px(i).toFixed(1)},${py(y).toFixed(1)}`
      const next = i < n - 1 ? ys[i + 1] : null
      // Isolated point: a tiny stub so round caps draw it as a dot.
      if (next === null || next === undefined) d += `h0.01`
      continue
    }
    const m0 = m[i - 1] ?? 0
    const m1 = m[i] ?? 0
    const x0 = px(i - 1)
    const x1 = px(i)
    const c1x = x0 + step / 3
    const c1y = py(prev) - (m0 / 3) * box.height
    const c2x = x1 - step / 3
    const c2y = py(y) + (m1 / 3) * box.height
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x1.toFixed(1)},${py(y).toFixed(1)}`
  }
  return d
}
