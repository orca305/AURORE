"""운영자가 고르는 답변·해설 모델 설정.

환경변수(AURORE_EXPLAIN_PROVIDER, AURORE_EXPLAIN_MODEL)가 기본값이고, 운영자가 화면에서 바꾸면 이 모듈의 덮어쓰기 값이 우선한다.
덮어쓰기 값은 파일에 저장해서 서버를 다시 켜도 유지한다. 허용 모델 목록 밖의 값은 받지 않는다. API 키는 여기서 다루지 않는다(환경변수로만).
"""
import json
import os
from pathlib import Path

LOCAL = "LOCAL"
_DEFAULT_ALLOWED = "claude-haiku-5-5,claude-sonnet-5-5"
_override: dict | None = None


def allowed_models() -> list[str]:
    """운영자가 고를 수 있는 외부 모델 목록(AURORE_ALLOWED_MODELS, 쉼표로 구분). 로컬은 항상 고를 수 있다."""
    raw = os.environ.get("AURORE_ALLOWED_MODELS", _DEFAULT_ALLOWED)
    return [m.strip() for m in raw.split(",") if m.strip()]


def _state_file() -> Path:
    custom = os.environ.get("AURORE_AI_STATE_FILE", "").strip()
    return Path(custom) if custom else Path(__file__).with_name(".runtime") / "model-override.json"


def provider() -> str:
    """"external" 이면 외부 모델(실패 시 로컬로 대신 처리), "local" 이면 처음부터 로컬만."""
    if _override is not None:
        return _override["provider"]
    return "external" if os.environ.get("AURORE_EXPLAIN_PROVIDER") == "anthropic" else "local"


def external_model() -> str:
    if _override is not None and _override.get("model"):
        return _override["model"]
    return os.environ.get("AURORE_EXPLAIN_MODEL", "claude-haiku-5-5")


def is_overridden() -> bool:
    return _override is not None


def set_model(model: str) -> dict:
    """모델을 바꾼다. 허용 목록에 없으면 ValueError. 파일에 저장해 재시작 후에도 유지한다."""
    global _override
    if model == LOCAL:
        value = {"provider": "local"}
    elif model in allowed_models():
        value = {"provider": "external", "model": model}
    else:
        raise ValueError("MODEL_NOT_ALLOWED")
    _override = value
    path = _state_file()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")
    except OSError as error:
        print("model_override_not_saved", type(error).__name__, flush=True)
    return value


def load() -> None:
    """서버를 켤 때 저장된 덮어쓰기 값을 읽는다. 허용 목록에서 빠진 모델이면 무시한다."""
    global _override
    try:
        value = json.loads(_state_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if value.get("provider") == "local":
        _override = {"provider": "local"}
    elif value.get("provider") == "external" and value.get("model") in allowed_models():
        _override = {"provider": "external", "model": value["model"]}


def reset_for_tests() -> None:
    global _override
    _override = None


load()
