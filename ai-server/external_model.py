"""Opt-in external model call (Anthropic Messages API). Disabled unless a caller selects it by environment.

The key comes only from the ANTHROPIC_API_KEY environment variable. Callers must send only text that is
safe to leave the machine (masked question, public official source text); this module does no masking.
"""
import json
import os
import re
import urllib.request


def anthropic_json(system, data, *, schema=None, timeout=60, num_predict=1200, think=None):
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise ValueError("EXTERNAL_KEY_MISSING")
    body = json.dumps({
        "model": os.environ.get("AURORE_EXPLAIN_MODEL", "claude-haiku-5-5"),
        # 이 모델은 기본으로 생각 토큰을 쓰므로, 끄고 응답이 잘리지 않도록 여유를 둔다.
        "thinking": {"type": "disabled"},
        "max_tokens": max(num_predict, 2000),
        "system": system + " 반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다: " + json.dumps(schema, ensure_ascii=False),
        "messages": [{"role": "user", "content": json.dumps(data, ensure_ascii=False)}],
    }).encode()
    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        text = "".join(b.get("text", "") for b in json.load(response).get("content", []) if b.get("type") == "text")
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError("EXPLANATION_INVALID")
    return json.loads(match.group(0))
