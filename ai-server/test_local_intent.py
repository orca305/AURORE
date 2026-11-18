import unittest
from unittest.mock import patch

from intent_api import IntentQuestion
from local_intent import analyze_intent


class LocalIntentTests(unittest.TestCase):
    def test_strict_hints_remain_shadow_only(self):
        for intent in ("LEGAL", "NON_LEGAL", "UNCERTAIN"):
            result = {"intent": intent, "domain": "other", "keywords": ["검색"], "requires_retrieval": intent != "NON_LEGAL"}
            with patch("local_intent.local_json", return_value=result) as model:
                actual = analyze_intent(IntentQuestion(question="해고"))
                self.assertEqual(actual["intent"], intent)
                self.assertTrue(actual["available"])
                self.assertFalse(actual["routingEnabled"])
                self.assertEqual(model.call_args.kwargs["timeout"], 12)
                self.assertFalse(model.call_args.kwargs["think"])

    def test_model_failure_and_invalid_hints_preserve_retrieval(self):
        invalid = [
            {},
            {"intent": "NON_LEGAL", "domain": "other", "keywords": [], "requires_retrieval": True},
            {"intent": "LEGAL", "domain": "other", "keywords": ["x" * 41], "requires_retrieval": True},
            {"intent": "LEGAL", "domain": "other", "keywords": [], "requires_retrieval": True, "answer": "invented"},
        ]
        for result in invalid:
            with patch("local_intent.local_json", return_value=result):
                actual = analyze_intent(IntentQuestion(question="임금을 안 줘요"))
                self.assertEqual(actual["intent"], "UNCERTAIN")
                self.assertTrue(actual["requires_retrieval"])
                self.assertFalse(actual["available"])
        with patch("local_intent.local_json", side_effect=TimeoutError):
            self.assertTrue(analyze_intent(IntentQuestion(question="질문"))["requires_retrieval"])
