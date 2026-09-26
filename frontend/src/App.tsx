import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { extractGraph, reasonGraph } from './api'
import { Capture } from './Capture'
import { engine } from './engine'
import { describeExtractionStatus, describeFieldsNeedingConfirmation } from './engine/phrasing'
import { ExplorePage } from './ExplorePage'
import type { GraphSource } from './ExplorePage'
import { Exploration } from './Exploration'
import { SAVED_EXTRACTION, SAVED_REASONING } from './fixtures'
import type { ExtractionResponse, FieldConfidence, GraphData, ReasoningResponse } from './types'

type AppState = 'capture' | 'processing' | 'confirm' | 'explore' | 'slider'

interface Explored {
  graph: GraphData
  fieldConfidence: FieldConfidence | null
  reasoning: ReasoningResponse | null
  fetchReasoning?: (chartAspect: number) => Promise<ReasoningResponse>
  source: GraphSource
  // Remount key, so each new graph starts a fresh Explore page.
  id: number
}

const SAVED: Explored = {
  graph: SAVED_EXTRACTION.graph!,
  fieldConfidence: SAVED_EXTRACTION.fieldConfidence ?? null,
  reasoning: SAVED_REASONING,
  source: 'saved',
  id: 0,
}

// #saved opens Explore on the bundled graph (no camera/backend); #slider opens the old slider page.
const START_HASH = window.location.hash
const START_IN_SLIDER = START_HASH === '#slider'
const START_SAVED = START_IN_SLIDER || START_HASH === '#saved'

// What the confirm screen says: Person 3's status + unclear-fields wording, then the choice.
function confirmSpeech(result: ExtractionResponse): string {
  const status = describeExtractionStatus(result)
  if (result.status === 'error' || !result.graph) {
    return `${status ?? 'No graph could be read.'} Tap Retake to try again.`
  }
  const g = result.graph
  const lines = g.series.length > 1 ? `, ${g.series.length} lines` : ''
  const found = `Found a line graph: ${g.title}, ${g.xAxis.values.length} points${lines}.`
  const fields = result.status === 'low_confidence' ? describeFieldsNeedingConfirmation(result.fieldConfidence) : null
  return [found, status, fields, 'Looks right, or retake?'].filter(Boolean).join(' ')
}

function App() {
  const [state, setState] = useState<AppState>(START_IN_SLIDER ? 'slider' : START_SAVED ? 'explore' : 'capture')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractionResponse | null>(null)
  const [source, setSource] = useState<GraphSource>('live')
  const [requestError, setRequestError] = useState<string | null>(null)
  const [explored, setExplored] = useState<Explored | null>(START_SAVED ? SAVED : null)

  // Mobile browsers block speech until something is spoken from a gesture; unlock on the first one.
  useEffect(() => {
    const unlock = () => void engine.unlock()
    document.addEventListener('pointerdown', unlock, { capture: true, once: true })
    return () => document.removeEventListener('pointerdown', unlock, { capture: true })
  }, [])

  async function handleCapture(image: Blob, from: GraphSource) {
    setSource(from)
    setPreviewUrl(URL.createObjectURL(image))
    setState('processing')
    setRequestError(null)
    setResult(null)
    if (from === 'controlled') engine.speech.speak('Image uploaded. Processing.', 'interrupt')
    try {
      const response = await extractGraph(image)
      setResult(response)
      engine.speech.speak(confirmSpeech(response), 'interrupt')
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Request failed.')
      engine.speech.speak('The request failed. Tap Retake to try again.', 'interrupt')
    } finally {
      setState('confirm')
    }
  }

  const graphOk = !requestError && !!result?.graph && result.status !== 'error'

  function confirm() {
    if (!result?.graph || !graphOk) return
    const graph = result.graph
    const fieldConfidence = result.fieldConfidence ?? null
    setExplored({
      graph,
      fieldConfidence,
      reasoning: null,
      fetchReasoning: (chartAspect) => reasonGraph(graph, fieldConfidence, chartAspect),
      source,
      id: Date.now(),
    })
    setState('explore')
  }

  function openSaved() {
    setExplored({ ...SAVED, id: Date.now() })
    setState('explore')
  }

  function reset() {
    engine.stopAll()
    setState('capture')
    setResult(null)
    setRequestError(null)
    setPreviewUrl(null)
    setExplored(null)
    if (window.location.hash) history.replaceState(null, '', window.location.pathname)
    engine.speech.speak('Camera. Tap anywhere to take a photo.', 'interrupt')
  }

  function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void handleCapture(file, 'controlled')
  }

  return (
    <main>
      {state === 'capture' && (
        <div className="capture-screen">
          <Capture onCapture={(blob) => handleCapture(blob, 'live')} />
          <div className="capture-extras">
            <label className="capture-extras__link">
              Upload image (Controlled mode)
              <input type="file" accept="image/*" onChange={onUpload} data-testid="upload" />
            </label>
            <button type="button" className="capture-extras__link" onClick={openSaved}>
              Use saved graph
            </button>
          </div>
        </div>
      )}

      {state === 'processing' && (
        <div className="plain-screen">
          <p role="status" aria-live="polite">
            Processing image…
          </p>
        </div>
      )}

      {state === 'confirm' && (
        <div className="plain-screen confirm-screen" data-testid="confirm">
          {previewUrl && <img src={previewUrl} alt="" className="confirm-screen__preview" />}
          <div className="confirm-screen__body">
            {requestError ? (
              <p role="alert">Request failed: {requestError}</p>
            ) : graphOk && result?.graph ? (
              <>
                <h1>{result.graph.title}</h1>
                <p>
                  Line graph · {result.graph.xAxis.values.length} points · {result.graph.series.length} line
                  {result.graph.series.length > 1 ? 's' : ''} · {source === 'controlled' ? 'Controlled' : 'Live'}
                  {result.status === 'low_confidence' && <strong> · low confidence</strong>}
                </p>
                {result.status === 'low_confidence' && (
                  <p className="confirm-screen__warn">
                    {describeExtractionStatus(result)} {describeFieldsNeedingConfirmation(result.fieldConfidence)}
                  </p>
                )}
              </>
            ) : (
              <p role="alert">{result ? describeExtractionStatus(result) : 'Could not read a graph.'}</p>
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
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </details>
          </div>
        </div>
      )}

      {state === 'explore' && explored && (
        <ExplorePage
          key={explored.id}
          graph={explored.graph}
          fieldConfidence={explored.fieldConfidence}
          reasoning={explored.reasoning}
          fetchReasoning={explored.fetchReasoning}
          source={explored.source}
          onReset={reset}
          onSliderMode={() => setState('slider')}
        />
      )}

      {state === 'slider' && explored && <Exploration graph={explored.graph} onBack={() => setState('explore')} />}
    </main>
  )
}

export default App
