import { useEffect, useState } from 'react'
import { extractGraph, reasonGraph } from './api'
import { Capture } from './Capture'
import { ExplorePage } from './ExplorePage'
import { estimateChartAspect } from './exploreLayout'
import type { GraphSource } from './ExplorePage'
import { Exploration } from './Exploration'
import { SAVED_EXTRACTION, SAVED_REASONING } from './fixtures'
import { announce, unlockSpeech } from './speech'
import type { ExtractionResponse, GraphData, ReasoningResponse } from './types'

type AppState = 'capture' | 'processing' | 'confirm' | 'reasoning' | 'explore' | 'slider'

interface Explored {
  graph: GraphData
  reasoning: ReasoningResponse | null
  source: GraphSource
  notice: string | null
}

const SAVED: Explored = {
  graph: SAVED_EXTRACTION.graph!,
  reasoning: SAVED_REASONING,
  source: 'saved',
  notice: null,
}

// #slider opens main's slider exploration on the saved graph (backup demo path);
// #saved opens the Explore page on the saved graph, skipping the camera.
const START_HASH = window.location.hash
const START_IN_SLIDER = START_HASH === '#slider'
const START_SAVED = START_IN_SLIDER || START_HASH === '#saved'

function App() {
  const [state, setState] = useState<AppState>(START_IN_SLIDER ? 'slider' : START_SAVED ? 'explore' : 'capture')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractionResponse | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [explored, setExplored] = useState<Explored | null>(START_SAVED ? SAVED : null)

  // Mobile browsers block speech until something is spoken from a tap; unlock on the first one.
  useEffect(() => {
    const unlock = () => unlockSpeech()
    document.addEventListener('click', unlock, { capture: true, once: true })
    return () => document.removeEventListener('click', unlock, { capture: true })
  }, [])

  async function handleCapture(image: Blob) {
    setPreviewUrl(URL.createObjectURL(image))
    setState('processing')
    setRequestError(null)

    try {
      const response = await extractGraph(image)
      setResult(response)

      if (response.graph && response.status !== 'error') {
        const g = response.graph
        const low = response.status === 'low_confidence' ? ' Some parts are unclear.' : ''
        announce(`Found a line graph: ${g.title}. ${g.xAxis.values.length} points.${low} Looks right, or retake?`)
      } else {
        announce(response.message ?? 'Could not read a graph. Please retake the photo.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed.'
      setRequestError(message)
      announce('Request failed. Please retake.')
    } finally {
      setState('confirm')
    }
  }

  async function confirm() {
    if (!result?.graph) return
    announce('Reading the graph.')
    setState('reasoning')
    const graph = result.graph
    try {
      const reasoning = await reasonGraph(graph, result.fieldConfidence, estimateChartAspect())
      setExplored({ graph, reasoning, source: 'live', notice: null })
    } catch {
      // Exploring still works on the extracted values; only the wording is missing.
      setExplored({ graph, reasoning: null, source: 'live', notice: 'Reasoning unavailable.' })
    }
    setState('explore')
  }

  function openSaved() {
    setExplored(SAVED)
    setState('explore')
  }

  function reset() {
    setState('capture')
    setResult(null)
    setRequestError(null)
    setPreviewUrl(null)
    setExplored(null)
    if (window.location.hash) history.replaceState(null, '', window.location.pathname)
  }

  const graphOk = !requestError && result?.graph && result.status !== 'error'

  return (
    <main>
      {state === 'capture' && (
        <div className="capture-screen">
          <Capture onCapture={handleCapture} />
          <button type="button" className="saved-graph-button" onClick={openSaved}>
            Use saved graph
          </button>
        </div>
      )}

      {state === 'processing' && (
        <p role="status" aria-live="polite">
          Processing image...
        </p>
      )}

      {state === 'reasoning' && (
        <p role="status" aria-live="polite">
          Reading the graph...
        </p>
      )}

      {state === 'confirm' && (
        <div className="confirm-screen">
          {previewUrl && <img src={previewUrl} alt="Captured graph" width={240} />}

          {requestError ? (
            <p role="alert">Request failed: {requestError}</p>
          ) : graphOk && result?.graph ? (
            <>
              <h1>{result.graph.title}</h1>
              <p>
                Line graph, {result.graph.xAxis.values.length} points
                {result.status === 'low_confidence' && <strong> - low confidence</strong>}
              </p>
              {result.message && <p>{result.message}</p>}
            </>
          ) : (
            <p role="alert">{result?.message ?? 'Could not read a graph.'}</p>
          )}

          <div className="confirm-actions">
            {graphOk && (
              <button type="button" className="confirm-primary" onClick={confirm}>
                Looks right
              </button>
            )}
            <button type="button" onClick={reset}>
              Retake
            </button>
          </div>

          <details className="confirm-debug">
            <summary>debug</summary>
            <p>
              Status: <strong>{result?.status ?? 'none'}</strong>
            </p>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}

      {state === 'explore' && explored && (
        <ExplorePage
          graph={explored.graph}
          reasoning={explored.reasoning}
          source={explored.source}
          notice={explored.notice}
          onReset={reset}
          onSliderMode={() => setState('slider')}
        />
      )}

      {state === 'slider' && explored && <Exploration graph={explored.graph} onBack={() => setState('explore')} />}
    </main>
  )
}

export default App
