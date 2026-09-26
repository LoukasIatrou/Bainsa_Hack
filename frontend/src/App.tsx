import { useState } from 'react'
import { extractGraph } from './api'
import { Capture } from './Capture'
import type { ExtractionResponse } from './types'

type AppState = 'capture' | 'processing' | 'result'

function App() {
  const [state, setState] = useState<AppState>('capture')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractionResponse | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)

  async function handleCapture(image: Blob) {
    setPreviewUrl(URL.createObjectURL(image))
    setState('processing')
    setRequestError(null)

    try {
      const response = await extractGraph(image)
      setResult(response)
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Request failed.')
    } finally {
      setState('result')
    }
  }

  function reset() {
    setState('capture')
    setResult(null)
    setRequestError(null)
    setPreviewUrl(null)
  }

  return (
    <main>
      {state === 'capture' && <Capture onCapture={handleCapture} />}

      {state === 'processing' && (
        <p role="status" aria-live="polite">
          Processing image...
        </p>
      )}

      {state === 'result' && (
        <div>
          <h1>Extraction result (debug view)</h1>

          {previewUrl && <img src={previewUrl} alt="Captured graph" width={240} />}

          {requestError ? (
            <p role="alert">Request failed: {requestError}</p>
          ) : (
            <>
              <p>
                Status: <strong>{result?.status}</strong>
              </p>
              {result?.message && <p>Message: {result.message}</p>}
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </>
          )}

          <button type="button" onClick={reset}>
            Reset
          </button>
        </div>
      )}
    </main>
  )
}

export default App
