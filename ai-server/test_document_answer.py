import os
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from document_answer import Question, answer_documents, document_health, local_json

ID = "00000000-0000-4000-8000-000000000001"
TEXT = "계약 종료일은 2026년 11월 8일입니다."
class AnswerTests(unittest.TestCase):
    def payload(self):
        return Question(question="계약 종료일은 언제인가요?", documents=[{"id": ID, "name": "검토자료.md", "markdown": TEXT}])
    def test_exact_match_then_separate_relevance(self):
        with patch("document_answer.local_json", side_effect=[{"quotes": [{"documentId": ID, "quote": TEXT}]}, {"approved": [0]}]) as model:
            result = answer_documents(self.payload())
            self.assertEqual(result["quotes"][0]["quote"], TEXT)
            self.assertTrue(result["supportChecked"])
            self.assertEqual(model.call_count, 2)
            self.assertFalse(model.call_args_list[0].kwargs["think"])
            self.assertIn("quotes", model.call_args_list[0].kwargs["schema"]["properties"])
            self.assertIn("approved", model.call_args_list[1].kwargs["schema"]["properties"])
        with patch("document_answer.local_json", side_effect=[{"quotes": [{"documentId": ID, "quote": TEXT}]}, {"approved": []}]):
            self.assertEqual(answer_documents(self.payload())["quotes"], [])
    def test_invented_quote_rejected_before_review(self):
        with patch("document_answer.local_json", return_value={"quotes": [{"documentId": ID, "quote": "원문에 없는 계약 날짜입니다."}]}) as model:
            with self.assertRaises(HTTPException): answer_documents(self.payload())
            self.assertEqual(model.call_count, 1)
    def test_invalid_review_and_unconfigured_model(self):
        with patch("document_answer.local_json", side_effect=[{"quotes": [{"documentId": ID, "quote": TEXT}]}, {"approved": [9]}]):
            with self.assertRaises(HTTPException): answer_documents(self.payload())
        with patch.dict(os.environ, {"AURORE_OLLAMA_MODEL": "", "AURORE_AI_MOCK": "1"}):
            self.assertFalse(document_health()["ready"])
            with self.assertRaises(HTTPException) as error: local_json("system", {})
            self.assertEqual(error.exception.status_code, 503)
    def test_case_context_is_bounded_and_reviewed_separately(self):
        payload=self.payload().model_copy(update={"context":"사용자가 확인한 가상의 사건 사실입니다."})
        with patch("document_answer.local_json", side_effect=[{"quotes":[{"documentId":ID,"quote":TEXT}]},{"approved":[0]}]) as model:
            answer_documents(payload)
            self.assertEqual(model.call_args_list[0].args[1]["context"],payload.context)
            self.assertEqual(model.call_args_list[1].args[1]["context"],payload.context)
        with self.assertRaises(ValueError): Question(question="질문", context="x"*8001, documents=[{"id":ID,"name":"x","markdown":TEXT}])
    def test_context_limits(self):
        with self.assertRaises(ValueError): Question(question="질문", documents=[{"id": ID,"name":"x","markdown":"x"*12001}])
        with self.assertRaises(ValueError): Question(question="질문", documents=[{"id": ID,"name":"x","markdown":TEXT}]*2)
if __name__=="__main__":unittest.main()
