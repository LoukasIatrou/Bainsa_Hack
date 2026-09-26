import type { ExtractionResponse, FieldConfidence, GraphData, ReasoningResponse } from './types'

// Same-origin path - Vite's dev proxy forwards this to the FastAPI backend.
// See vite.config.ts.
export async function extractGraph(image: Blob): Promise<ExtractionResponse> {
  const body = new FormData()
  body.append('image', image, 'capture.jpg')

  const res = await fetch('/api/extract', { method: 'POST', body })
  if (!res.ok) {
    throw new Error(`Extraction request failed: ${res.status}`)
  }
  return res.json()
}

// Person 2's reasoning layer. chartAspect = drawn plot height / width, so slope wording
// ("steep", "gentle") matches what the user feels on screen.
export async function reasonGraph(
  graph: GraphData,
  fieldConfidence: FieldConfidence | null,
  chartAspect: number | null,
): Promise<ReasoningResponse> {
  const res = await fetch('/api/reason', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph, fieldConfidence, chartAspect }),
  })
  if (!res.ok) {
    throw new Error(`Reasoning request failed: ${res.status}`)
  }
  return res.json()
}
