// Bundled "saved graph" so the demo works with no camera, backend or network.
// Copies of backend/fixtures/unemployment_us.json and contracts/examples/reason-unemployment.json.
import type { ExtractionResponse, ReasoningResponse } from '../types'
import extraction from './unemployment_us.json'
import reasoning from './reason-unemployment.json'

export const SAVED_EXTRACTION = extraction as ExtractionResponse
export const SAVED_REASONING = reasoning as ReasoningResponse
