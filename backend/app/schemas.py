from typing import Literal

from pydantic import BaseModel, field_validator


class XAxis(BaseModel):
    label: str
    values: list[str]


class YAxis(BaseModel):
    label: str
    unit: str | None = None


class Series(BaseModel):
    name: str
    values: list[float | None]


class GraphData(BaseModel):
    graphType: Literal["line"]  # scoped to line graphs for now
    title: str
    xAxis: XAxis
    yAxis: YAxis
    series: list[Series]
    summary: str | None = None
    confidence: float

    @field_validator("confidence")
    @classmethod
    def _clamp_confidence(cls, v: float) -> float:
        # Clamp rather than reject: an LLM returning 1.02 shouldn't crash the whole extraction.
        return min(max(v, 0.0), 1.0)


class FieldConfidence(BaseModel):
    graphType: float
    title: float
    xAxis: float
    yAxis: float
    series: float


class ExtractionResponse(BaseModel):
    status: Literal["ok", "low_confidence", "error"]
    graph: GraphData | None = None
    fieldConfidence: FieldConfidence | None = None
    message: str | None = None
