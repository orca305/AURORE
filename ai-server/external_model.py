"""Opt-in external model call (Anthropic Messages API). Disabled unless a caller selects it by environment.

The key comes only from the ANTHROPIC_API_KEY environment variable. Callers must send only text that is
safe to leave the machine (masked question, public official source text); this module does no masking.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request


class ExternalUnavailable(Exception):
    """외부 모델을 쓸 수 없는 상태(예산 소진·인증 오류·과부하·네트워크). 호출자는 로컬 모델로 대신 처리한다. 내용(질문·원문)은 담지 않는다."""

    def __init__(self, kind: str, cooldown: float):
        super().__init__(kind)
        self.kind = kind
        self.cooldown = cooldown


_blocked_until = 0.0
_blocked_kind = ""


def external_blocked() -> str | None:
    """쿨다운 중이면 사유 코드, 아니면 None. 예산이 바닥난 동안 질문마다 실패하는 호출을 하지 않도록 한다."""
    return _blocked_kind if time.time() < _blocked_until else None


def _classify(error: Exception) -> ExternalUnavailable | None:
    """HTTP 오류를 분류한다. 요청 형식 오류(400 중 예산 문구가 아닌 것)는 코드 문제이므로 None(그대로 올린다)."""
    if isinstance(error, urllib.error.HTTPError):
        body = ""
        try:
            body = error.read(2000).decode("utf-8", "replace").lower()
        except Exception:
            pass
        if error.code in (402,) or "credit balance" in body or "billing" in body or "quota" in body:
            return ExternalUnavailable("BUDGET_EXHAUSTED", 900.0)
        if error.code in (401, 403):
            return ExternalUnavailable("AUTH_FAILED", 900.0)
        if error.code in (429, 500, 502, 503, 504, 529):
            return ExternalUnavailable("OVERLOADED", 60.0)
        return None
    if isinstance(error, (urllib.error.URLError, TimeoutError, ConnectionError, OSError)):
        return ExternalUnavailable("NETWORK", 30.0)
    return None


def anthropic_json(system, data, *, schema=None, timeout=60, num_predict=1200, think=None):
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        # 키가 없으면 외부 모델을 쓸 수 없는 상태로 본다(로컬 모델로 대신 처리).
        raise ExternalUnavailable("KEY_MISSING", 300.0)
    model = os.environ.get("AURORE_EXPLAIN_MODEL", "claude-haiku-5-5")
    payload = {
        "model": model,
        "max_tokens": max(num_predict, 2000),
        "system": system + " 반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다: " + json.dumps(schema, ensure_ascii=False),
        "messages": [{"role": "user", "content": json.dumps(data, ensure_ascii=False)}],
    }
    # Haiku 는 기본으로 생각 토큰을 쓰므로 끄고, 응답이 잘리지 않도록 max_tokens 에 여유를 둔다.
    # Sonnet·Opus 계열은 "disabled" 를 받지 않으므로(400) thinking 항목을 보내지 않는다(생각 없이 바로 답한다).
    if "haiku" in model:
        payload["thinking"] = {"type": "disabled"}
    body = json.dumps(payload).encode()
    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    global _blocked_until, _blocked_kind
    blocked = external_blocked()
    if blocked:
        raise ExternalUnavailable(blocked, _blocked_until - time.time())
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = "".join(b.get("text", "") for b in json.load(response).get("content", []) if b.get("type") == "text")
    except Exception as error:
        unavailable = _classify(error)
        if unavailable is None:
            raise
        _blocked_until, _blocked_kind = time.time() + unavailable.cooldown, unavailable.kind
        print("external_model_unavailable", unavailable.kind, "cooldown=%ds" % unavailable.cooldown, flush=True)
        raise unavailable from None
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError("EXPLANATION_INVALID")
    return json.loads(match.group(0))
