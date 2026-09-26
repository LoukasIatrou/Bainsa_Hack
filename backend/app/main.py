import json
from pathlib import Path
from typing import Literal

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
_CAPTURE_EXAMPLES_DIR = Path(__file__).parent.parent.parent / "docs" / "capture-examples"


def _save_capture_example(result: ExtractionResponse) -> None:
    # Saves every real (non-mock) capture so the team has real Gemini output to build against,
    # not just the three hand-written fixtures. Remove this before the live demo if you don't
    # want judges' captures written to disk.
    _CAPTURE_EXAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    existing = len(list(_CAPTURE_EXAMPLES_DIR.glob("capture-*.json")))
    path = _CAPTURE_EXAMPLES_DIR / f"capture-{existing + 1:02d}.json"
    path.write_text(result.model_dump_json(indent=2), encoding="utf-8")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractionResponse)
def extract(image: UploadFile) -> ExtractionResponse:
    # Sync def: FastAPI runs this in a worker thread instead of the event loop, since the
    # Gemini SDK call is blocking and would otherwise freeze /health and /extract/mock too.
    image_bytes = image.file.read()
    mime_type = image.content_type or "image/jpeg"
    result = extract_graph(image_bytes, mime_type)
    _save_capture_example(result)
    return result


@app.get("/extract/mock", response_model=ExtractionResponse)
def extract_mock(scenario: Literal["ok", "low_confidence", "error"] = "ok") -> ExtractionResponse:
    """Mock extraction results so Person 2/4 can build against the contract
    without waiting on a real image or a Gemini API key."""
    fixture_path = _FIXTURES_DIR / f"{scenario}.json"
    data = json.loads(fixture_path.read_text(encoding="utf-8"))
    return ExtractionResponse(**data)


@app.post("/reason", response_model=ReasoningResponse)
def reason_endpoint(request: ReasonRequest) -> ReasoningResponse:
    """Everything the frontend needs in one call: overview, the four preset
    answers and per-point exploration data. Call again after any correction."""
    return rephrase(reason(request.graph, request.fieldConfidence, chart_aspect=request.chartAspect))


@app.get("/reason/mock", response_model=ReasoningResponse)
def reason_mock(scenario: str = "unemployment_us", chartAspect: float | None = None) -> ReasoningResponse:
    """/reason run on a fixture from fixtures/, for building the frontend."""
    fixture_path = _FIXTURES_DIR / f"{scenario}.json"
    extraction = ExtractionResponse(**json.loads(fixture_path.read_text(encoding="utf-8")))
    if extraction.graph is None:
        raise HTTPException(status_code=400, detail=f"Fixture '{scenario}' has no graph.")
    return rephrase(reason(extraction.graph, extraction.fieldConfidence, chart_aspect=chartAspect))
