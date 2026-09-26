// Local stand-in for Person 3's AudioHapticEngine (audio-haptics/src/index.ts), with the same
// method names and semantics for everything the Explore page calls. It exists only because
// Person 3's package does not yet compile under this app's tsconfig; engine/index.ts is the one
// switch point.
//
// Logic follows Person 3's guidance.ts and explain-mode.ts line by line (normalised data space,
// y up, 6 % on-curve tolerance, direction pulses that speed up as the finger closes in, `double`
// only on arriving at the target, the walk advancing on speech:idle). Where Haris's product spec
// asks for more, it is marked SPEC so the same behaviour can be requested from Person 3:
//   - Overview also names every series and speaks Person 2's overview caveats.
//   - Explain speaks Person 2's points[i].explain (Person 3's template as fallback).
//   - Arriving on a target outside the walk says nothing ('Explain available' is the `double`).
//   - A null point is a gap: reaching it fires `long` + "<label> could not be read".
//   - The on-curve test uses the drawn monotone cubic, not straight segments.
//   - The walk ends with `long` + "Finished."
import type { FieldConfidence, GraphData, ReasoningResponse } from '../types'
import { curveAt, monotoneTangents } from './curve'
import {
  inferGraphKind,
  isLocalExtremum,
  maxIndex,
  minIndex,
  normalisedSeries,
  pointCount,
  xLabel,
} from './graphUtils'
import { HAPTIC_PATTERNS, vibratePattern } from './patterns'
import { describeAxes, describePointOfInterest, describeSeriesList } from './phrasing'
import { SpeechQueue } from './speechQueue'
import type {
  EngineEvent,
  EngineListener,
  EngineStatus,
  GraphKind,
  GuidanceReading,
  GuidanceState,
  HapticPatternName,
} from './types'

const ON_CURVE_TOLERANCE = 0.06
const FAR_INTERVAL_MS = 700
const NEAR_INTERVAL_MS = 140
const TICK_INTERVAL_MS = 90

export class LocalAudioHapticEngine {
  readonly speech: SpeechQueue
  // Mirrors Person 3's engine.explore for series selection.
  readonly explore: { currentSeries: number; selectSeries: (index: number) => void }
  // Mirrors Person 3's engine.guidance for the read-only calls the ring drawing needs.
  readonly guidance: { read: (x: number, y: number) => GuidanceReading; getTarget: () => number | null }
  // Mirrors Person 3's engine.gestures pointer entry points. The local stand-in only handles
  // one-finger drag -> guide(); command gestures are Person 3's (menu) or the page's, pending
  // Haris's choice of mapping.
  readonly gestures: {
    pointerDown: (e: { pointerId: number; clientX: number; clientY: number }) => void
    pointerMove: (e: { pointerId: number; clientX: number; clientY: number }) => void
    pointerUp: (e: { pointerId: number }) => void
    pointerCancel: (e: { pointerId: number }) => void
  }
  private pointerConverter: ((clientX: number, clientY: number) => { x: number; y: number } | null) | null = null
  private dragPointer: number | null = null

  private listeners = new Set<EngineListener>()
  private graph: GraphData | null = null
  private fieldConfidence: FieldConfidence | null = null
  private reasoning: ReasoningResponse | null = null
  private graphKind: GraphKind = 'discrete'
  private seriesIndex = 0
  private curveCache: { ys: (number | null)[]; m: (number | null)[] } | null = null

  // Guidance state (Person 3's Guidance class).
  private guiding = false
  private lastPulseAt = 0
  private lastTickAt = 0
  private lastState: GuidanceState = 'idle'
  private lastIndex = -1
  private targetIndex: number | null = null
  private announcedArrival = false
  private currentIndex: number | null = null
  private lastGapIndex: number | null = null

  // Explain state (Person 3's ExplainMode class).
  private walkRunning = false
  private walkIndex = 0
  private walkExplaining = false
  private walkAwaitingArrival = false

  constructor() {
    this.speech = new SpeechQueue((event) => this.dispatch(event))
    this.on((event) => {
      if (event.type === 'speech:idle') this.handleSpeechIdle()
    })
    this.explore = {
      currentSeries: 0,
      selectSeries: (index: number) => {
        if (!this.graph || index < 0 || index >= this.graph.series.length) return
        this.stopExplainMode()
        this.seriesIndex = index
        this.explore.currentSeries = index
        this.curveCache = null
        this.broadcastStatus()
      },
    }
    this.guidance = {
      read: (x, y) => this.read(x, y),
      getTarget: () => this.targetIndex,
    }
    const drag = (e: { pointerId: number; clientX: number; clientY: number }) => {
      const point = this.pointerConverter?.(e.clientX, e.clientY)
      if (point) this.guide(point.x, point.y)
    }
    this.gestures = {
      pointerDown: (e) => {
        if (this.dragPointer !== null) return
        this.dragPointer = e.pointerId
        drag(e)
      },
      pointerMove: (e) => {
        if (e.pointerId === this.dragPointer) drag(e)
      },
      pointerUp: (e) => {
        if (e.pointerId === this.dragPointer) this.dragPointer = null
      },
      pointerCancel: (e) => {
        if (e.pointerId === this.dragPointer) this.dragPointer = null
      },
    }
  }

