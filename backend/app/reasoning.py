"""Person 2 - graph reasoning.

Turns confirmed GraphData into an overview, the four preset answers and
per-point exploration data. Every number here is computed deterministically;
the optional LLM layer (phrasing_llm.py) may only reword these texts.
"""

import math
import os
from dataclasses import dataclass, field

from .schemas import (
    Answer,
    Answers,
    FieldConfidence,
    GraphData,
    Highlight,
    Overview,
    PointInsight,
    ReasoningResponse,
    InterestPoint,
    SeriesInsight,
    TraceSegment,
    ValueRange,
)

LOW_CONFIDENCE_THRESHOLD = 0.6  # same threshold as extraction._CONFIDENCE_THRESHOLD
FLAT_FRACTION = 0.02  # moves smaller than 2% of the value range count as flat
CHART_ASPECT = 0.6  # default plot height / width for ring angles when the frontend doesn't send one

_SPOKEN_UNITS = {
    "°C": "degrees Celsius",
    "°F": "degrees Fahrenheit",
    "%": "percent",
    "$": "dollars",
    "€": "euros",
    "£": "pounds",
}


# --- speech formatting ---


def spoken_unit(unit: str | None) -> str:
    if not unit:
        return ""
    unit = unit.strip()
    # tolerate mojibake ('Â°C') and OCR variants ('° C', 'ºC', 'degC')
    key = unit.replace("Â", "").replace("º", "°").replace(" ", "")
    key = {"degC": "°C", "degF": "°F"}.get(key, key)
    return _SPOKEN_UNITS.get(key, unit)


def data_decimals(values: list[float]) -> int:
    """Decimal places the data itself uses (capped at 2), so rounding never hides a change."""
    places = 0
    for v in values:
        while places < 2 and round(v, places) != v:
            places += 1
    return places


def fmt_number(value: float, decimals: int | None = None) -> str:
    """Round for speech: 159, 12.5, 2,250,000. No scientific notation, no '-'.

    Without `decimals`, precision falls back to the value's magnitude.
    """
    magnitude = abs(value)
    if decimals is None:
        decimals = 0 if magnitude >= 100 else 1 if magnitude >= 1 else 2
    text = f"{magnitude:,.{decimals}f}"
    if decimals:
        text = text.rstrip("0").rstrip(".")
    if text == "0":
        return "0"
    return f"minus {text}" if value < 0 else text


def plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


_SINGULAR_UNITS = {"degrees": "degree", "dollars": "dollar", "euros": "euro", "pounds": "pound"}


