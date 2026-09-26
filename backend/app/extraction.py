import os

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from .schemas import ExtractionResponse, FieldConfidence, GraphData

# gemini-2.5-flash is closed to new API keys ("no longer available to new users"); override with
# GEMINI_MODEL in backend/.env if an older key still needs it. Read per call, after load_dotenv().
_DEFAULT_MODEL = "gemini-3.8-flash"


def _model() -> str:
    return os.getenv("GEMINI_MODEL") or _DEFAULT_MODEL
_CONFIDENCE_THRESHOLD = 0.6

_PROMPT = """You are extracting structured data from an image of a LINE GRAPH for a blind or low-vision user.
This prototype only supports line graphs. First decide whether the image is actually a line graph.

Read the chart carefully and return:
- isLineGraph: true only if the image is a line graph. False for bar charts, pie charts, scatter plots, tables, or anything else.
- graph.graphType: always "line" (required by the schema; ignore this field's value if isLineGraph is false).
- graph.title: the chart's title. If untitled, use exactly "Untitled line graph" - do not invent a descriptive title.
- graph.xAxis: label (empty string "" if no label is shown) and the labelled tick positions along the x-axis.
- graph.yAxis: label (empty string "" if no label is shown) and unit (null if no unit is shown).
- graph.series: one entry per data series. Each series' values must be the same length as xAxis.values,
  aligned by index (the line's y-value at each x-axis tick). If a value cannot be read confidently, use
  null for that value instead of guessing.
- graph.summary: one plain-language sentence describing the overall trend.
- graph.confidence: your overall confidence (0-1) that this extraction is correct.
- fieldConfidence: your confidence (0-1) for each of graphType, title, xAxis, yAxis, series individually.
- message: null if extraction was straightforward, otherwise a short note on what was hard to read (e.g. "y-axis unit is cut off").

Never invent values you cannot read. Use null and lower confidence instead of guessing.
If isLineGraph is false, still fill "graph" with your best-effort reading (it will be ignored).
"""


class _ModelOutput(BaseModel):
    # isLineGraph listed first so the model commits to this decision before it generates the
    # rest of the fields - the SDK's structured-output mode fills fields in declaration order,
    # and deciding after already having extracted a full graph biases the model toward "true".
    isLineGraph: bool
    graph: GraphData
    fieldConfidence: FieldConfidence
    message: str | None = None


_client_instance: genai.Client | None = None


def _client() -> genai.Client:
    # Cached rather than constructed per-call: genai.Client closes its
    # underlying httpx client on __del__, so a client built inline as
    # `_client().models...` gets garbage-collected (and closed) mid-request.
    global _client_instance
    if _client_instance is None:
        _client_instance = genai.Client(
            api_key=os.environ["GEMINI_API_KEY"],
            http_options=types.HttpOptions(timeout=45_000),
        )
    return _client_instance


def _align_series(graph: GraphData) -> tuple[GraphData, bool]:
    """Force every series to the same length as xAxis.values. Returns whether anything had to
    be adjusted, so callers can downgrade status instead of silently trusting a malformed
    extraction (frontend exploration indexes series by xAxis position and assumes equal length)."""
    target_len = len(graph.xAxis.values)
    adjusted = False
    for series in graph.series:
        if len(series.values) < target_len:
            series.values.extend([None] * (target_len - len(series.values)))
            adjusted = True
        elif len(series.values) > target_len:
            del series.values[target_len:]
            adjusted = True
    return graph, adjusted


def extract_graph(image_bytes: bytes, mime_type: str) -> ExtractionResponse:
    # `client` is bound to a local so it stays referenced for the whole call even if this
    # function runs on a worker thread (FastAPI threadpool) - relying solely on the module-level
    # global has a race where a second concurrent first-call could reassign it mid-request.
    client = _client()

    try:
        response = client.models.generate_content(
            model=_model(),
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
        print(f"extract_graph: Gemini call failed: {exc!r}")
        return ExtractionResponse(status="error", message="Extraction service unavailable. Try again or use a saved example.")

    if not response.text:
        return ExtractionResponse(status="error", message="Model returned no data.")

    try:
        parsed = _ModelOutput.model_validate_json(response.text)
    except ValidationError as exc:
        print(f"extract_graph: model returned invalid JSON: {exc!r}")
        return ExtractionResponse(status="error", message="Couldn't read this graph. Please retake or upload it.")

    if not parsed.isLineGraph:
        return ExtractionResponse(
            status="error",
            message=parsed.message or "This doesn't look like a line graph. Please retake or upload a line graph.",
        )

    graph, had_to_adjust = _align_series(parsed.graph)
    if not graph.series or not graph.xAxis.values:
        return ExtractionResponse(status="error", message="Couldn't find any data series in this graph.")

    field_confidences = parsed.fieldConfidence.model_dump().values()
    has_missing_value = any(v is None for s in graph.series for v in s.values)
    low_confidence = (
        had_to_adjust
        or has_missing_value
        or graph.confidence < _CONFIDENCE_THRESHOLD
        or min(field_confidences) < _CONFIDENCE_THRESHOLD
    )
    status = "low_confidence" if low_confidence else "ok"

    return ExtractionResponse(
        status=status,
        graph=graph,
        fieldConfidence=parsed.fieldConfidence,
        message=parsed.message or ("Some values needed adjustment - please review." if had_to_adjust else None),
    )
