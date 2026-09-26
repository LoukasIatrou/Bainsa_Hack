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
    graphType: Literal["line"]  # scoped to line graphs for now
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


# --- Person 2: /reason ---


class ReasonRequest(BaseModel):
    graph: GraphData  # confirmed/corrected by the user
    fieldConfidence: FieldConfidence | None = None


class Highlight(BaseModel):
    series: str
    index: int


class Answer(BaseModel):
    answer: str
    highlight: list[Highlight] = []
    caveats: list[str] = []


class Overview(BaseModel):
    text: str
    caveats: list[str] = []


class Answers(BaseModel):
    trend: Answer
    max: Answer
    changes: Answer
    compare: Answer


class PointInsight(BaseModel):
    index: int
    x: str
    value: float | None
    normalised: float | None  # 0-1 on a scale shared by all series (sonification pitch)
    delta: float | None
    changeStrength: float | None  # |delta| / value range, capped at 1 (haptic/audio intensity)
    direction: Literal["up", "down", "flat", "unknown"]
    isMax: bool
    isMin: bool
    isTurningPoint: bool
    lowConfidence: bool
    readout: str


class SeriesInsight(BaseModel):
    name: str
    intro: str  # spoken when the user switches to this series
    points: list[PointInsight]


class ValueRange(BaseModel):
    min: float | None
    max: float | None


class ReasoningResponse(BaseModel):
    overview: Overview
    answers: Answers
    series: list[SeriesInsight]
    range: ValueRange
    lowConfidence: bool
    phrasing: Literal["template", "llm"]
