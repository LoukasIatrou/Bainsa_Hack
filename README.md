# Bainsa Hack - Graph Accessibility Copilot

Six-hour accessibility hackathon project. Full team brief: [docs/team-plan.md](docs/team-plan.md).

Phone demo (not a physical ring): haptics use the phone's own vibration motor
(`navigator.vibrate()`), speech uses the browser's built-in `SpeechSynthesis`.

## Layout

- `contracts/` - shared JSON schemas every workstream conforms to (`GraphData`, `ExtractionResponse`).
- `backend/` - FastAPI service. `/extract` (Person 1, vision) lives here now; `/reason` (Person 2) joins later.
- `frontend/` - not yet scaffolded (Person 4).

## Person 1 - extraction status

- `POST /extract` sends the uploaded image to Gemini 2.5 Flash with a forced JSON schema
  matching `contracts/graph-data.schema.json`, so output always parses without regex/prompt-fence
  hacks.
- `GET /extract/mock?scenario=ok|low_confidence|error` serves fixtures from `backend/fixtures/`
  so Person 2 and Person 4 can build against the real contract before a Gemini key exists.
- See `backend/README.md` for setup (needs a free Gemini key from https://aistudio.google.com/apikey).
