// Mirrors contracts/graph-data.schema.json and extraction-response.schema.json.
// Keep in sync with backend/app/schemas.py - don't fork this shape locally.

export interface XAxis {
  label: string
  values: string[]
}

export interface YAxis {
  label: string
  unit: string | null
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
  summary: string | null
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
  graph: GraphData | null
  fieldConfidence: FieldConfidence | null
  message: string | null
}

// Mirrors contracts/reasoning-response.schema.json (Person 2's POST /reason). Only the fields
// the Explore page reads are typed as required; the rest are optional so a schema tweak there
// doesn't break the build here.

export interface ReasoningAnswer {
  answer: string
  highlight: { series: string; index: number }[]
  caveats: string[]
}

export interface ReasonedPoint {
  index: number
  x: string
  value: number | null
  normalised: number | null
  delta?: number | null
  changeStrength?: number | null
  direction: 'up' | 'down' | 'flat' | 'unknown'
  isMax: boolean
  isMin: boolean
  isTurningPoint: boolean
  lowConfidence?: boolean
  readout: string
  explain: string
}

export interface InterestPoint {
  index: number
  x: string
  value: number | null
  xFraction: number
  normalised: number | null
  kinds: string[]
  explain: string
}

export interface ReasonedSeries {
  name: string
  intro?: string
  points: ReasonedPoint[]
  interestPoints: InterestPoint[]
}

export interface ReasoningResponse {
  overview: { text: string; caveats: string[] }
  answers?: Record<string, ReasoningAnswer>
  series: ReasonedSeries[]
  range?: { min: number; max: number }
  lowConfidence: boolean
  caveats?: string[]
  phrasing?: string
}
