"""Sequential evaluation with repository-owned synthetic questions, never user data."""
import argparse
from collections import Counter
from contextlib import closing
from hashlib import sha256
from http.client import HTTPConnection
import json
import math
from pathlib import Path
import subprocess
import sys
from time import perf_counter
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_intent import SYSTEM


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8002")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    address = urlsplit(args.url)
    if address.scheme != "http" or address.hostname != "127.0.0.1" or address.username or address.password or address.path not in ("", "/") or address.query or address.fragment:
        parser.error("Use a loopback HTTP evaluation server")
    if args.out.exists():
        parser.error("Choose a new output file; existing evaluations are preserved")
    dataset = Path(__file__).with_name("local_llm_questions.jsonl")
    rows = [json.loads(line) for line in dataset.read_text(encoding="utf-8").splitlines() if line.strip()]
    labels = ("LEGAL", "NON_LEGAL", "UNCERTAIN")
    if len({row["id"] for row in rows}) != len(rows) or any(row["expected"] not in labels for row in rows):
        raise ValueError("Invalid synthetic dataset")
    def ask(question):
        request = Request(args.url.rstrip("/") + "/intent/analyze", data=json.dumps({"question": question}).encode(), headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=16) as response:
            return json.loads(response.read(16385))
    # Separate warm-up from scored latency; cold model availability is reported.
    started = perf_counter()
    warmup = ask("근로계약서를 작성해야 하는지 궁금해요")
    warmup_seconds = perf_counter() - started
    results, gpu_samples = [], []
    for row in rows:
        started = perf_counter()
        try:
            result = ask(row["question"])
        except Exception:
            result = {"available": False}
        seconds = perf_counter() - started
        predicted = result.get("intent") if result.get("available") is True else "UNAVAILABLE"
        if predicted not in labels:
            predicted = "UNAVAILABLE"
        results.append({**row, "predicted": predicted, "seconds": round(seconds, 4), "analysis": result})
        try:
            gpu_samples.append(int(subprocess.check_output(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], text=True, timeout=3).strip().splitlines()[0]))
        except Exception:
            pass
        print(json.dumps({"completed": len(results), "total": len(rows), "id": row["id"], "predicted": predicted}, ensure_ascii=False), flush=True)
    confusion = Counter((row["expected"], row["predicted"]) for row in results)
    f1 = []
    for label in labels:
        tp = confusion[label, label]
        fp = sum(value for (expected, actual), value in confusion.items() if actual == label and expected != label)
        fn = sum(value for (expected, actual), value in confusion.items() if expected == label and actual != label)
        f1.append(2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0)
    legal_count = sum(row["expected"] == "LEGAL" for row in results)
    latency = sorted(row["seconds"] for row in results)
    metrics = {
        "samples": len(rows), "legal_samples": legal_count,
        "legal_recall": confusion["LEGAL", "LEGAL"] / legal_count,
        "legal_to_non_legal": confusion["LEGAL", "NON_LEGAL"],
        "macro_f1": sum(f1) / len(f1),
        "uncertain_rate": sum(row["predicted"] == "UNCERTAIN" for row in results) / len(rows),
        "unavailable": sum(row["predicted"] == "UNAVAILABLE" for row in results),
        "mean_seconds": sum(latency) / len(latency), "p95_seconds": latency[math.ceil(len(latency) * .95) - 1],
        "max_sampled_gpu_mib": max(gpu_samples, default=None),
    }
    with closing(HTTPConnection("127.0.0.1", 11434, timeout=5)) as connection:
        connection.request("GET", "/api/tags")
        models = json.loads(connection.getresponse().read(64000))["models"]
    model = warmup.get("model")
    report = {
        "dataset_sha256": sha256(dataset.read_bytes()).hexdigest(),
        "prompt_sha256": sha256(SYSTEM.encode()).hexdigest(),
        "implementation_sha256": sha256((dataset.parents[1] / "local_intent.py").read_bytes()).hexdigest(),
        "model": model, "model_digest": next((row["digest"] for row in models if row["name"] == model), None),
        "warmup_seconds": warmup_seconds, "warmup_available": warmup.get("available"),
        "metrics": metrics, "confusion": {label: {actual: confusion[label, actual] for actual in (*labels, "UNAVAILABLE")} for label in labels},
        "quality_candidate": metrics["legal_recall"] >= .95 and metrics["macro_f1"] >= .85 and metrics["legal_to_non_legal"] == 0 and metrics["unavailable"] == 0,
        "routing_enabled": False, "synthetic_only": True, "results": results,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x", encoding="utf-8") as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
    print(json.dumps(metrics, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
