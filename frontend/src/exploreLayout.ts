// Explore page layout numbers, shared with App so /reason gets the chart aspect before the page
// is on screen. Keep in sync with .explore-* in index.css.

// Plot padding inside the SVG (room for axis labels), in px.
export const PADDING = 44
const GRAPH_WIDTH_SHARE = 0.7
const CAPTION_HEIGHT = 56

// Plot height / width as it will be drawn, for /reason's slope wording.
export function estimateChartAspect(): number {
  const w = window.innerWidth * GRAPH_WIDTH_SHARE - 2 * PADDING
  const h = window.innerHeight - CAPTION_HEIGHT - 2 * PADDING
  return w > 0 && h > 0 ? h / w : 0.6
}
