import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import phrasing_llm
from app.main import app
from app.reasoning import fmt_number, reason
from app.schemas import ExtractionResponse, GraphData

FIXTURES = Path(__file__).parent.parent / "fixtures"


def load(name: str) -> ExtractionResponse:
    return ExtractionResponse(**json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8")))


def run(name: str, **kwargs):
    e = load(name)
    return reason(e.graph, e.fieldConfidence, **kwargs)


def series(result, name):
    return next(s for s in result.series if s.name == name)


# --- demo graph: US unemployment ---


def test_unemployment_overview_is_type_and_axes():
    r = run("unemployment_us")
    assert r.overview.text == (
        "Line graph: US unemployment rate, yearly average. Across: year, 2016 to 2024. "
        "Up: unemployment rate, in percent, from 3.6 to 8.1."
    )


def test_unemployment_brief_answers():
    r = run("unemployment_us")
    assert r.answers.trend.answer == "Spikes to 8.1 percent in 2020, then falls back."
    assert r.answers.max.answer == "Highest: 8.1 percent, in 2020."
    assert r.answers.changes.answer == "Low in 2019, peak in 2020, low in 2023."
    assert r.answers.compare.answer == "This graph has only one series, so there is nothing to compare."


def test_unemployment_interest_points_for_next_point_button():
    s = run("unemployment_us").series[0]
    stops = [(p.x, p.kinds) for p in s.interestPoints]
    assert stops == [
        ("2016", ["start"]), ("2019", ["low"]), ("2020", ["max", "peak"]),
        ("2023", ["min", "low"]), ("2024", ["end"]),
    ]
    peak = s.interestPoints[2]
    assert peak.explain == "2020, 8.1 percent. The highest point; after this it falls."
    assert peak.xFraction == 0.5 and peak.normalised == 1


def test_unemployment_trace_angles():
    trace = run("unemployment_us").series[0].trace
    assert len(trace) == 8
    assert trace[0].startFraction == 0 and trace[-1].endFraction == 1
    spike = trace[3]  # 2019 -> 2020
    assert spike.direction == "up" and spike.angle > 70 and spike.endsAtTurningPoint
    assert trace[4].angle < -60  # 2020 -> 2021, sharp fall
    assert all(-90 <= t.angle <= 90 for t in trace)


def test_readouts_are_brief():
    points = run("unemployment_us").series[0].points
    assert points[0].readout == "2016: 4.9."
    assert points[4].readout == "2020: 8.1, highest."
    assert points[3].readout == "2019: 3.7, low point."


# --- two-series graph (compare kept, not shown) ---


def test_italy_japan_turning_points_and_changes():
    r = run("mobile_italy_japan")
    italy = series(r, "Italy")
    assert {p.x for p in italy.points if p.isTurningPoint} == {"2012", "2020"}
    assert r.answers.changes.answer == (
        "Italy: peak in 2012, low in 2020; Japan: rises throughout, with no change of direction."
    )


def test_italy_japan_max_and_compare():
    r = run("mobile_italy_japan")
    assert r.answers.max.answer == "Highest: 169 per 100 people, Japan in 2022."
    assert "cross between 2017 and 2018" in r.answers.compare.answer
    assert "2 lines: Italy and Japan" in r.overview.text


def test_overview_ignores_extraction_summary():
    e = load("ok")
    assert e.graph.summary
    r = reason(e.graph, e.fieldConfidence)
    assert e.graph.summary not in r.overview.text


# --- uncertainty ---


def test_low_confidence_nulls_and_approximately():
    r = run("low_confidence")
    assert r.lowConfidence
    points = r.series[0].points
    q3 = points[2]
    assert q3.value is None and q3.direction == "unknown" and q3.normalised is None
    assert q3.changeStrength is None and q3.readout == "Q3: unreadable."
    assert points[3].direction == "unknown"  # previous value unknown
    assert "about" in r.answers.max.answer
    assert any("Q3" in c for c in r.overview.caveats)
    gap = r.series[0].trace[1]
    assert gap.angle is None and gap.direction == "unknown"


def test_overview_style_uncertainty_first():
    first = run("low_confidence", overview_style="uncertainty_first")
    brief = run("low_confidence", overview_style="brief")
    assert first.overview.text.startswith("Values are approximate.")
    assert brief.overview.text.endswith("Values are approximate.")


def test_field_confidence_triggers_low_confidence():
    e = load("mobile_italy_japan")
    e.fieldConfidence.series = 0.4
    assert reason(e.graph, e.fieldConfidence).lowConfidence


# --- ring / exploration data ---


@pytest.mark.parametrize("name", ["mobile_italy_japan", "unemployment_us", "ok", "low_confidence"])
def test_normalised_and_strength_bounds(name):
    r = run(name)
    norms = [p.normalised for s in r.series for p in s.points if p.normalised is not None]
    assert min(norms) == 0 and max(norms) == 1
    strengths = [p.changeStrength for s in r.series for p in s.points if p.changeStrength is not None]
    assert all(0 <= x <= 1 for x in strengths)
    for s in r.series:
        assert s.points[0].changeStrength in (0, None)
        assert s.intro.startswith(s.name)
        assert [p.index for p in s.interestPoints] == sorted(p.index for p in s.interestPoints)


def test_flat_series_and_ties():
    g = GraphData(
        graphType="line", title="Flat", xAxis={"label": "Day", "values": ["Mon", "Tue", "Wed"]},
        yAxis={"label": "Count"}, series=[{"name": "A", "values": [5, 5, 5]}], confidence=0.9,
    )
    r = reason(g)
    assert r.answers.trend.answer == "Stays around 5."
    assert all(p.normalised == 0.5 for p in r.series[0].points)
    assert all(t.angle == 0 for t in r.series[0].trace)


def test_fmt_number():
    assert fmt_number(159.0) == "159"
    assert fmt_number(4.0) == "4"
    assert fmt_number(12.34) == "12.3"
    assert fmt_number(-3.5) == "minus 3.5"
    assert fmt_number(0.25) == "0.25"
    assert fmt_number(2_250_000, 0) == "2,250,000"
    assert fmt_number(100.9, 1) == "100.9"


def graph(values, x=None, unit="°C", title="Test", names=None):
    names = names or [f"S{i}" for i in range(len(values))]
    return GraphData(
        graphType="line", title=title,
        xAxis={"label": "Month", "values": x or [f"M{i + 1}" for i in range(len(values[0]))]},
        yAxis={"label": "Temperature", "unit": unit},
        series=[{"name": n, "values": v} for n, v in zip(names, values)], confidence=0.9,
    )


@pytest.mark.parametrize("unit", ["°C", "° C", "ºC", "Â°C", "degC"])
def test_unit_variants_are_spoken(unit):
    from app.reasoning import spoken_unit
    assert spoken_unit(unit) == "degrees Celsius"


def test_rounding_keeps_data_precision():
    r = reason(graph([[100, 100.5, 100.2, 100.9, 100.1]]))
    assert "100.9" in r.answers.max.answer
    assert "from 100 to 100 " not in r.overview.text


def test_singular_unit_and_title_punctuation():
    r = reason(graph([[1, 2, 3]], title="Sales by month."))
    assert r.series[0].interestPoints[0].explain.startswith("M1, 1 degree Celsius.")
    assert "Line graph: Sales by month. Across" in r.overview.text


def test_length_mismatch_caveat():
    r = reason(graph([[1, 2, 3, 4, 5]], x=["a", "b", "c"]))
    assert any("misaligned" in c for c in r.overview.caveats)


def test_ties_grouped_by_series():
    r = reason(graph([[1, 9, 1, 9], [9, 1, 9, 1]], names=["A", "B"]))
    assert r.answers.max.answer == "Highest: 9 degrees Celsius, A in M2 and M4; B in M1 and M3."


@pytest.mark.parametrize("values", [[[7]], [[None, None]], [[]], [[1, 2], [None, None]]])
def test_degenerate_inputs_do_not_crash(values):
    x = ["a"] * len(values[0]) if values[0] else []
    r = reason(GraphData(
        graphType="line", title="T", xAxis={"label": "x", "values": x}, yAxis={"label": "y"},
        series=[{"name": f"S{i}", "values": v} for i, v in enumerate(values)], confidence=0.9,
    ))
    assert r.overview.text


# --- LLM guard ---


def test_llm_number_guard():
    assert phrasing_llm.numbers_preserved("peaks at 161 in 2012", "It peaks in 2012 at 161.")
    assert not phrasing_llm.numbers_preserved("peaks at 161 in 2012", "It peaks at 162 in 2012.")


def test_llm_failure_falls_back(monkeypatch):
    monkeypatch.setenv("USE_LLM", "1")
    monkeypatch.setenv("GEMINI_API_KEY", "fake")

    def boom(_):
        raise RuntimeError("network down")

    monkeypatch.setattr(phrasing_llm, "_call_gemini", boom)
    base = run("mobile_italy_japan")
    out = phrasing_llm.rephrase(base)
    assert out == base and out.phrasing == "template"


# --- HTTP ---


def test_endpoints():
    client = TestClient(app)
    mock = client.get("/reason/mock?scenario=mobile_italy_japan")
    assert mock.status_code == 200
    body = mock.json()
    assert set(body["answers"]) == {"trend", "max", "changes", "compare"}

    graph = load("ok").graph.model_dump()
    live = client.post("/reason", json={"graph": graph, "fieldConfidence": None})
    assert live.status_code == 200
    assert live.json()["phrasing"] == "template"

    assert client.get("/reason/mock?scenario=error").status_code == 400
