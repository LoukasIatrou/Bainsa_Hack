# Bainsa Hack — Graph Accessibility Copilot

Point a phone camera at a line graph. The app reads it, speaks a summary, and lets a blind or
low-vision user explore the data point by point through speech, sonification, and a vibrating
"ring" — simulated with the phone's own vibration motor (`navigator.vibrate()`), since there is
no physical ring in this build. Speech uses the browser's built-in `SpeechSynthesis`.

Scope: **line graphs only**. Other chart types are future scope.

## Layout

| Path | Owner | What it is |
| --- | --- | --- |
| `contracts/` | shared | JSON schemas every workstream conforms to (`GraphData`, `ExtractionResponse`, `ReasoningResponse`) plus [`haptic-patterns.md`](contracts/haptic-patterns.md), the single source of truth for what each vibration pattern means. |
| `backend/` | Person 1 & 2 | FastAPI service. `POST /extract` (vision) and `POST /reason` (reasoning). |
| `frontend/` | Person 4 | React + TypeScript + Vite app — the actual demo. |
| `audio-haptics/` | Person 3 | `@bainsa/audio-haptics` — speech, sonification and haptic engine. Imported by the frontend directly from source (no build step, zero runtime dependencies). Also ships its own standalone test harness. |
| `docs/` | all | Team brief, design notes, demo runbooks, capture examples, and the [pitch deck](docs/pitch-deck/index.html). |

## Requirements

- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- Node.js 20+ (frontend uses `pnpm` via `npx`, audio-haptics uses `npm`)
- A free Gemini API key for live extraction: https://aistudio.google.com/apikey (not required for
  mock/fixture modes below)

## Quickstart — run it locally

Two processes, two terminals. Nothing else is required to reproduce the full demo on one machine.

**1. Backend**

```sh
cd backend
uv sync
cp .env.example .env   # then set GEMINI_API_KEY
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` matters even on one machine: it's what lets a phone on the same wifi reach it
later. Without a Gemini key, everything still runs against fixtures — see "Running without a
Gemini key" below.

**2. Frontend**

```sh
cd frontend
npx -y pnpm@10 install
npx -y pnpm@10 dev          # http://127.0.0.1:5173
```

The frontend imports Person 3's engine straight from `../audio-haptics/src` (see
`frontend/src/engine/index.ts` and the `fs.allow` entry in `frontend/vite.config.ts`) — there is
no separate install or build step for `audio-haptics/` unless you're running its own harness
below.

Open `http://127.0.0.1:5173`:

- `/` — capture a photo (or upload one), confirm what was extracted, then explore it.
- `#saved` — skip capture: loads a bundled US-unemployment graph straight into the explorer, no
  camera or backend needed.
- `#slider` — the earlier slider-based exploration page.
- `#spider-sense` — the ring/gesture harness on its own.

## Running without a Gemini key

Every endpoint has a fixture-backed mock twin, so the full journey — extraction through
exploration — works before any model key exists:

```sh
curl "http://localhost:8000/extract/mock?scenario=unemployment_us"
curl "http://localhost:8000/reason/mock?scenario=unemployment_us"
```

`contracts/examples/reason-unemployment.json` is a saved `GET /reason/mock` response, used as the
frontend's offline fallback when the backend is unreachable.

## Running on a phone

Two supported paths, both documented in [`frontend/README.md`](frontend/README.md):

- **Same wifi**: point the frontend's proxy at the backend's LAN IP with `VITE_BACKEND_URL`, then
  open the dev server's LAN URL on the phone.
- **USB**: `adb reverse tcp:5173 tcp:5173`, then open `http://localhost:5173` on the phone —
  `localhost` counts as a secure context, so camera access works without HTTPS.

## Optional: audio-haptics standalone harness

For testing speech, sonification, and haptics in isolation (used by Person 3; not required to run
the main demo):

```sh
cd audio-haptics
npm install
npm start   # launches Chrome with --enable-speech-dispatcher, so desktop speech isn't silent
```

Desktop Chrome on Linux reports zero `SpeechSynthesis` voices unless launched with
`--enable-speech-dispatcher` — `npm start` handles that. Android needs no flag. See
[`audio-haptics/README.md`](audio-haptics/README.md) for the full API and
[`docs/person3-demo.md`](docs/person3-demo.md) for the fallback demo runbook and rehearsal
checklist.

## Tests and checks

```sh
# Backend
cd backend && uv run pytest

# Frontend
cd frontend && npx -y pnpm@10 exec tsc -b && npx -y pnpm@10 exec oxlint

# Audio-haptics
cd audio-haptics && npm run typecheck && npm test
```

## API surface

| Endpoint | Owner | Purpose |
| --- | --- | --- |
| `GET /health` | — | Liveness check. |
| `POST /extract` | Person 1 | Multipart image upload → `ExtractionResponse` via Gemini, forced to `contracts/graph-data.schema.json`. Falls back across Gemini models if one is overloaded. |
| `GET /extract/mock?scenario=…` | Person 1 | Fixture data (`ok`, `low_confidence`, `error`, `unemployment_us`, `mobile_italy_japan`) from `backend/fixtures/`. |
| `POST /reason` | Person 2 | Confirmed `GraphData` → overview text, ring `trace`, landmark stops, per-point readouts/explanations, and four preset answers (trend, max, changes, compare) — everything the Explore page needs in one call. |
| `GET /reason/mock?scenario=…` | Person 2 | `/reason` run against a fixture, for building against before extraction is wired up. |

Full field-by-field detail: [`backend/README.md`](backend/README.md). Haptic pattern timings and
meanings: [`contracts/haptic-patterns.md`](contracts/haptic-patterns.md).

## Honesty and scope

- Vibration is **off by default** — `navigator.vibrate()` is silently ignored on many Android
  builds and desktop browsers with no way to detect that, so the demo never claims the phone is
  buzzing unless it's opted in and on an actual phone.
- Uncertainty is surfaced, never hidden: low-confidence fields are flagged and unreadable values
  stay `null` rather than being guessed.
- Three execution modes exist for the demo — live capture, a known/uploaded graph, and a cached
  fallback response — so a hardware or network failure never stops the exploration experience.

## More docs

- [`docs/team-plan.md`](docs/team-plan.md) — full team brief and six-hour plan.
- [`docs/person3-demo.md`](docs/person3-demo.md) — audio/haptics demo runbook and rehearsal check.
- [`docs/phone-demo-navigation.md`](docs/phone-demo-navigation.md), [`docs/person2-reasoning.md`](docs/person2-reasoning.md), [`docs/exploration-touch-interface-plan.md`](docs/exploration-touch-interface-plan.md), [`docs/voice-over-status.md`](docs/voice-over-status.md) — design decisions and integration status.
- [`docs/pitch-deck/index.html`](docs/pitch-deck/index.html) — the pitch deck (open directly in a browser).
