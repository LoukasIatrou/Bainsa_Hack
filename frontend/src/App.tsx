import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { extractGraph, reasonGraph } from './api'
import { Capture } from './Capture'
import { describeExtractionStatus, describeFieldsNeedingConfirmation, engine } from './engine'
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
  // Spoken before the title on arrival (e.g. a low-confidence warning).
  notice?: string
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

const SOURCE_TEXT: Record<GraphSource, string> = {
  live: 'live capture',
  controlled: 'uploaded image',
  saved: 'cached extraction',
}
const FIELD_LABELS: [keyof FieldConfidence, string][] = [
  ['graphType', 'Graph type'],
  ['title', 'Title'],
  ['xAxis', 'X axis'],
  ['yAxis', 'Y axis'],
  ['series', 'Values'],
]
// Same threshold as extraction and /reason: below this a field needs the user's attention.
const LOW = 0.6

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
      if (response.graph && response.status !== 'error') {
        // Straight to the graph; low confidence is said once there instead of a confirm step.
        const graph = response.graph
        const fieldConfidence = response.fieldConfidence ?? null
        const notice = response.status === 'low_confidence' ? `${describeExtractionStatus(response) ?? 'Some values may be approximate.'} ` : ''
        setExplored({
          graph,
          fieldConfidence,
          reasoning: null,
          fetchReasoning: (chartAspect) => reasonGraph(graph, fieldConfidence, chartAspect),
          source: from,
          notice,
          id: Date.now(),
        })
        setState('explore')
        return
      }
      engine.speech.speak(confirmSpeech(response), 'interrupt')
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Request failed.')
      engine.speech.speak('The request failed. Tap Retake to try again.', 'interrupt')
    }
    setState('confirm')
  }

  const graphOk = !requestError && !!result?.graph && result.status !== 'error'

  function confirm() {
    if (!result?.graph || !graphOk) return
    if (source === 'saved') {
      setExplored({ ...SAVED, id: Date.now() })
      setState('explore')
      return
    }
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

  // The known graph goes straight to the graph, like a successful photo.
  function openSaved() {
    setSource('saved')
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
              Use the known graph
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
                <p className="confirm-screen__meta">
                  {SOURCE_TEXT[source]} · line graph · {result.graph.xAxis.values.length} points ·{' '}
                  {result.graph.series.length} line{result.graph.series.length > 1 ? 's' : ''}
                  {result.status === 'low_confidence' && <strong> · low confidence</strong>}
                </p>
                <dl className="confirm-screen__axes">
                  <dt>X axis</dt>
                  <dd>
                    {result.graph.xAxis.label}: {result.graph.xAxis.values[0]} to{' '}
                    {result.graph.xAxis.values[result.graph.xAxis.values.length - 1]}
                  </dd>
                  <dt>Y axis</dt>
                  <dd>
                    {result.graph.yAxis.label}
                    {result.graph.yAxis.unit ? ` (${result.graph.yAxis.unit})` : ' (unit unreadable)'}
                  </dd>
                </dl>
                <div className="confidence" data-testid="confidence">
                  <div className="confidence__row">
                    <span>Overall</span>
                    <span className="confidence__bar">
                      <span
                        className={result.graph.confidence < LOW ? 'confidence__fill confidence__fill--low' : 'confidence__fill'}
                        style={{ width: `${Math.round(result.graph.confidence * 100)}%` }}
                      />
                    </span>
                    <span>{Math.round(result.graph.confidence * 100)}%</span>
                  </div>
                  {result.fieldConfidence &&
                    FIELD_LABELS.map(([key, label]) => {
                      const v = result.fieldConfidence?.[key]
                      if (v === undefined || v === null) return null
                      return (
                        <div className="confidence__row" key={key}>
                          <span>{label}</span>
                          <span className="confidence__bar">
                            <span
                              className={v < LOW ? 'confidence__fill confidence__fill--low' : 'confidence__fill'}
                              style={{ width: `${Math.round(v * 100)}%` }}
                            />
                          </span>
                          <span>{Math.round(v * 100)}%</span>
                        </div>
                      )
                    })}
                </div>
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
