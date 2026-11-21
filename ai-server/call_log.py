"""모델 호출 기록(모니터링용). 요청마다 호출 목록을 모아 응답 헤더(X-Aurore-Calls)로 백엔드에 알려 준다.
질문·원문·답변 내용은 담지 않는다. 담는 것은 단계, 제공자(외부/로컬), 모델 이름, 걸린 시간, 토큰 수, 결과 코드뿐이다.
"""
import json
from contextvars import ContextVar

_calls: ContextVar[list | None] = ContextVar("aurore_calls", default=None)
_stage: ContextVar[str] = ContextVar("aurore_stage", default="")
_usage: ContextVar[dict | None] = ContextVar("aurore_usage", default=None)
MAX_CALLS = 12


def begin(stage: str):
    """요청을 시작할 때 부른다. 이 요청에서 일어나는 모델 호출이 같은 목록에 쌓인다."""
    return _calls.set([]), _stage.set(stage)


def end(tokens) -> None:
    _calls.reset(tokens[0])
    _stage.reset(tokens[1])


def note_usage(input_tokens, output_tokens) -> None:
    """외부 모델 응답의 토큰 수를 방금 호출 기록에 붙이기 위해 잠시 둔다."""
    def num(value):
        return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
    _usage.set({"in": num(input_tokens), "out": num(output_tokens)})


def take_usage() -> dict:
    value = _usage.get() or {"in": None, "out": None}
    _usage.set(None)
    return value


def record(provider: str, model: str, ms: float, outcome: str, error: str | None = None, usage: dict | None = None) -> None:
    calls = _calls.get()
    if calls is None or len(calls) >= MAX_CALLS:
        return
    usage = usage or {"in": None, "out": None}
    calls.append({
        "stage": (_stage.get() or "")[:20],
        "provider": provider,
        "model": (model or "")[:60],
        "ms": int(max(0, ms)),
        "in": usage.get("in"),
        "out": usage.get("out"),
        "outcome": outcome,
        "error": (error or None) and error[:30],
    })


def header_value() -> str | None:
    calls = _calls.get()
    if not calls:
        return None
    text = json.dumps(calls, ensure_ascii=False, separators=(",", ":"))
    return text if len(text) <= 3500 else None
