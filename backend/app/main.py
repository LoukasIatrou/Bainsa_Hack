import json
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .extraction import extract_graph
from .phrasing_llm import rephrase
from .reasoning import reason
from .schemas import ExtractionResponse, ReasoningResponse, ReasonRequest

load_dotenv()

app = FastAPI(title="Bainsa Hack backend")

# Hackathon-wide open CORS: phone (one origin) talks to laptop-hosted backend
# (another origin) over shared wifi/hotspot, and the exact demo network isn't
# known ahead of time.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractionResponse)
async def extract(image: UploadFile) -> ExtractionResponse:
    image_bytes = await image.read()
    mime_type = image.content_type or "image/jpeg"
    return extract_graph(image_bytes, mime_type)


@app.get("/extract/mock", response_model=ExtractionResponse)
def extract_mock(scenario: str = "ok") -> ExtractionResponse:
    """Mock extraction results so Person 2/4 can build against the contract
    without waiting on a real image or a Gemini API key."""
    fixture_path = _FIXTURES_DIR / f"{scenario}.json"
    data = json.loads(fixture_path.read_text())
    return ExtractionResponse(**data)


@app.post("/reason", response_model=ReasoningResponse)
def reason_endpoint(request: ReasonRequest) -> ReasoningResponse:
    """Everything the frontend needs in one call: overview, the four preset
    answers and per-point exploration data. Call again after any correction."""
    return rephrase(reason(request.graph, request.fieldConfidence))


@app.get("/reason/mock", response_model=ReasoningResponse)
def reason_mock(scenario: str = "unemployment_us") -> ReasoningResponse:
    """/reason run on a fixture from fixtures/, for building the frontend."""
    fixture_path = _FIXTURES_DIR / f"{scenario}.json"
    extraction = ExtractionResponse(**json.loads(fixture_path.read_text(encoding="utf-8")))
    if extraction.graph is None:
        raise HTTPException(status_code=400, detail=f"Fixture '{scenario}' has no graph.")
    return rephrase(reason(extraction.graph, extraction.fieldConfidence))
