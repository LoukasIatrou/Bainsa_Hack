# Backend

FastAPI service owning `/extract` (Person 1) and, once ready, `/reason` (Person 2).

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
- `GET /extract/mock?scenario=ok|low_confidence|error` - fixture data from `fixtures/`, for Person 2/4 to build against before the real key/pipeline is ready.

## Getting a Gemini API key

Free key, no card required: https://aistudio.google.com/apikey
