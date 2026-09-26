import { useState } from 'react'
import { extractGraph } from './api'
import { Capture } from './Capture'
import { Exploration } from './Exploration'
import { announce } from './speech'
import type { ExtractionResponse } from './types'

type AppState = 'capture' | 'processing' | 'result' | 'explore'

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

      if (response.status === 'ok') {
        announce(response.graph?.summary ?? 'Extraction complete.')
      } else if (response.status === 'low_confidence') {
        announce(`Extraction complete, but confidence is low. ${response.message ?? 'Please review the result.'}`)
      } else {
        announce(response.message ?? 'Extraction failed. Please retake the photo.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed.'
      setRequestError(message)
      announce(`Request failed. ${message}`)
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

              {result?.graph && (
                <button type="button" onClick={() => setState('explore')}>
                  Explore graph
                </button>
              )}
            </>
          )}

          <button type="button" onClick={reset}>
            Reset
          </button>
        </div>
      )}

      {state === 'explore' && result?.graph && (
        <Exploration graph={result.graph} onBack={() => setState('result')} />
      )}
    </main>
  )
}

export default App
