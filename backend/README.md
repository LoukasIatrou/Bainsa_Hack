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
- `POST /reason` - body `{"graph": GraphData, "fieldConfidence": FieldConfidence | null, "chartAspect": number | null}`. Returns `ReasoningResponse` (see `/contracts/reasoning-response.schema.json`) with everything the Explore page needs, in one call. Call it again after any user correction. `chartAspect` is the drawn plot's height / width (default 0.6), so ring angles match the line on screen.
- `GET /reason/mock?scenario=unemployment_us` - `/reason` run on a fixture (any scenario with a graph; also accepts `chartAspect`).

### What `/reason` returns, per Explore page button

| Use | Field | Example (`unemployment_us`) |
|---|---|---|
| Overview button (speech) | `overview.text` - graph type and axes | "Line graph: US unemployment rate, yearly average. Across: year, 2016 to 2024. Up: unemployment rate, in percent, from 3.6 to 8.1." |
| Ring guidance along the curve | `series[].trace[]` - `angle` (0 = flat, +90 = straight up, -90 = straight down), `strength` (0-1), `direction`, positioned by `startFraction`/`endFraction` (0 = left edge, 1 = right edge) | 2019 -> 2020: angle 78, strength 0.98, up |
| Next point button | `series[].interestPoints[]` - `xFraction`, `normalised` (where to guide the finger), `kinds` | start, 2019 low, 2020 max/peak, 2023 min/low, end |
| Explain button (speech) | `interestPoints[].explain` | "2020, 8.1 percent. The highest point; after this it falls." |
| Per-point values | `series[].points[]` - `value`, `normalised`, `direction`, `isMax`, `isTurningPoint`, `readout` | "2020: 8.1, highest." |
| Uncertainty | `lowConfidence`, `overview.caveats`, `answers.*.caveats` | "The value for Q3 could not be read, so it is left out." |
| Preset answers (optional) | `answers.trend`, `max`, `changes`, `compare` - one sentence each | "Highest: 8.1 percent, in 2020." |

Unreadable values stay `null` (never guessed); segments over them have `angle: null`, `direction: "unknown"`.

## Tests

```
uv run pytest
```

## Demo fixtures

- `unemployment_us` (demo graph) - FRED `UNRATE`, annual average, 2016-2024: 4.9, 4.4, 3.9, 3.7, 8.1, 5.4, 3.7, 3.6, 4.0 percent. Single series with the 2020 spike.
- `mobile_italy_japan` (two-series test) - World Bank `IT.CEL.SETS.P2`, mobile subscriptions per 100 people, 2011-2022. Italy peaks in 2012 and bottoms out in 2020; Japan rises steadily; the lines cross between 2017 and 2018.

## Getting a Gemini API key

Free key, no card required: https://aistudio.google.com/apikey
