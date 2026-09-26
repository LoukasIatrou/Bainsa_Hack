import type { ExtractionResponse } from './types'

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
