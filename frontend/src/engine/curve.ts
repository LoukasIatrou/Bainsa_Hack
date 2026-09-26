// Drawing helpers for the Explore panel. The line is drawn with straight segments (round joins)
// because that is exactly the curve Person 3's guidance tests against (linear between points,
// ±6 % tolerance): a smoothed drawing would put "on the line" somewhere the engine disagrees.
// Values are normalised (0..1, y up), null = unreadable and drawn as a GAP, never bridged.

export interface PlotBox {
  left: number
  top: number
  width: number
  height: number
}

export function linePath(ys: (number | null)[], box: PlotBox): string {
  const n = ys.length
  const px = (i: number) => box.left + (n > 1 ? (i / (n - 1)) * box.width : box.width / 2)
  const py = (y: number) => box.top + (1 - y) * box.height
  let d = ''
  for (let i = 0; i < n; i++) {
    const y = ys[i]
    if (y === null || y === undefined) continue
    const prev = i > 0 ? ys[i - 1] : null
    const next = i < n - 1 ? ys[i + 1] : null
    if (prev === null || prev === undefined) {
      d += `M${px(i).toFixed(1)},${py(y).toFixed(1)}`
      // Isolated point: a tiny stub so the round cap draws it as a dot.
      if (next === null || next === undefined) d += 'h0.01'
    } else {
      d += `L${px(i).toFixed(1)},${py(y).toFixed(1)}`
    }
  }
  return d
}
