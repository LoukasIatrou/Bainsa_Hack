import os

from google import genai
from google.genai import types

from .schemas import ExtractionResponse, FieldConfidence, GraphData

_MODEL = "gemini-2.5-flash"
_CONFIDENCE_THRESHOLD = 0.6

_PROMPT = """You are extracting structured data from an image of a LINE GRAPH for a blind or low-vision user.
This prototype only supports line graphs. First decide whether the image is actually a line graph.

Read the chart carefully and return:
- isLineGraph: true only if the image is a line graph. False for bar charts, pie charts, scatter plots, tables, or anything else.
- graphType: always "line" (required by the schema; ignore this field's value if isLineGraph is false).
- title: the chart's title, or a short factual description if untitled
- xAxis: label and the list of category/tick values
- yAxis: label and unit if shown
- series: one entry per data series, with values aligned to xAxis.values by index. If a value cannot be read confidently, use null for that value instead of guessing.
- summary: one plain-language sentence describing the overall trend
- confidence: your overall confidence (0-1) that this extraction is correct
- fieldConfidence: your confidence (0-1) for each of graphType, title, xAxis, yAxis, series individually
- message: null if extraction was straightforward, otherwise a short note on what was hard to read (e.g. "y-axis unit is cut off")

Never invent values you cannot read. Use null and lower confidence instead of guessing.
"""


class _ModelOutput(GraphData):
    isLineGraph: bool
    fieldConfidence: FieldConfidence
    message: str | None = None


_client_instance: genai.Client | None = None


def _client() -> genai.Client:
    # Cached rather than constructed per-call: genai.Client closes its
    # underlying httpx client on __del__, so a client built inline as
    # `_client().models...` gets garbage-collected (and closed) mid-request.
    global _client_instance
    if _client_instance is None:
        _client_instance = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client_instance


def extract_graph(image_bytes: bytes, mime_type: str) -> ExtractionResponse:
    try:
        response = _client().models.generate_content(
            model=_MODEL,
            contents=[
                _PROMPT,
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_ModelOutput,
            ),
        )
    except Exception as exc:  # surfaces any API/network failure as a demo-safe error status
        return ExtractionResponse(status="error", message=str(exc))

    if not response.text:
        return ExtractionResponse(status="error", message="Model returned no data.")

    parsed = _ModelOutput.model_validate_json(response.text)

    if not parsed.isLineGraph:
        return ExtractionResponse(
            status="error",
            message=parsed.message or "This doesn't look like a line graph. Please retake or upload a line graph.",
        )

    graph = GraphData(**parsed.model_dump(exclude={"isLineGraph", "fieldConfidence", "message"}))
    status = "ok" if graph.confidence >= _CONFIDENCE_THRESHOLD else "low_confidence"

    return ExtractionResponse(
        status=status,
        graph=graph,
        fieldConfidence=parsed.fieldConfidence,
        message=parsed.message,
    )
