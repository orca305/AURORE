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


class LegalTermHintTests(unittest.TestCase):
    def test_legal_terms_and_law_names_are_returned_and_bounded(self):
        result = {"intent": "LEGAL", "domain": "traffic", "keywords": ["음주운전"], "requires_retrieval": True,
                  "legal_terms": ["술에 취한 상태", "혈중알코올농도"], "law_names": ["도로교통법"]}
        with patch("local_intent.local_json", return_value=result):
            actual = analyze_intent(IntentQuestion(question="술 마시고 운전하면 단속 기준이 뭐예요"))
        self.assertTrue(actual["available"])
        self.assertEqual(actual["legal_terms"], ["술에 취한 상태", "혈중알코올농도"])
        self.assertEqual(actual["law_names"], ["도로교통법"])
        for bad in ({"legal_terms": ["a"] * 6}, {"law_names": ["법"] * 4}):
            with patch("local_intent.local_json", return_value={**result, **bad}):
                bounded = analyze_intent(IntentQuestion(question="질문"))
            self.assertFalse(bounded["available"])
            self.assertEqual(bounded["law_names"], [])

    def test_older_model_output_without_new_fields_stays_valid(self):
        result = {"intent": "LEGAL", "domain": "labor", "keywords": ["임금"], "requires_retrieval": True}
        with patch("local_intent.local_json", return_value=result):
            actual = analyze_intent(IntentQuestion(question="임금을 안 줘요"))
        self.assertTrue(actual["available"])
        self.assertEqual(actual["legal_terms"], [])
