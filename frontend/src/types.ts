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