  // Person 3's API: client px -> normalised data space, so drags can drive guidance.
  setPointerConverter(convert: ((clientX: number, clientY: number) => { x: number; y: number } | null) | null): void {
    this.pointerConverter = convert
  }

  // -- events ---------------------------------------------------------------

  on(listener: EngineListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private dispatch(event: EngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('[engine] listener threw', error)
      }
    }
    if (event.type === 'speech:start' || event.type === 'speech:end') this.broadcastStatus()
  }

  private broadcastStatus(): void {
    this.dispatch({ type: 'status:change', status: this.getStatus() })
  }

  getStatus(): EngineStatus {
    return {
      speaking: this.speech.speaking,
      hasGraph: this.graph !== null,
      hasReasoning: this.reasoning !== null,
      graphKind: this.graphKind,
      explaining: this.walkRunning,
      explainStep: this.walkRunning ? this.walkIndex + 1 : null,
      guiding: this.guiding,
      targetIndex: this.targetIndex,
    }
  }

  // -- setup ----------------------------------------------------------------

  async unlock(): Promise<boolean> {
    this.speech.unlock()
    return true
  }

  setGraph(graph: GraphData, fieldConfidence: FieldConfidence | null = null): void {
    this.graph = graph
    this.fieldConfidence = fieldConfidence
    this.graphKind = inferGraphKind(graph)
    this.stopExplainMode()
    // Stale analysis must never outlive the graph it described (Person 3).
    this.reasoning = null
    this.seriesIndex = 0
    this.explore.currentSeries = 0
    this.curveCache = null
    this.guiding = false
    this.targetIndex = null
    this.broadcastStatus()
  }

  getGraph(): GraphData | null {
    return this.graph
  }

  setReasoning(reasoning: ReasoningResponse | null): void {
    this.reasoning = reasoning
    this.curveCache = null
    this.broadcastStatus()
  }

  getReasoning(): ReasoningResponse | null {
    return this.reasoning
  }

  getGraphKind(): GraphKind {
    return this.graphKind
  }

  setGraphKind(kind: GraphKind): void {
    this.graphKind = kind
    if (kind === 'continuous') this.stopExplainMode()
    this.broadcastStatus()
  }

  playPattern(name: HapticPatternName): void {
    const spec = HAPTIC_PATTERNS[name]
    const transports = vibratePattern(name)
    this.dispatch({ type: 'haptic:pattern', pattern: name, timings: spec.timings, ramp: spec.ramp, meaning: spec.meaning, transports })
  }

  // -- modes ----------------------------------------------------------------

  startOverview(): void {
    const graph = this.graph
    if (!graph) {
      this.speech.speak('No graph is loaded yet.', 'interrupt')
      return
    }
    this.stopExplainMode()
    this.speech.speak(describeAxes(graph, this.fieldConfidence), 'interrupt')
    const list = describeSeriesList(graph) // SPEC: overview mentions all series
    if (list) this.speech.speak(list, 'normal')
    if (this.reasoning) {
      this.speech.speak(this.reasoning.overview.text, 'normal')
      for (const caveat of this.reasoning.overview.caveats) this.speech.speak(caveat, 'normal') // SPEC
    } else if (graph.summary) {
      this.speech.speak(graph.summary, 'normal')
    }
    // Continuous: steer onto the line and follow freely. Discrete: start at the first point.
    this.startGuidance(this.graphKind === 'continuous' ? null : this.firstReadableIndex())
    this.broadcastStatus()
  }

  startExplainMode(from = 0): void {
    if (!this.graph) {
      this.speech.speak('No graph is loaded yet.', 'interrupt')
      return
    }
    if (this.graphKind === 'continuous') {
      this.speech.speak(
        'This is a continuous curve, so there are no separate points to explain. Use Overview to trace its shape.',
        'interrupt',
      )
      this.playPattern('long')
      return
    }
    const total = pointCount(this.graph)
    if (total === 0) return
    this.walkRunning = true
    this.walkIndex = Math.min(Math.max(0, from), total - 1)
    this.walkExplaining = false
    this.walkAwaitingArrival = true
    this.speech.speak(
      this.walkIndex === 0
        ? 'Explain mode. Follow the vibration to the first point.'
        : 'Follow the vibration to the next point.',
      'interrupt',
    )
    this.walkSetTarget(this.walkIndex)
    this.broadcastStatus()
  }

  stopExplainMode(): void {
    if (!this.walkRunning) return
    this.walkRunning = false
    this.walkExplaining = false
    this.walkAwaitingArrival = false
    this.setTarget(null)
    this.broadcastStatus()
  }

  // Which point the walk is on (0-based), or null. For resuming after a stop.
  get explainIndex(): number | null {
    return this.walkRunning ? this.walkIndex : null
  }

  skipToNextExplanation(): void {
    if (!this.walkRunning) return
    this.walkExplaining = true
    this.handleSpeechIdle()
  }

  // Speech only; guidance keeps running (Person 3). The page's Stop also stops the walk.
  stopSpeaking(): void {
    this.speech.stop()
    this.broadcastStatus()
  }

  stopAll(): void {
    this.stopExplainMode()
    this.speech.stop()
    this.guiding = false
    this.targetIndex = null
    this.broadcastStatus()
  }

  // -- explain walk ---------------------------------------------------------

  private explanationFor(index: number): string {
    const graph = this.graph
    if (!graph) return ''
    const series = graph.series[this.seriesIndex]
    const entry = this.reasoning?.series.find((s) => s.name === series?.name)
    const point = entry?.points.find((p) => p.index === index)
    if (point?.explain) return point.explain // SPEC: Person 2's per-point explanation
    return describePointOfInterest(graph, this.seriesIndex, index, this.interestAt(index), this.fieldConfidence)
  }

  private interestAt(index: number): { isMax?: boolean; isMin?: boolean; isTurningPoint?: boolean } {
    const series = this.graph?.series[this.seriesIndex]
    if (!series) return {}
    return {
      isMax: maxIndex(series) === index,
      isMin: minIndex(series) === index,
      isTurningPoint: isLocalExtremum(series, index),
    }
  }

  private walkSetTarget(index: number): void {
    this.startGuidance(index)
    // SPEC: an unreadable point cannot be reached on the line; say so and move on after.
    if (this.valueAt(index) === null) {
      this.walkAwaitingArrival = false
      this.walkExplaining = true
      this.playPattern('long')
      this.speech.speak(this.explanationFor(index), 'normal')
    }
  }

  private handleArrival(index: number): void {
    if (!this.walkRunning) return // SPEC: outside the walk the `double` alone says "explain available"
    if (!this.walkAwaitingArrival || index !== this.walkIndex) return
    this.walkAwaitingArrival = false
    this.walkExplaining = true
    // No pulse here: guidance already fired `double` on arrival.
    this.speech.speak(this.explanationFor(index), 'interrupt')
    this.broadcastStatus()
  }

  private handleSpeechIdle(): void {
    if (!this.walkRunning || !this.walkExplaining || !this.graph) return
    this.walkExplaining = false
    if (this.walkIndex + 1 >= pointCount(this.graph)) {
      this.playPattern('long')
      this.speech.speak('Finished.', 'normal')
      this.walkRunning = false
      this.setTarget(null)
      this.broadcastStatus()
      return
    }
    this.walkIndex += 1
    this.walkAwaitingArrival = true
    this.speech.speak('Follow the vibration to the next point.', 'normal')
    this.walkSetTarget(this.walkIndex)
    this.broadcastStatus()
  }

  // -- guidance -------------------------------------------------------------

  private firstReadableIndex(): number {
    const values = this.graph?.series[this.seriesIndex]?.values ?? []
    const i = values.findIndex((v) => v !== null)
    return i < 0 ? 0 : i
  }

  private valueAt(index: number): number | null {
    return this.graph?.series[this.seriesIndex]?.values[index] ?? null
  }

  private startGuidance(target: number | null): void {
    this.guiding = true
    this.targetIndex = target
    this.announcedArrival = false
    this.lastState = 'idle'
    this.lastIndex = -1
    this.currentIndex = null
    this.lastPulseAt = 0
    this.lastTickAt = 0
    this.lastGapIndex = null
  }

  private setTarget(index: number | null): void {
    this.targetIndex = index
    this.announcedArrival = false
  }

  // Normalised heights for the active series: Person 2's cross-series `normalised` when present.
  private curve(): { ys: (number | null)[]; m: (number | null)[] } | null {
    if (this.curveCache) return this.curveCache
    const graph = this.graph
    if (!graph) return null
    const series = graph.series[this.seriesIndex]
    if (!series) return null
    const entry = this.reasoning?.series.find((s) => s.name === series.name)
    const ys = entry
      ? series.values.map((_, i) => entry.points.find((p) => p.index === i)?.normalised ?? null)
      : normalisedSeries(graph, this.seriesIndex)
    this.curveCache = { ys, m: monotoneTangents(ys) }
    return this.curveCache
  }

  private read(x: number, y: number): GuidanceReading {
    const graph = this.graph
    const curve = this.curve()
    if (!graph || !curve) return { state: 'idle', index: 0, curveY: null, delta: null, push: 'none' }
    const total = pointCount(graph)
    const index = Math.min(total - 1, Math.max(0, Math.round(x * (total - 1))))
    if (x < -0.02 || x > 1.02 || y < -0.05 || y > 1.05) {
      return { state: 'off-chart', index, curveY: null, delta: null, push: 'none' }
    }
    const curveY = curveAt(curve.ys, curve.m, x)
    if (curveY === null) return { state: 'off-curve', index, curveY: null, delta: null, push: 'none' }
    const delta = curveY - y
    if (Math.abs(delta) <= ON_CURVE_TOLERANCE) return { state: 'on-curve', index, curveY, delta, push: 'none' }
    return { state: 'off-curve', index, curveY, delta, push: delta > 0 ? 'up' : 'down' }
  }

  // Feed a finger position in normalised data space (x 0..1 across the plot, y 0..1 min..max,
  // y UP). Call on every move; it throttles internally.
  guide(x: number, y: number, now = Date.now()): GuidanceReading {
    const reading = this.read(x, y)
    if (!this.guiding) {
      // Exploring before Overview: start free guidance on first touch.
      this.startGuidance(null)
      this.broadcastStatus()
    }
    const enteredCurve = reading.state === 'on-curve' && this.lastState !== 'on-curve'
    const leftCurve = reading.state !== 'on-curve' && this.lastState === 'on-curve'

    if (reading.state === 'off-chart') {
      if (this.lastState !== 'off-chart' || now - this.lastPulseAt > FAR_INTERVAL_MS) this.fire('long', reading, now)
      this.lastState = reading.state
      return reading
    }

    // SPEC: over an unreadable point, say so once; never guess a direction.
    if (reading.curveY === null && this.valueAt(reading.index) === null) {
      if (this.lastGapIndex !== reading.index) {
        this.lastGapIndex = reading.index
        this.fire('long', reading, now)
        this.speech.speak(`${xLabel(this.graph!, reading.index)} could not be read.`, 'interrupt')
      }
      this.lastState = reading.state
      return reading
    }
    if (reading.curveY !== null) this.lastGapIndex = null

    if (enteredCurve) {
      const atTarget = this.targetIndex === null || reading.index === this.targetIndex
      this.fire(atTarget ? 'double' : 'short', reading, now)
      this.lastIndex = reading.index
      this.currentIndex = reading.index
      this.lastState = reading.state
      this.checkArrival(reading.index)
      return reading
    }

    if (reading.state === 'on-curve') {
      if (reading.index !== this.lastIndex && now - this.lastTickAt >= TICK_INTERVAL_MS) {
        const hittingTarget = this.targetIndex !== null && reading.index === this.targetIndex && !this.announcedArrival
        this.fire(hittingTarget ? 'double' : 'short', reading, now)
        this.lastTickAt = now
        this.lastIndex = reading.index
        this.currentIndex = reading.index
        this.checkArrival(reading.index)
      }
      this.lastState = reading.state
      return reading
    }

    if (leftCurve) this.announcedArrival = false
    if (reading.push !== 'none') {
      const closeness = 1 - Math.min(1, Math.abs(reading.delta ?? 1))
      const interval = FAR_INTERVAL_MS - (FAR_INTERVAL_MS - NEAR_INTERVAL_MS) * closeness
      if (now - this.lastPulseAt >= interval) this.fire(reading.push === 'up' ? 'rising' : 'falling', reading, now)
    }
    this.lastState = reading.state
    return reading
  }

  // Where the finger last actually was on the curve.
  getCurrentIndex(): number | null {
    return this.currentIndex
  }

  private checkArrival(index: number): void {
    if (this.targetIndex === null || this.announcedArrival || index !== this.targetIndex) return
    this.announcedArrival = true
    this.handleArrival(index)
  }

  private fire(pattern: HapticPatternName, reading: GuidanceReading, now: number): void {
    this.lastPulseAt = now
    this.playPattern(pattern)
    this.dispatch({ type: 'guidance:change', state: reading.state, index: reading.index, push: reading.push, delta: reading.delta })
  }
}
