import json
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .extraction import extract_graph
from .schemas import ExtractionResponse

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
