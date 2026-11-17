"""CPU intent API. Only locally trained artifacts; no user-data storage or training."""
from functools import lru_cache
from hashlib import sha256
import json
import math
import os
import unicodedata
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

router = APIRouter(prefix="/intent")
MODEL_DIR = Path(__file__).resolve().parent / ".intent-model"
DATASET = Path(__file__).resolve().parent / "intent_lab" / "questions.tsv"
LABELS = {"GENERAL", "LEGAL", "CLARIFY"}

class IntentQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]

    @field_validator("question")
    @classmethod
    def normalized_question(cls, value):
        normalized = " ".join(unicodedata.normalize("NFKC", value).split())
        if not 1 <= len(normalized) <= 1000:
            raise ValueError("Question must contain 1-1000 normalized characters")
        return normalized

@lru_cache(maxsize=1)
def classifier():
    # joblib is pickle-based: this fixed, private path is populated only by our local training command.
    from joblib import load
    import sklearn
    from intent_lab.intent import normalize, score
    artifact_path = MODEL_DIR / "intent.joblib"
    report = json.loads((MODEL_DIR / "evaluation.json").read_text(encoding="utf-8"))
    digest = sha256(artifact_path.read_bytes()).hexdigest()
    if report.get("model_sha256") != digest:
        raise ValueError("Model fingerprint mismatch")
    saved = load(artifact_path)
    dataset_hash = sha256(DATASET.read_bytes()).hexdigest()
    if (saved.get("dataset_sha256") != dataset_hash or report.get("dataset_sha256") != dataset_hash
            or saved.get("sklearn_version") != sklearn.__version__ or report.get("sklearn_version") != sklearn.__version__
            or saved.get("normalization") != "NFKC and collapse whitespace"
            or report.get("threshold") != saved.get("threshold")
            or set(saved["model"].classes_) != LABELS):
        raise ValueError("Model metadata mismatch")
    threshold = saved["threshold"]
    if not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError("Invalid threshold")
    # A validation/test pass is necessary, never sufficient for production approval.
    eligible = all(
        isinstance(report.get(split), dict)
        and isinstance(report[split].get("legal_recall"), (int, float))
        and isinstance(report[split].get("macro_f1"), (int, float))
        and 0.95 <= report[split]["legal_recall"] <= 1
        and 0.85 <= report[split]["macro_f1"] <= 1
        and report[split].get("legal_to_general") == 0
        for split in ("validation_routing", "test_routing")
    )
    return saved, digest, eligible, normalize, score

def routing_enabled(eligible):
    return eligible and os.getenv("AURORE_INTENT_ENABLE_ROUTING") == "1"

@router.get("/health")
def intent_health():
    try:
        _, version, eligible, _, _ = classifier()
        return {"ready": True, "modelVersion": version, "evaluationEligible": eligible,
                "routingEnabled": routing_enabled(eligible)}
    except Exception:
        return {"ready": False, "evaluationEligible": False, "routingEnabled": False}

@router.post("/classify")
def classify_intent(payload: IntentQuestion):
    try:
        saved, version, eligible, normalize, score = classifier()
        text = normalize(payload.question)
        if not text or len(text) > 1000:
            raise ValueError("Invalid normalized question")
        raw, confidence = score(saved["model"], [text])[0]
        if raw not in LABELS or not math.isfinite(confidence) or not 0 <= confidence <= 1:
            raise ValueError("Invalid classification")
        route = raw if confidence >= saved["threshold"] else "CLARIFY"
        return {"label": raw, "score": round(confidence, 6), "route": route,
                "modelVersion": version, "evaluationEligible": eligible,
                "routingEnabled": routing_enabled(eligible)}
    except Exception as error:
        raise HTTPException(status_code=503, detail="Intent classifier is not ready") from error
