// Mirrors contracts/graph-data.schema.json and extraction-response.schema.json.
// Keep in sync with backend/app/schemas.py - don't fork this shape locally.

export interface XAxis {
  label: string
  values: string[]
}

export interface YAxis {
  label: string
  unit?: string | null
}

export interface Series {
  name: string
  values: (number | null)[]
}

export interface GraphData {
  graphType: 'line'
  title: string
  xAxis: XAxis
  yAxis: YAxis
  series: Series[]
  summary?: string | null
  confidence: number
}

export interface FieldConfidence {
  graphType: number
  title: number
  xAxis: number
  yAxis: number
  series: number
}

export interface ExtractionResponse {
  status: 'ok' | 'low_confidence' | 'error'
  // Only status is required by the schema; graph is absent/null on 'error'.
  graph?: GraphData | null
  fieldConfidence?: FieldConfidence | null
  message?: string | null
}

// Mirrors contracts/reasoning-response.schema.json (Person 2's POST /reason), all fields as
// required there. There is no top-level `caveats`: overview.caveats and answers[].caveats are
// what must be spoken.

export interface ReasoningAnswer {
  answer: string
  highlight: { series: string; index: number }[]
  caveats: string[]
}

export type PointDirection = 'up' | 'down' | 'flat' | 'unknown'

export interface ReasonedPoint {
  index: number
  x: string
  value: number | null
  normalised: number | null
  delta: number | null
  changeStrength: number | null
  direction: PointDirection
  isMax: boolean
  isMin: boolean
  isTurningPoint: boolean
  lowConfidence: boolean
  readout: string
  explain: string
}

export interface TraceSegment {
  fromIndex: number
  toIndex: number
  startFraction: number
  endFraction: number
  angle: number | null
  strength: number | null
  direction: PointDirection
  endsAtTurningPoint: boolean
}

export interface InterestPoint {
  index: number
  x: string
  value: number
  xFraction: number
  normalised: number
  kinds: ('start' | 'end' | 'max' | 'min' | 'peak' | 'low')[]
  explain: string
}

export interface ReasonedSeries {
  name: string
  intro: string
  points: ReasonedPoint[]
  trace: TraceSegment[]
  interestPoints: InterestPoint[]
}

export interface ReasoningResponse {
  overview: { text: string; caveats: string[] }
  answers: Record<'trend' | 'max' | 'changes' | 'compare', ReasoningAnswer>
  series: ReasonedSeries[]
  range: { min: number | null; max: number | null }
  lowConfidence: boolean
  phrasing: 'template' | 'llm'
}
