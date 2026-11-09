"""CPU intent experiment on synthetic, single-message Korean questions."""

import argparse
from collections import Counter
import csv
from hashlib import sha256
import json
from pathlib import Path
import re
from time import perf_counter
import unicodedata

from joblib import dump, load
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score
from sklearn.pipeline import make_pipeline


LABELS = ("GENERAL", "LEGAL", "CLARIFY")
SPLITS = ("train", "validation", "test")
DATASET = Path(__file__).with_name("questions.tsv")
LEGAL_TERMS = re.compile(r"법적|위법|법원|법정|신고|청구|소송|과태료|상속|해고|수당|계약|보증금|저작권|산재|환불|권리|삭제 요구")
VAGUE_START = re.compile(r"^(이거|그거|그걸|그 경우|이 정도|아까|그 사람|상대가|저쪽|두 번째)")


def normalize(text):
    return " ".join(unicodedata.normalize("NFKC", text).split())


def load_questions():
    sets = {split: [] for split in SPLITS}
    groups = set()
    questions = set()
    with DATASET.open(encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file, delimiter="\t"):
            split, group, label = row["split"], row["group"], row["label"]
            if split not in sets or label not in LABELS or group in groups:
                raise ValueError(f"Invalid split, label or repeated scenario: {group}")
            groups.add(group)
            for index in range(1, 5):
                question = normalize(row[f"question{index}"])
                if not question or question in questions:
                    raise ValueError(f"Empty or repeated question: {group}/{index}")
                questions.add(question)
                sets[split].append((group, label, question))
    for split, examples in sets.items():
        if {label for _, label, _ in examples} != set(LABELS):
            raise ValueError(f"Missing labels in {split}")
    return sets


def rule_label(question):
    if LEGAL_TERMS.search(question):
        return "LEGAL"
    if VAGUE_START.search(question):
        return "CLARIFY"
    return "GENERAL"


def score(model, questions):
    return [
        max(zip(model.classes_.tolist(), row.tolist()), key=lambda pair: pair[1])
        for row in model.predict_proba(questions)
    ]


def route(scored, threshold):
    return [label if value >= threshold else "CLARIFY" for label, value in scored]


def metrics(expected, predicted):
    matrix = confusion_matrix(expected, predicted, labels=LABELS)
    legal_row = matrix[LABELS.index("LEGAL")]
    return {
        "macro_f1": round(float(f1_score(expected, predicted, labels=LABELS, average="macro")), 4),
        "legal_recall": round(float(legal_row[1] / legal_row.sum()), 4),
        "legal_to_general": int(legal_row[0]),
        "clarify_rate": round(predicted.count("CLARIFY") / len(expected), 4),
        "confusion_matrix": matrix.tolist(),
    }


def train(out_dir):
    data = load_questions()
    _, train_labels, train_questions = zip(*data["train"])
    _, valid_labels, valid_questions = zip(*data["validation"])
    test_groups, test_labels, test_questions = zip(*data["test"])
    model = make_pipeline(
        TfidfVectorizer(analyzer="char", ngram_range=(2, 4), sublinear_tf=True),
        LogisticRegression(C=4.0, max_iter=500),
    )
    start = perf_counter()
    model.fit(train_questions, train_labels)
    fit_ms = (perf_counter() - start) * 1000
    validation_scores = score(model, valid_questions)

    # Select the threshold on validation only. Prefer fewer legal-to-general errors,
    # then higher macro F1. Break ties with the lower threshold.
    choices = [(threshold, metrics(valid_labels, route(validation_scores, threshold)))
               for threshold in (0.40, 0.45, 0.50, 0.55, 0.60)]
    threshold, validation_metrics = min(
        choices, key=lambda item: (item[1]["legal_to_general"], -item[1]["macro_f1"], item[0]),
    )
    start = perf_counter()
    test_scores = score(model, test_questions)
    batch_ms = (perf_counter() - start) * 1000
    raw = [label for label, _ in test_scores]
    routed = route(test_scores, threshold)
    rules = [rule_label(question) for question in test_questions]

    metadata = {
        "sklearn_version": sklearn.__version__,
        "dataset_sha256": sha256(DATASET.read_bytes()).hexdigest(),
        "normalization": "NFKC and collapse whitespace",
        "threshold": threshold,
    }
    report = {
        **metadata,
        "labels_in_matrix_order": LABELS,
        "counts": {split: dict(Counter(label for _, label, _ in rows)) for split, rows in data.items()},
        "validation_routing": validation_metrics,
        "test_rules": metrics(test_labels, rules),
        "test_model": metrics(test_labels, raw),
        "test_routing": metrics(test_labels, routed),
        "test_low_score_redirects": sum(label != final for label, final in zip(raw, routed)),
        "fit_ms": round(fit_ms, 2),
        "test_batch_ms": round(batch_ms, 2),
        "test_errors": [
            {"group": group, "question": question, "expected": expected,
             "raw": label, "score": round(value, 4), "routed": final}
            for group, question, expected, (label, value), final
            in zip(test_groups, test_questions, test_labels, test_scores, routed)
            if expected != label or expected != final
        ],
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    dump({"model": model, **metadata}, out_dir / "intent.joblib")
    (out_dir / "evaluation.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    return {key: value for key, value in report.items() if key != "test_errors"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    train_parser = subcommands.add_parser("train")
    train_parser.add_argument("--out", type=Path, required=True)
    predict_parser = subcommands.add_parser("predict")
    predict_parser.add_argument("--model", type=Path, required=True, help="Only load an artifact you trained locally.")
    predict_parser.add_argument("question")
    args = parser.parse_args()
    if args.command == "train":
        result = train(args.out)
    else:
        question = normalize(args.question)
        if not 1 <= len(question) <= 1000:
            parser.error("Enter a question between 1 and 1,000 characters.")
        saved = load(args.model)
        scored = score(saved["model"], [question])
        raw, value = scored[0]
        result = {"raw": raw, "score": round(value, 4), "route": route(scored, saved["threshold"])[0]}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