def join_words(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def times_word(n: int) -> str:
    return {1: "once", 2: "twice"}.get(n, f"{n} times")


def lower_first(text: str) -> str:
    # "Temperature" -> "temperature", but leave acronyms like "GDP" alone
    if len(text) > 1 and text[0].isupper() and text[1].islower():
        return text[0].lower() + text[1:]
    return text


@dataclass
class Speaker:
    unit: str
    approx: bool
    decimals: int = 0  # precision of the source data

    def num(self, value: float, extra: int = 0) -> str:
        """A value without its unit, e.g. 'about 145'. `extra` adds precision for averages."""
        return ("about " if self.approx else "") + fmt_number(value, min(2, self.decimals + extra))

    def say(self, value: float, extra: int = 0) -> str:
        """A value with its unit, e.g. '12 degrees Celsius', '1 degree Celsius'."""
        text = self.num(value, extra)
        if not self.unit:
            return text
        unit = self.unit
        if text.split()[-1] == "1":
            first, _, rest = unit.partition(" ")
            unit = " ".join(filter(None, [_SINGULAR_UNITS.get(first, first), rest]))
        return f"{text} {unit}"


# --- analysis ---


@dataclass
class SeriesFacts:
    name: str
    values: list[float | None]
    x: list[str]
    eps: float
    points: list[tuple[int, float]] = field(init=False)  # (index, value), non-null only
    missing: list[int] = field(init=False)
    turns: list[tuple[int, str]] = field(init=False)  # (index, "peak" | "trough")

    def __post_init__(self) -> None:
        self.points = [(i, v) for i, v in enumerate(self.values) if v is not None]
        self.missing = [i for i, v in enumerate(self.values) if v is None]
        self.turns = find_turning_points(self.points, self.eps)

    @property
    def empty(self) -> bool:
        return not self.points

    def direction(self, delta: float) -> str:
        if delta > self.eps:
            return "up"
        if delta < -self.eps:
            return "down"
        return "flat"

    @property
    def net_direction(self) -> str:
        return self.direction(self.points[-1][1] - self.points[0][1])

    @property
    def steady(self) -> bool:
        """Every step moves the same way (no flats, no reversals, no unreadable gaps)."""
        if any(self.points[0][0] < i < self.points[-1][0] for i in self.missing):
            return False
        dirs = {self.direction(b[1] - a[1]) for a, b in zip(self.points, self.points[1:])}
        return len(dirs) == 1 and "flat" not in dirs

    def extreme_indices(self, pick_max: bool) -> list[int]:
        target = (max if pick_max else min)(v for _, v in self.points)
        return [i for i, v in self.points if v == target]


def find_turning_points(points: list[tuple[int, float]], eps: float) -> list[tuple[int, str]]:
    """Peaks and troughs where the (non-flat) direction reverses.

    A plateau between two opposite moves resolves to its highest point for a
    peak or its lowest point for a trough.
    """
    turns: list[tuple[int, str]] = []
    last_dir: str | None = None
    plateau_start = 0  # position in `points` where the current flat stretch began
    for pos in range(1, len(points)):
        delta = points[pos][1] - points[pos - 1][1]
        if abs(delta) <= eps:
            continue
        cur_dir = "up" if delta > 0 else "down"
        if last_dir and cur_dir != last_dir:
            plateau = points[plateau_start:pos]
            if last_dir == "up":
                idx = max(plateau, key=lambda p: p[1])[0]
                turns.append((idx, "peak"))
            else:
                idx = min(plateau, key=lambda p: p[1])[0]
                turns.append((idx, "trough"))
        last_dir = cur_dir
        plateau_start = pos
    return turns


def is_low_confidence(graph: GraphData, field_confidence: FieldConfidence | None) -> bool:
    if graph.confidence < LOW_CONFIDENCE_THRESHOLD:
        return True
    return field_confidence is not None and field_confidence.series < LOW_CONFIDENCE_THRESHOLD


# --- text builders ---


class Reasoner:
    def __init__(
        self,
        graph: GraphData,
        field_confidence: FieldConfidence | None = None,
        chart_aspect: float | None = None,
    ):
        self.aspect = chart_aspect or CHART_ASPECT
        self.graph = graph
        self.x = graph.xAxis.values
        self.low_confidence = is_low_confidence(graph, field_confidence)
        all_values = [v for s in graph.series for v in s.values if v is not None]
        self.sp = Speaker(spoken_unit(graph.yAxis.unit), self.low_confidence, data_decimals(all_values))
        self.lo = min(all_values) if all_values else None
        self.hi = max(all_values) if all_values else None
        self.span = (self.hi - self.lo) if all_values else 0.0
        eps = self.span * FLAT_FRACTION
        self.series = [SeriesFacts(s.name, s.values, self.x, eps) for s in graph.series]
        self.multi = len(self.series) > 1

    def xl(self, index: int) -> str:
        return self.x[index] if index < len(self.x) else f"point {index + 1}"

    # caveats

    def caveats(self, only: list[SeriesFacts] | None = None) -> list[str]:
        notes = []
        if self.low_confidence:
            notes.append("This graph was hard to read, so the values are approximate.")
        for s in only if only is not None else self.series:
            if s.empty:
                notes.append(f"No values could be read for {s.name}.")
            elif s.missing:
                labels = join_words([self.xl(i) for i in s.missing])
                owner = f"{s.name} value" if self.multi else "value"
                many = len(s.missing) > 1
                notes.append(
                    f"The {owner}{'s' if many else ''} for {labels} could not be read, "
                    f"so {'they are' if many else 'it is'} left out."
                )
            if len(s.values) != len(self.x):
                notes.append(
                    f"{s.name} has {plural(len(s.values), 'value')} but the x-axis has "
                    f"{plural(len(self.x), 'label')}, so some positions may be misaligned."
                )
        return notes

    # shapes

    def shape(self, s: SeriesFacts) -> str:
        """Short shape phrase, e.g. 'rises steadily from 104 to 169'."""
        first, last = s.points[0][1], s.points[-1][1]
        span = f"from {self.sp.num(first)} to {self.sp.num(last)}"
        net = s.net_direction
        if not s.turns:
            if net == "flat":
                return f"stays roughly level, around {self.sp.num(first)}"
            verb = "rises" if net == "up" else "falls"
            return f"{verb} {'steadily ' if s.steady else ''}{span}"
        if len(s.turns) == 1:
            idx, kind = s.turns[0]
            if kind == "peak":
                return f"rises until {self.xl(idx)}, then falls"
            return f"falls until {self.xl(idx)}, then rises"
        if net == "flat":
            return f"ends roughly where it started, at {self.sp.num(last)}, changing direction {times_word(len(s.turns))}"
        verb = "rises overall" if net == "up" else "falls overall"
        return f"{verb}, {span}, changing direction {times_word(len(s.turns))}"

    # answers - kept to one short sentence each: audio is an add-on to the ring

    def prominent_turn(self, s: SeriesFacts) -> tuple[int, str, bool] | None:
        """The turning point that defines the shape, if one does: (index, kind, sharp).

        A turn is prominent when the smaller of its two legs covers at least 30% of
        the value range, so small wobbles never become the headline.
        """
        if not s.turns or self.span == 0:
            return None
        stops = [s.points[0][1]] + [s.values[i] for i, _ in s.turns] + [s.points[-1][1]]
        best, best_leg = None, 0.0
        for k, (i, kind) in enumerate(s.turns):
            legs = (abs(stops[k + 1] - stops[k]), abs(stops[k + 1] - stops[k + 2]))
            if min(legs) > best_leg:
                best, best_leg = (i, kind, legs[0] >= 0.5 * self.span), min(legs)
        return best if best_leg >= 0.3 * self.span else None

    def brief_shape(self, s: SeriesFacts, with_x: bool = False) -> str:
        """e.g. 'spikes to 8.1 percent in 2020, then falls back' or 'rises from 104 to 169 per 100 people'."""
        if len(s.points) == 1:
            return f"only one value, {self.sp.say(s.points[0][1])}"
        turn = self.prominent_turn(s)
        if turn:
            i, kind, sharp = turn
            if kind == "peak":
                verb, back = ("spikes" if sharp else "rises"), "then falls back"
            else:
                verb, back = ("plunges" if sharp else "falls"), "then recovers"
            return f"{verb} to {self.sp.say(s.values[i])} in {self.xl(i)}, {back}"
        (i0, first), (i1, last) = s.points[0], s.points[-1]
        at0, at1 = (f" in {self.xl(i0)}", f" in {self.xl(i1)}") if with_x else ("", "")
        net = s.net_direction
        if net == "flat":
            return f"stays around {self.sp.say(first)}"
        verb = "rises" if net == "up" else "falls"
        return f"{verb} from {self.sp.num(first)}{at0} to {self.sp.say(last)}{at1}"

    def per_series(self, parts: list[tuple[SeriesFacts, str]]) -> str:
        """One sentence; series names only when there is more than one."""
        if not self.multi:
            text = parts[0][1]
            return text[0].upper() + text[1:] + "."
        return "; ".join(f"{s.name}: {text}" for s, text in parts) + "."

    def answer_trend(self) -> Answer:
        readable = [s for s in self.series if not s.empty]
        if not readable:
            return Answer(answer="The trend is unknown: no values could be read.", caveats=self.caveats())
        highlight = []
        parts = []
        for s in readable:
            parts.append((s, self.brief_shape(s, with_x=True)))
            turn = self.prominent_turn(s)
            if turn:
                highlight.append(Highlight(series=s.name, index=turn[0]))
            highlight += [Highlight(series=s.name, index=s.points[0][0]), Highlight(series=s.name, index=s.points[-1][0])]
        return Answer(answer=self.per_series(parts), highlight=highlight, caveats=self.caveats())

    def answer_max(self) -> Answer:
        readable = [s for s in self.series if not s.empty]
        if not readable:
            return Answer(answer="The highest value is unknown: no values could be read.", caveats=self.caveats())
        top = self.hi
        hits = [(s, i) for s in readable for i in s.extreme_indices(True) if s.values[i] == top]
        groups = {}  # series name -> labels, so ties read "A in M2 and M4; B in M1"
        for s, i in hits:
            groups.setdefault(s.name, []).append(self.xl(i))
        if self.multi:
            where = "; ".join(f"{name} in {join_words(labels)}" for name, labels in groups.items())
        else:
            where = "in " + join_words(next(iter(groups.values())))
        highlight = [Highlight(series=s.name, index=i) for s, i in hits]
        return Answer(answer=f"Highest: {self.sp.say(top)}, {where}.", highlight=highlight, caveats=self.caveats())

    def answer_changes(self) -> Answer:
        readable = [s for s in self.series if not s.empty]
        if not readable:
            return Answer(answer="Unknown: no values could be read.", caveats=self.caveats())
        parts, highlight = [], []
        for s in readable:
            if not s.turns:
                word = {"up": "rises", "down": "falls", "flat": "stays level"}[s.net_direction]
                parts.append((s, f"{word} throughout, with no change of direction"))
                continue
            events = [f"{'peak' if kind == 'peak' else 'low'} in {self.xl(i)}" for i, kind in s.turns]
            highlight += [Highlight(series=s.name, index=i) for i, _ in s.turns]
            parts.append((s, ", ".join(events)))
        return Answer(answer=self.per_series(parts), highlight=highlight, caveats=self.caveats())

    def crossings(self, a: SeriesFacts, b: SeriesFacts) -> tuple[list[tuple[str, int, int]], list[int]]:
        """Runs of (leader, first index, last index) and the aligned indices used."""
        aligned = [i for i in range(len(self.x)) if i < len(a.values) and i < len(b.values)
                   and a.values[i] is not None and b.values[i] is not None]
        runs: list[tuple[str, int, int]] = []
        for i in aligned:
            diff = a.values[i] - b.values[i]
            leader = a.name if diff > 0 else b.name if diff < 0 else "equal"
            if runs and runs[-1][0] == leader:
                runs[-1] = (leader, runs[-1][1], i)
            else:
                runs.append((leader, i, i))
        return runs, aligned

    def answer_compare(self) -> Answer:
        if len(self.series) < 2:
            return Answer(answer="This graph has only one series, so there is nothing to compare.")
        a, b = self.series[0], self.series[1]
        caveats = self.caveats([a, b])
        if len(self.series) > 2:
            caveats.insert(0, f"This graph has {len(self.series)} series; comparing the first two, {a.name} and {b.name}.")
        runs, aligned = self.crossings(a, b)
        if not aligned:
            return Answer(answer=f"Not enough values were read to compare {a.name} and {b.name}.", caveats=caveats)

        sentences = []
        if not a.empty and not b.empty:
            sentences.append(f"{a.name} {self.shape(a)}, while {b.name} {self.shape(b)}.")

        gaps = [(abs(a.values[i] - b.values[i]), i) for i in aligned]
        big_gap, big_i = max(gaps)
        highlight = [Highlight(series=a.name, index=big_i), Highlight(series=b.name, index=big_i)]

        leaders = [r for r in runs if r[0] != "equal"]
        if len(runs) == 1 and runs[0][0] != "equal":
            lead = runs[0][0]
            other = b.name if lead == a.name else a.name
            mean_gap = sum(g for g, _ in gaps) / len(gaps)
            sentences.append(
                f"{lead} is higher than {other} at every point, by {self.sp.say(mean_gap, extra=1)} on average."
            )
        elif len(runs) == 1:
            sentences.append(f"{a.name} and {b.name} are equal at every point.")
        elif len(runs) <= 4:
            spans = []
            for leader, i0, i1 in runs:
                when = f"in {self.xl(i0)}" if i0 == i1 else f"from {self.xl(i0)} to {self.xl(i1)}"
                spans.append(f"they are equal {when}" if leader == "equal" else f"{leader} is higher {when}")
            joined = ", then ".join(spans)
            sentences.append(joined[0].upper() + joined[1:] + ".")
        else:
            sentences.append(f"They swap the lead {len(leaders) - 1} times.")

        # crossovers: consecutive runs led by different series
        crosses = []
        for (l0, _, end0), (l1, start1, _) in zip(runs, runs[1:]):
            if l0 != l1 and "equal" not in (l0, l1):
                crosses.append(f"between {self.xl(end0)} and {self.xl(start1)}")
                highlight += [Highlight(series=a.name, index=start1), Highlight(series=b.name, index=start1)]
        if crosses and len(runs) <= 4:
            sentences.append(f"They cross {join_words(crosses)}.")

        ahead = a.name if a.values[big_i] > b.values[big_i] else b.name
        if big_gap > 0:
            sentences.append(f"The biggest gap is {self.sp.say(big_gap)}, in {self.xl(big_i)}, with {ahead} ahead.")
        return Answer(answer=" ".join(sentences), highlight=highlight, caveats=caveats)

    # overview - graph type and axes; the shape itself is left for the ring to reveal

    def overview(self, style: str) -> Overview:
        g = self.graph
        title = g.title.strip().rstrip(".!?;:,")
        sentences = [f"Line graph: {title}."]
        across = self.x_span(len(self.x)).replace(" from ", ", ", 1)
        sentences.append(f"Across: {lower_first(g.xAxis.label)}{across}.")
        unit = self.sp.unit
        unit = (f" {unit}" if unit.startswith("per ") else f", in {unit}") if unit else ""
        up = f"Up: {lower_first(g.yAxis.label)}{unit}"
        if self.lo is not None and self.span > 0:
            up += f", from {self.sp.num(self.lo)} to {self.sp.num(self.hi)}"
        sentences.append(up + ".")
        if self.multi:
            sentences.append(f"{plural(len(self.series), 'line')}: {join_words([s.name for s in self.series])}.")
        if self.lo is None:
            sentences.append("No values could be read.")
        text = " ".join(sentences)
        if self.low_confidence:
            warning = "Values are approximate."
            text = f"{warning} {text}" if style == "uncertainty_first" else f"{text} {warning}"
        return Overview(text=text, caveats=self.caveats())

    # exploration

    def x_span(self, count: int) -> str:
        """' from 2011 to 2022', ' at 2011' for a single point, '' for none."""
        if count == 0:
            return ""
        if count == 1:
            return f" at {self.xl(0)}"
        return f" from {self.xl(0)} to {self.xl(count - 1)}"

    def series_insight(self, s: SeriesFacts) -> SeriesInsight:
        count = len(s.values)
        unit = f", {self.sp.unit}" if self.sp.unit.startswith("per ") else f", in {self.sp.unit}" if self.sp.unit else ""
        if s.empty:
            intro = f"{s.name}: no values could be read."
        else:
            intro = f"{s.name}{unit}{self.x_span(count).replace(' from ', ', ', 1)}."
        turn_kind = dict(s.turns)
        max_idx = set(s.extreme_indices(True)) if not s.empty else set()
        min_idx = set(s.extreme_indices(False)) if not s.empty else set()
        # a flat series or a single point has max == min; don't tag every point as both
        if max_idx == min_idx:
            max_idx, min_idx = set(), set()

        points = []
        for i, v in enumerate(s.values):
            label = self.xl(i)
            prev = s.values[i - 1] if i > 0 else None
            if v is None:
                points.append(PointInsight(
                    index=i, x=label, value=None, normalised=None, delta=None, changeStrength=None,
                    direction="unknown", isMax=False, isMin=False, isTurningPoint=False,
                    lowConfidence=True, readout=f"{label}: unreadable.",
                ))
                continue

            normalised = 0.5 if self.span == 0 else (v - self.lo) / self.span
            if i == 0:
                delta, strength, direction = None, 0.0, "flat"
            elif prev is None:
                delta, strength, direction = None, None, "unknown"
            else:
                delta = v - prev
                strength = self.strength(delta)
                direction = s.direction(delta)

            # the ring conveys direction; speech just names the value and any landmark
            tag = ""
            if i in max_idx:
                tag = ", highest"
            elif i in min_idx:
                tag = ", lowest"
            elif i in turn_kind:
                tag = ", peak" if turn_kind[i] == "peak" else ", low point"
            points.append(PointInsight(
                index=i, x=label, value=v, normalised=round(normalised, 4),
                delta=None if delta is None else round(delta, 6),
                changeStrength=None if strength is None else round(strength, 4),
                direction=direction, isMax=i in max_idx, isMin=i in min_idx,
                isTurningPoint=i in turn_kind, lowConfidence=self.low_confidence,
                readout=f"{label}: {self.sp.num(v)}{tag}.",
            ))
        return SeriesInsight(
            name=s.name, intro=intro, points=points, trace=self.trace(s),
            interestPoints=self.interest_points(s, max_idx, min_idx),
        )

    # explore page: 'Next point' stops and 'Explain' texts

    def interest_points(self, s: SeriesFacts, max_idx: set[int], min_idx: set[int]) -> list[InterestPoint]:
        if s.empty:
            return []
        kinds: dict[int, list[str]] = {}
        kinds.setdefault(s.points[0][0], []).append("start")
        for i in sorted(max_idx):
            kinds.setdefault(i, []).append("max")
        for i in sorted(min_idx):
            kinds.setdefault(i, []).append("min")
        for i, kind in s.turns:
            kinds.setdefault(i, []).append(kind if kind == "peak" else "low")
        if len(s.points) > 1:
            kinds.setdefault(s.points[-1][0], []).append("end")

        n = len(s.values)
        stops = []
        for i in sorted(kinds):
            v = s.values[i]
            stops.append(InterestPoint(
                index=i, x=self.xl(i), value=v,
                xFraction=round(i / (n - 1), 4) if n > 1 else 0.0,
                normalised=round(0.5 if self.span == 0 else (v - self.lo) / self.span, 4),
                kinds=kinds[i], explain=self.explain(s, i, kinds[i]),
            ))
        return stops

    def explain(self, s: SeriesFacts, i: int, kinds: list[str]) -> str:
        """Coordinates, then why the point matters, e.g. '2020, 8.1 percent. The highest point; after this it falls.'"""
        what = []
        if "max" in kinds:
            what.append("the highest point")
        elif "min" in kinds:
            what.append("the lowest point")
        if "peak" in kinds and "max" not in kinds:
            what.append("a peak")
        if "low" in kinds and "min" not in kinds:
            what.append("a low point")
        if "start" in kinds:
            what.append("the start of the graph")
        if "end" in kinds:
            what.append("the end of the graph")
        text = f"{self.xl(i)}, {self.sp.say(s.values[i])}."
        if what:
            label = join_words(what)
            text += f" {label[0].upper()}{label[1:]}"
            if "peak" in kinds:
                text += "; after this it falls"
            elif "low" in kinds:
                text += "; after this it rises"
            text += "."
        return text

    # ring trace

    def strength(self, delta: float) -> float:
        return 0.0 if self.span == 0 else min(1.0, abs(delta) / self.span)

    def trace(self, s: SeriesFacts) -> list[TraceSegment]:
        """Segments for a continuous sweep along the line, evenly spaced in time.

        The angle is the slope as drawn on a plot `aspect` times as tall as it
        is wide, with values scaled to the shared range, so it matches what a
        sighted reader sees: 0 = flat, +90 = straight up, -90 = straight down.
        """
        n = len(s.values)
        if n < 2:
            return []
        turn_idx = {i for i, _ in s.turns}
        dx = 1 / (n - 1)
        segments = []
        for i in range(1, n):
            v0, v1 = s.values[i - 1], s.values[i]
            if v0 is None or v1 is None:
                angle = strength = None
                direction = "unknown"
            else:
                delta = v1 - v0
                dy = 0.0 if self.span == 0 else delta / self.span * self.aspect
                angle = round(math.degrees(math.atan2(dy, dx)), 1)
                strength = round(self.strength(delta), 4)
                direction = s.direction(delta)
            segments.append(TraceSegment(
                fromIndex=i - 1, toIndex=i,
                startFraction=round((i - 1) * dx, 4), endFraction=round(i * dx, 4),
                angle=angle, strength=strength, direction=direction,
                endsAtTurningPoint=i in turn_idx,
            ))
        return segments


def reason(
    graph: GraphData,
    field_confidence: FieldConfidence | None = None,
    overview_style: str | None = None,
    chart_aspect: float | None = None,
) -> ReasoningResponse:
    style = overview_style or os.getenv("OVERVIEW_STYLE", "brief")
    r = Reasoner(graph, field_confidence, chart_aspect)
    return ReasoningResponse(
        overview=r.overview(style),
        answers=Answers(
            trend=r.answer_trend(),
            max=r.answer_max(),
            changes=r.answer_changes(),
            compare=r.answer_compare(),
        ),
        series=[r.series_insight(s) for s in r.series],
        range=ValueRange(min=r.lo, max=r.hi),
        lowConfidence=r.low_confidence,
        phrasing="template",
    )
