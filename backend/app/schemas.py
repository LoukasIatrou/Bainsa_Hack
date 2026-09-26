from typing import Literal

from pydantic import BaseModel, Field


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
    # height / width of the plot as drawn on screen, so ring angles match the drawn line
    chartAspect: float | None = Field(default=None, gt=0, le=10)


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
    readout: str  # brief: value and landmark only, e.g. '2020: 8.1, highest.'
    explain: str  # coordinates, landmark, change from the previous point, what comes next


class TraceSegment(BaseModel):
    """One stretch of the line, for the ring's continuous trace."""

    fromIndex: int
    toIndex: int
    startFraction: float  # when this segment starts, as a fraction (0-1) of the whole sweep
    endFraction: float
    angle: float | None  # degrees: 0 = flat (right), +90 = straight up, -90 = straight down; null over a gap
    strength: float | None  # 0-1, steepness relative to the value range; null over a gap
    direction: Literal["up", "down", "flat", "unknown"]
    endsAtTurningPoint: bool  # the trend reverses at toIndex (peak or trough)


class InterestPoint(BaseModel):
    """A stop for the Explore page's 'Next point' button, in left-to-right order."""

    index: int
    x: str
    value: float
    xFraction: float  # 0 = left edge of the plot, 1 = right edge
    normalised: float  # 0 = bottom of the value range, 1 = top
    kinds: list[Literal["start", "end", "max", "min", "peak", "low"]]
    explain: str  # spoken by the Explain button: coordinates plus why this point matters


class SeriesInsight(BaseModel):
    name: str
    intro: str  # spoken when the user switches to this series
    points: list[PointInsight]
    trace: list[TraceSegment]  # startFraction/endFraction double as x positions (0-1) on the plot
    interestPoints: list[InterestPoint]


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
