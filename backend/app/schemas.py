from typing import Literal

from pydantic import BaseModel


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
    graphType: Literal["line", "bar", "scatter", "pie"]
    title: str
    xAxis: XAxis
    yAxis: YAxis
    series: list[Series]
    summary: str | None = None
    confidence: float


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
