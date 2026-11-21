import json
import os
import unittest
from unittest.mock import patch

import call_log
import external_model
import legal_explain
import model_control


class CallLogTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"AURORE_EXPLAIN_PROVIDER": "anthropic", "AURORE_EXPLAIN_MODEL": "claude-haiku-5-5", "AURORE_AI_STATE_FILE": os.devnull}, clear=False)
        self.env.start()
        model_control.reset_for_tests()
        self.tokens = call_log.begin("answer")

    def tearDown(self):
        call_log.end(self.tokens)
        model_control.reset_for_tests()
        self.env.stop()

    def calls(self):
        return json.loads(call_log.header_value() or "[]")

    def test_external_success_records_model_latency_and_tokens_without_content(self):
        def fake(*args, **kwargs):
            call_log.note_usage(1200, 340)
            return {"secret": "질문 내용"}
        with patch.object(legal_explain, "_anthropic_json", fake):
            legal_explain._model_json("system", {"question": "비밀 질문"})
        (call,) = self.calls()
        self.assertEqual((call["stage"], call["provider"], call["model"], call["outcome"], call["in"], call["out"]), ("answer", "external", "claude-haiku-5-5", "OK", 1200, 340))
        self.assertGreaterEqual(call["ms"], 0)
        self.assertNotIn("비밀", call_log.header_value())  # 내용은 담지 않는다

    def test_fallback_is_recorded_for_the_external_attempt_and_the_local_call(self):
        def unavailable(*args, **kwargs):
            raise external_model.ExternalUnavailable("BUDGET_EXHAUSTED", 900.0)
        with patch.object(legal_explain, "_anthropic_json", unavailable), patch.object(legal_explain, "local_json", return_value={}):
            legal_explain._model_json("system", {})
        first, second = self.calls()
        self.assertEqual((first["provider"], first["outcome"], first["error"]), ("external", "FALLBACK", "BUDGET_EXHAUSTED"))
        self.assertEqual((second["provider"], second["outcome"]), ("local", "OK"))

    def test_errors_are_recorded_by_type_only(self):
        with patch.object(legal_explain, "_anthropic_json", side_effect=ValueError("원문 일부가 든 메시지")):
            with self.assertRaises(ValueError):
                legal_explain._model_json("system", {})
        (call,) = self.calls()
        self.assertEqual((call["outcome"], call["error"]), ("ERROR", "ValueError"))
        self.assertNotIn("원문", call_log.header_value())

    def test_no_calls_means_no_header_and_list_is_capped(self):
        self.assertIsNone(call_log.header_value())
        for _ in range(30):
            call_log.record("local", "m", 5, "OK")
        self.assertEqual(len(self.calls()), call_log.MAX_CALLS)


if __name__ == "__main__":
    unittest.main()
