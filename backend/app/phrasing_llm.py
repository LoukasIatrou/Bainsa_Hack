"""Optional LLM rephrasing of the reasoning texts (USE_LLM=1).

Gemini may only reword the template sentences for a listener. Any output that
introduces a number not present in the template, or any error or timeout,
falls back to the template text, so the demo never depends on the network.
"""

import os
import re
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

from pydantic import BaseModel

from .schemas import ReasoningResponse

_MODEL = "gemini-2.5-flash"  # same model as extraction
_TIMEOUT_SECONDS = 3.0
_NUMBER = re.compile(r"\d+(?:\.\d+)?")

_PROMPT = """You rewrite short texts about a line graph so they sound natural when read aloud to a blind listener.
Rules:
- Keep every fact and number exactly as given. Do not add, remove, round or estimate any number.
- Do not add any claim, cause or interpretation that is not in the text.
- Keep each text about the same length or shorter. Plain words, no symbols, no markdown.
Return JSON with the same keys.

Texts:
"""

_EXECUTOR = ThreadPoolExecutor(max_workers=2)


class _Texts(BaseModel):
    overview: str
    trend: str
    max: str
    changes: str
    compare: str


def enabled() -> bool:
    return os.getenv("USE_LLM", "0") == "1" and bool(os.getenv("GEMINI_API_KEY"))


def numbers_preserved(source: str, rewritten: str) -> bool:
    return set(_NUMBER.findall(rewritten)) <= set(_NUMBER.findall(source))


def _call_gemini(texts: _Texts) -> _Texts:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    response = client.models.generate_content(
        model=_MODEL,
        contents=[_PROMPT + texts.model_dump_json(indent=2)],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_Texts,
            temperature=0.2,
        ),
    )
    return _Texts.model_validate_json(response.text or "")


def rephrase(result: ReasoningResponse) -> ReasoningResponse:
    """Return a copy with LLM-reworded texts where safe; otherwise unchanged."""
    if not enabled():
        return result
    a = result.answers
    source = _Texts(
        overview=result.overview.text,
        trend=a.trend.answer,
        max=a.max.answer,
        changes=a.changes.answer,
        compare=a.compare.answer,
    )
    try:
        rewritten = _EXECUTOR.submit(_call_gemini, source).result(timeout=_TIMEOUT_SECONDS)
    except (FutureTimeout, Exception):  # network, quota, parse errors: keep templates
        return result

    out = result.model_copy(deep=True)
    changed = False
    for key in _Texts.model_fields:
        old, new = getattr(source, key), getattr(rewritten, key).strip()
        if not new or not numbers_preserved(old, new):
            continue
        changed = True
        if key == "overview":
            out.overview.text = new
        else:
            getattr(out.answers, key).answer = new
    if changed:
        out.phrasing = "llm"
    return out
