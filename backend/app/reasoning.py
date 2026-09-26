"""Person 2 - graph reasoning.

Turns confirmed GraphData into an overview, the four preset answers and
per-point exploration data. Every number here is computed deterministically;
the optional LLM layer (phrasing_llm.py) may only reword these texts.
"""

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
    SeriesInsight,
    ValueRange,
)

LOW_CONFIDENCE_THRESHOLD = 0.6  # same threshold as extraction._CONFIDENCE_THRESHOLD
FLAT_FRACTION = 0.02  # moves smaller than 2% of the value range count as flat

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
    def __init__(self, graph: GraphData, field_confidence: FieldConfidence | None = None):
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

    def legs(self, s: SeriesFacts) -> str:
        """Journey through the turning points, e.g. 'rises from 159 in 2011 to 161 in 2012, then falls ...'."""
        stops = [s.points[0]] + [(i, s.values[i]) for i, _ in s.turns] + [s.points[-1]]
        parts = []
        for n, ((i0, v0), (i1, v1)) in enumerate(zip(stops, stops[1:])):
            d = s.direction(v1 - v0)
            verb = {"up": "rises", "down": "falls", "flat": "levels off"}[d]
            start = f" from {self.sp.num(v0)} in {self.xl(i0)}" if n == 0 else ""
            parts.append(f"{verb}{start} to {self.sp.num(v1)} in {self.xl(i1)}")
        if len(parts) == 1:
            return parts[0]
        return ", ".join(parts[:-1]) + ", then " + parts[-1]

    # answers

    def answer_trend(self) -> Answer:
        sentences, highlight = [], []
        for s in self.series:
            if s.empty:
                continue
            first, last = s.points[0], s.points[-1]
            if not s.turns:
                text = f"{s.name} {self.shape(s)}"
                if s.net_direction != "flat":
                    change = "an increase" if last[1] > first[1] else "a decrease"
                    text += f", {change} of {self.sp.say(abs(last[1] - first[1]))}"
                    text = text.replace(
                        f"from {self.sp.num(first[1])} to {self.sp.num(last[1])}",
                        f"from {self.sp.num(first[1])} in {self.xl(first[0])} to {self.sp.num(last[1])} in {self.xl(last[0])}",
                    )
                sentences.append(text + ".")
            else:
                text = f"{s.name} {self.legs(s)}."
                net = s.net_direction
                if net == "flat":
                    text += " Overall, it ends roughly where it started."
                else:
                    word = "rises" if net == "up" else "falls"
                    text += f" Overall, it {word} by {self.sp.say(abs(last[1] - first[1]))}."
                sentences.append(text)
                highlight += [Highlight(series=s.name, index=i) for i, _ in s.turns]
            highlight += [Highlight(series=s.name, index=first[0]), Highlight(series=s.name, index=last[0])]
        if not sentences:
            return Answer(answer="No values could be read, so the trend is unknown.", caveats=self.caveats())
        return Answer(answer=" ".join(sentences), highlight=highlight, caveats=self.caveats())

    def answer_max(self) -> Answer:
        readable = [s for s in self.series if not s.empty]
        if not readable:
            return Answer(answer="No values could be read, so the maximum is unknown.", caveats=self.caveats())
        top = self.hi
        hits = [(s, i) for s in readable for i in s.extreme_indices(True) if s.values[i] == top]
        groups = {}  # series name -> labels, so ties read "A in M2, M4 and M6; B in M1"
        for s, i in hits:
            groups.setdefault(s.name, []).append(self.xl(i))
        if self.multi:
            where = "; ".join(f"{name} in {join_words(labels)}" for name, labels in groups.items())
        else:
            where = join_words(next(iter(groups.values())))
        verb = "reached by" if self.multi else "in"
        sentences = [f"The highest value is {self.sp.say(top)}, {verb} {where}."]
        if len(hits) > 1:
            sentences[0] = f"The highest value, {self.sp.say(top)}, is reached {times_word(len(hits))}: {where}."
        if self.multi:
            for s in readable:
                if any(h[0] is s for h in hits):
                    continue
                idxs = s.extreme_indices(True)
                peak = s.values[idxs[0]]
                sentences.append(
                    f"{s.name}'s highest is {self.sp.num(peak)}, in {join_words([self.xl(i) for i in idxs])}."
                )
        highlight = [Highlight(series=s.name, index=i) for s, i in hits]
        return Answer(answer=" ".join(sentences), highlight=highlight, caveats=self.caveats())

    def answer_changes(self) -> Answer:
        sentences, highlight = [], []
        for s in self.series:
            if s.empty:
                continue
            if not s.turns:
                net = s.net_direction
                if net == "flat":
                    sentences.append(f"{s.name} stays roughly level, with no clear change of direction.")
                else:
                    verb = "rises" if net == "up" else "falls"
                    sentences.append(f"{s.name} {verb} throughout, with no change of direction.")
                continue
            events = []
            for i, kind in s.turns:
                v = self.sp.num(s.values[i])
                events.append(f"peaks at {v} in {self.xl(i)}" if kind == "peak" else f"reaches a low of {v} in {self.xl(i)}")
                highlight.append(Highlight(series=s.name, index=i))
            sentences.append(
                f"{s.name} changes direction {times_word(len(s.turns))}: it " + ", then ".join(events) + "."
            )
        if not sentences:
            return Answer(answer="No values could be read, so changes in the trend are unknown.", caveats=self.caveats())
        return Answer(answer=" ".join(sentences), highlight=highlight, caveats=self.caveats())

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

    # overview

    def overview(self, style: str) -> Overview:
        g = self.graph
        readable = [s for s in self.series if not s.empty]
        span = self.x_span(len(self.x))
        who = f", for {join_words([s.name for s in self.series])}" if self.multi else ""
        unit = self.sp.unit
        if unit:
            unit = f" {unit}" if unit.startswith("per ") else f" in {unit}"
        title = g.title.strip().rstrip(".!?;:,")
        sentences = [
            f"Line graph titled {title}, showing {lower_first(g.yAxis.label)}{unit}"
            f" by {lower_first(g.xAxis.label)}{span}{who}."
        ]
        if readable:
            sentences += [f"{s.name} {self.shape(s)}." for s in readable[:3]]
            sentences.append(self.key_finding(readable))
        else:
            sentences.append("No values could be read from this graph.")

        text = " ".join(s for s in sentences if s)
        if self.low_confidence:
            warning = "This graph was hard to read, so values may be approximate."
            text = f"Caution: {warning} {text}" if style == "uncertainty_first" else f"{text} {warning}"
        return Overview(text=text, caveats=self.caveats())

    def key_finding(self, readable: list[SeriesFacts]) -> str:
        if len(readable) >= 2:
            a, b = readable[0], readable[1]
            runs, _ = self.crossings(a, b)
            real = [r for r in runs if r[0] != "equal"]
            if len(real) >= 2:
                (_, _, end0), (winner, start1, _) = real[0], real[1]
                loser = a.name if winner == b.name else b.name
                return f"{winner} overtakes {loser} between {self.xl(end0)} and {self.xl(start1)}."
            if len(real) == 1:
                return f"{real[0][0]} is higher throughout."
            return ""
        s = readable[0]
        if s.turns:
            # the turning point furthest from its neighbouring stops is the most striking
            stops = [s.points[0][1]] + [s.values[i] for i, _ in s.turns] + [s.points[-1][1]]
            best = max(
                range(len(s.turns)),
                key=lambda k: abs(stops[k + 1] - stops[k]) + abs(stops[k + 1] - stops[k + 2]),
            )
            i, kind = s.turns[best]
            word = "peak" if kind == "peak" else "low point"
            return f"The key moment is a {word} of {self.sp.say(s.values[i])} in {self.xl(i)}."
        idx = s.extreme_indices(True)[0]
        return f"The highest value is {self.sp.say(s.values[idx])}, in {self.xl(idx)}."

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
        if s.empty:
            intro = f"{s.name}. {plural(count, 'point')}, but no values could be read."
        elif len(s.points) == 1:
            intro = f"{s.name}. Only one value: {self.sp.say(s.points[0][1])}, at {self.xl(s.points[0][0])}."
        else:
            intro = f"{s.name}. {plural(count, 'point')},{self.x_span(count)}. It {self.shape(s)}."
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
                    lowConfidence=True, readout=f"{label}, value could not be read.",
                ))
                continue

            normalised = 0.5 if self.span == 0 else (v - self.lo) / self.span
            if i == 0:
                delta, strength, direction = None, 0.0, "flat"
                change = ""
            elif prev is None:
                delta, strength, direction = None, None, "unknown"
                change = f", previous value unknown"
            else:
                delta = v - prev
                strength = 0.0 if self.span == 0 else min(1.0, abs(delta) / self.span)
                direction = s.direction(delta)
                prev_label = self.xl(i - 1)
                if delta == 0:
                    change = f", unchanged from {prev_label}"
                elif direction == "flat":
                    change = f", about the same as {prev_label}"
                else:
                    change = f", {direction} {self.sp.num(abs(delta))} from {prev_label}"

            tags = []
            if i in max_idx:
                tags.append("Highest point.")
            if i in min_idx:
                tags.append("Lowest point.")
            if i in turn_kind and i not in max_idx and i not in min_idx:
                tags.append("A peak; the trend turns down." if turn_kind[i] == "peak" else "A low point; the trend turns up.")

            readout = f"{label}, {self.sp.say(v)}{change}."
            if tags:
                readout += " " + " ".join(tags)
            points.append(PointInsight(
                index=i, x=label, value=v, normalised=round(normalised, 4),
                delta=None if delta is None else round(delta, 6),
                changeStrength=None if strength is None else round(strength, 4),
                direction=direction, isMax=i in max_idx, isMin=i in min_idx,
                isTurningPoint=i in turn_kind, lowConfidence=self.low_confidence, readout=readout,
            ))
        return SeriesInsight(name=s.name, intro=intro, points=points)


def reason(
    graph: GraphData,
    field_confidence: FieldConfidence | None = None,
    overview_style: str | None = None,
) -> ReasoningResponse:
    style = overview_style or os.getenv("OVERVIEW_STYLE", "brief")
    r = Reasoner(graph, field_confidence)
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
