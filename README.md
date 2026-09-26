# Bainsa Hack - Graph Accessibility Copilot

Six-hour accessibility hackathon project. Full team brief: [docs/team-plan.md](docs/team-plan.md).

Phone demo (not a physical ring): haptics use the phone's own vibration motor
(`navigator.vibrate()`), speech uses the browser's built-in `SpeechSynthesis`.

Scope for now: **line graphs only**. Other chart types are future scope.

## Layout

- `contracts/` - shared JSON schemas every workstream conforms to (`GraphData`, `ExtractionResponse`, `ReasoningResponse`).
- `backend/` - FastAPI service. `/extract` (Person 1, vision) and `/reason` (Person 2, reasoning).
- `frontend/` - not yet scaffolded (Person 4).

## Person 1 - extraction status

- `POST /extract` sends the uploaded image to Gemini 2.5 Flash with a forced JSON schema
  matching `contracts/graph-data.schema.json`, so output always parses without regex/prompt-fence
  hacks.
- `GET /extract/mock?scenario=ok|low_confidence|error` serves fixtures from `backend/fixtures/`
  so Person 2 and Person 4 can build against the real contract before a Gemini key exists.
- See `backend/README.md` for setup (needs a free Gemini key from https://aistudio.google.com/apikey).

## Person 2 - reasoning status

- `POST /reason` turns the confirmed graph into everything the Explore page needs, in **one call**:
  the Overview text (one sentence of shape; Person 3 speaks the axes), the ring `trace` (slope angle and strength along the
  curve), the Next point stops (`interestPoints`, big landmarks only, at most 6), per-point values with a brief
  readout and an Explain text (`points[].explain`, including the change from the previous point).
  After that, exploration needs no network. A saved demo response for fallback mode is in
  `contracts/examples/reason-unemployment.json`.
- The ring is the main output; speech is kept brief. Every number is computed deterministically;
  Gemini's `summary` is ignored. With `USE_LLM=1`, Gemini may reword the overview and answers, but
  any new number, error or timeout (3 s) falls back to templates.
- `GET /reason/mock` (US unemployment demo graph) for building the frontend without a key.
  Field-by-field guide: `backend/README.md`.
