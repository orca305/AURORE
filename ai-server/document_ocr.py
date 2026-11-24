"""이미지 속 글자 읽기(OCR). 이 PC의 로컬 비전 모델(Ollama)만 쓰고, 이미지를 파일로 저장하거나 외부로 보내지 않는다.

사진·스캔한 문서(계약서, 내용증명 등)를 첨부할 때 백엔드가 이 엔드포인트로 이미지를 보내 글자를 받는다.
받은 글자는 틀릴 수 있으므로 화면에서 사용자가 원본과 대조해 고치게 한다.
"""
import base64
import binascii
import json
import os
import re
import time
from http.client import HTTPConnection

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, StringConstraints
from typing import Annotated

import call_log

router = APIRouter(prefix="/documents")
MAX_IMAGE = 5 * 1024 * 1024
MAX_TEXT = 50000
PROMPT = (
    "이 이미지는 문서(계약서, 통지서, 영수증 등)를 찍은 사진이나 스캔본입니다. "
    "보이는 글자를 줄바꿈과 문단 구분까지 그대로, 위에서 아래로 빠짐없이 옮겨 적으세요. "
    "표는 줄마다 칸을 ' | '로 구분해 적으세요. 숫자·금액·날짜·이름은 한 글자도 바꾸지 마세요. "
    "설명이나 요약, 추측을 덧붙이지 말고, 읽을 수 없는 글자는 [판독불가]로 표시하세요."
)


class OcrRequest(BaseModel):
    # base64 로 인코딩한 이미지(최대 5MB 원본)
    image: Annotated[str, StringConstraints(min_length=16, max_length=int(MAX_IMAGE * 1.4))]


def image_kind(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def clean(text: str) -> str:
    text = re.sub(r"^```[a-zA-Z]*\n|\n```\s*$", "", text.strip())
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    # 모델이 같은 줄을 끝없이 되풀이하는 경우(환각)를 잘라 낸다.
    out, repeat = [], 0
    for line in lines:
        if out and line.strip() and line.strip() == out[-1].strip():
            repeat += 1
            if repeat >= 3:
                continue
        else:
            repeat = 0
        out.append(line)
    return "\n".join(out).strip()


def looks_unreliable(text: str, raw_len: int) -> bool:
    if not text:
        return True
    if raw_len > MAX_TEXT:
        return True
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    if lines and len(set(lines)) / len(lines) < 0.5 and len(lines) > 12:
        return True
    return False


def ocr_model() -> str:
    # 사진처럼 기울고 흐린 이미지는 작은 모델이 같은 말을 되풀이하며 틀리므로 큰 모델을 기본으로 쓴다.
    return os.getenv("AURORE_OCR_MODEL", "").strip() or "aurore-local:12b"


@router.post("/ocr")
def read_image(payload: OcrRequest):
    try:
        data = base64.b64decode(payload.image, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="IMAGE_INVALID")
    if not data or len(data) > MAX_IMAGE or image_kind(data) is None:
        raise HTTPException(status_code=400, detail="IMAGE_INVALID")
    model = ocr_model()
    host = os.getenv("OLLAMA_HOST", "127.0.0.1:11434").replace("http://", "")
    request = json.dumps({
        "model": model, "stream": False, "think": False, "keep_alive": os.getenv("AURORE_OLLAMA_KEEP_ALIVE", "30m"),
        "messages": [{"role": "user", "content": PROMPT, "images": [payload.image]}],
        "options": {"temperature": 0, "num_predict": 4000},
    })
    started = time.time()
    try:
        connection = HTTPConnection(host, timeout=85)
        connection.request("POST", "/api/chat", request.encode("utf-8"), {"Content-Type": "application/json"})
        response = connection.getresponse()
        body = response.read()
        connection.close()
        if response.status != 200:
            raise RuntimeError("UPSTREAM_%s" % response.status)
        raw = json.loads(body)["message"]["content"]
    except Exception as error:
        call_log.record("local", model, (time.time() - started) * 1000, "ERROR", type(error).__name__)
        raise HTTPException(status_code=503, detail="OCR_UNAVAILABLE")
    text = clean(raw)
    if looks_unreliable(text, len(raw)):
        call_log.record("local", model, (time.time() - started) * 1000, "ERROR", "OCR_UNRELIABLE")
        raise HTTPException(status_code=422, detail="OCR_UNRELIABLE")
    call_log.record("local", model, (time.time() - started) * 1000, "OK")
    return {"text": text[:MAX_TEXT], "model": model}
