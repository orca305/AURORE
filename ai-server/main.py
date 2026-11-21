from contextlib import closing
from http.client import HTTPConnection, HTTPException as UpstreamError
import json
import os
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, StringConstraints

import call_log
from document_answer import router as document_router
from intent_api import router as intent_router
from legal_explain import router as legal_explain_router
from legal_answer import router as legal_answer_router
from local_intent import router as local_intent_router

app = FastAPI(title="AURORE AI", version="3.2.0")
app.include_router(document_router)
app.include_router(intent_router)
app.include_router(local_intent_router)
app.include_router(legal_explain_router)
app.include_router(legal_answer_router)


@app.middleware("http")
async def attach_call_log(request: Request, call_next):
    """/legal/* 요청 하나에서 일어난 모델 호출(단계·모델·시간·토큰·결과)을 X-Aurore-Calls 헤더로 알려 준다(내용 없음)."""
    if not request.url.path.startswith("/legal/") or request.url.path in ("/legal/status", "/legal/model"):
        return await call_next(request)
    tokens = call_log.begin(request.url.path.rsplit("/", 1)[-1])
    try:
        response = await call_next(request)
        value = call_log.header_value()
        if value:
            response.headers["x-aurore-calls"] = value
        return response
    finally:
        call_log.end(tokens)


@app.get("/")
def root():
    return {"message": "AURORE AI server"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "aurore-ai"}


class TestQuestion(BaseModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class TestAnswer(BaseModel):
    answer: str
    mode: Literal["mock", "local"]


@app.post("/dev/ask", response_model=TestAnswer, include_in_schema=False)
def ask_test_question(payload: TestQuestion):
    if os.getenv("AURORE_AI_MOCK") == "1":
        return TestAnswer(answer="질문이 AI 서버에 도착했습니다. 화면 연결을 확인하기 위한 모의 응답입니다.", mode="mock")

    model = os.getenv("AURORE_OLLAMA_MODEL", "").strip()
    if not model:
        raise HTTPException(status_code=503, detail="Local model is not configured")

    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": payload.question}],
        "stream": False,
        "options": {"num_predict": 256},
    })
    try:
        with closing(HTTPConnection("127.0.0.1", 11434, timeout=60)) as connection:
            connection.request("POST", "/api/chat", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            if response.status != 200:
                raise HTTPException(status_code=502, detail="Ollama rejected the request")
            raw_answer = response.read(256_001)
            if len(raw_answer) > 256_000:
                raise HTTPException(status_code=502, detail="Ollama response exceeded the test limit")
            answer = json.loads(raw_answer)["message"]["content"]
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Local model timed out") from exc
    except (OSError, UpstreamError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Local model unavailable") from exc

    if not isinstance(answer, str) or not answer.strip():
        raise HTTPException(status_code=502, detail="Local model returned no answer")
    return TestAnswer(answer=answer.strip(), mode="local")
