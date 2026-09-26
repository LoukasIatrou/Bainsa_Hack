# Backend

FastAPI service owning `/extract` (Person 1) and `/reason` (Person 2).

## Setup

```
cd backend
uv sync
cp .env.example .env   # then fill in GEMINI_API_KEY
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` is required so a phone on the same wifi/hotspot can reach it.

## Endpoints

- `GET /health` - liveness check.
- `POST /extract` - multipart upload, field name `image`. Returns `ExtractionResponse` (see `/contracts`).
- `GET /extract/mock?scenario=ok|low_confidence|error|mobile_italy_japan|unemployment_us` - fixture data from `fixtures/`, for Person 2/4 to build against before the real key/pipeline is ready.
- `POST /reason` - body `{"graph": GraphData, "fieldConfidence": FieldConfidence | null}`. Returns `ReasoningResponse` (see `/contracts/reasoning-response.schema.json`): overview, the four preset answers (`trend`, `max`, `changes`, `compare`) and per-series point data for exploration, all in one call. Call it again after any user correction.
- `GET /reason/mock?scenario=mobile_italy_japan` - `/reason` run on a fixture (any scenario with a graph).

## Tests

```
uv run pytest
```

## Demo fixtures

- `mobile_italy_japan` (main demo graph) - World Bank `IT.CEL.SETS.P2`, mobile subscriptions per 100 people, 2011-2022. Italy peaks in 2012 and bottoms out in 2020; Japan rises steadily; the lines cross between 2017 and 2018.
- `unemployment_us` (backup) - FRED `UNRATE`, annual average, 2016-2024. Single series with the 2020 spike.

## Getting a Gemini API key

Free key, no card required: https://aistudio.google.com/apikey
