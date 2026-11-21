import unittest
from unittest.mock import patch
from fastapi import HTTPException
from legal_explain import ExplainRequest, explain

QUOTE = "임대차가 끝난 후 보증금이 반환되지 아니한 경우 임차인은 임차주택의 소재지를 관할하는 지방법원에 임차권등기명령을 신청할 수 있다."
PROVISO = "임대차기간이 끝나기 6개월 전부터 2개월 전까지 갱신을 요구할 수 있다. 다만, 임차인이 2기의 차임액에 해당하는 금액에 이르도록 차임을 연체한 경우에는 그러하지 아니하다."


def request(quote=QUOTE):
    return ExplainRequest(question="전세보증금을 못 받고 있어요", evidence={"label": "주택임대차보호법 제3조의3 · 2026-01-02 시행본", "quote": quote})


def draft(**override):
    value = {
        "summary": "임대차가 끝났는데 보증금을 돌려받지 못했다면 임차권등기명령을 신청할 수 있습니다.",
        "summaryBasis": "임차권등기명령을 신청할 수 있다",
        "points": [{"kind": "CONDITION", "text": "임대차가 끝난 뒤 보증금이 반환되지 않은 경우에 해당해야 합니다.", "basis": "임대차가 끝난 후 보증금이 반환되지 아니한 경우"}],
        "checkFacts": ["임대차 기간이 실제로 끝났나요?"],
        "needsExpert": False,
    }
    value.update(override)
    return value


OK = {"unsupported": [], "assertsUserFacts": False}


class ExplainTests(unittest.TestCase):
    def test_grounded_draft_passes_after_review(self):
        with patch("legal_explain.local_json", side_effect=[draft(), OK]) as model:
            result = explain(request())
        self.assertTrue(result["verified"])
        self.assertEqual(len(result["points"]), 1)
        self.assertEqual(model.call_count, 2)
        self.assertFalse(model.call_args_list[0].kwargs["think"])

    def assertRejected(self, value, review=OK, quote=QUOTE):
        # 거절 사유 확인 시험은 재시도 없이 한 번만 시도하도록 고정한다(재시도는 별도 시험).
        with patch.dict("os.environ", {"AURORE_EXPLAIN_ATTEMPTS": "1"}), patch("legal_explain.local_json", side_effect=[value, review]):
            with self.assertRaises(HTTPException) as caught:
                explain(request(quote))
        self.assertEqual(caught.exception.status_code, 502)
        return caught.exception.detail

    def test_basis_must_be_verbatim(self):
        self.assertIn("BASIS_NOT_IN_QUOTE", self.assertRejected(draft(summaryBasis="보증금을 즉시 돌려받을 수 있다")))

    def test_invented_figure_or_article_rejected(self):
        self.assertIn("UNSUPPORTED_FIGURE", self.assertRejected(draft(summary="계약 종료 후 1개월 안에 임차권등기명령을 신청할 수 있습니다.")))
        self.assertIn("UNKNOWN_ARTICLE", self.assertRejected(draft(summary="제8조에 따라 우선변제를 받을 수 있습니다.")))

    def test_overconfident_wording_rejected(self):
        self.assertIn("OVERCONFIDENT", self.assertRejected(draft(summary="무조건 보증금을 돌려받을 수 있습니다.")))

    def test_proviso_must_be_explained(self):
        rule = {"kind": "RULE", "text": "임대차기간이 끝나기 6개월 전부터 2개월 전까지 갱신을 요구할 수 있습니다.", "basis": "임대차기간이 끝나기 6개월 전부터 2개월 전까지 갱신을 요구할 수 있다."}
        base = draft(summary="계약 끝나기 6개월 전부터 2개월 전까지 갱신을 요구할 수 있습니다.", summaryBasis="갱신을 요구할 수 있다", points=[rule])
        self.assertIn("PROVISO_NOT_EXPLAINED", self.assertRejected(base, quote=PROVISO))
        exception = {"kind": "EXCEPTION", "text": "다만 차임을 2기분 이상 연체했다면 이 권리를 쓸 수 없습니다.", "basis": "그러하지 아니하다"}
        with patch("legal_explain.local_json", side_effect=[{**base, "points": [rule, exception]}, OK]):
            self.assertEqual(len(explain(request(PROVISO))["points"]), 2)

    def test_review_rejections(self):
        self.assertIn("REVIEW_REJECTED", self.assertRejected(draft(), {"unsupported": [0], "assertsUserFacts": False}))
        self.assertIn("REVIEW_REJECTED", self.assertRejected(draft(), {"unsupported": [], "assertsUserFacts": True}))
        self.assertIn("REVIEW_MISMATCH", self.assertRejected(draft(), {"unsupported": [7], "assertsUserFacts": False}))

    def test_review_can_drop_point_but_not_all(self):
        self.assertIn("REVIEW_REJECTED", self.assertRejected(draft(), {"unsupported": [1], "assertsUserFacts": False}))
        two = draft(points=draft()["points"] + [{"kind": "RULE", "text": "관할 지방법원에 신청합니다.", "basis": "지방법원에 임차권등기명령을 신청할 수 있다"}])
        with patch("legal_explain.local_json", side_effect=[two, {"unsupported": [2], "assertsUserFacts": False}]):
            result = explain(request())
        self.assertEqual(result["reviewDropped"], 1)
        self.assertEqual(len(result["points"]), 1)

    def test_example_may_use_hypothetical_figures_but_summary_may_not(self):
        sample = "예를 들어 계약이 끝나고 두 달이 지나도 보증금 1억 원을 못 받았다면 임차권등기명령을 신청할 수 있어요."
        with patch("legal_explain.local_json", side_effect=[draft(example=sample), OK]) as model:
            result = explain(request())
        self.assertEqual(result["example"], sample)
        review_input = model.call_args_list[1].args[1]
        self.assertEqual(review_input["exampleIndex"], 2)
        self.assertEqual(review_input["items"][2], sample)
        self.assertIn("UNSUPPORTED_FIGURE", self.assertRejected(draft(summary="보증금 1억 원을 못 받았다면 임차권등기명령을 신청할 수 있어요.")))
        self.assertIn("UNKNOWN_ARTICLE", self.assertRejected(draft(example="제8조에 따라 우선변제를 받을 수 있어요.")))

    def test_review_drops_only_a_wrong_example(self):
        with patch("legal_explain.local_json", side_effect=[draft(example="보증금 1억 원이면 바로 돌려받을 수 있어요."), {"unsupported": [2], "assertsUserFacts": False}]):
            result = explain(request())
        self.assertEqual(result["example"], "")
        self.assertEqual(len(result["points"]), 1)
        self.assertEqual(result["reviewDropped"], 1)

    def test_related_provisions_can_ground_points_and_are_reported(self):
        decree = {"label": "주택임대차보호법 시행령 제8조", "quote": "법 제7조에 따른 증액청구는 약정한 차임등의 20분의 1의 금액을 초과하지 못한다."}
        req = ExplainRequest(question="보증금을 얼마까지 올릴 수 있나요", evidence={"label": "주택임대차보호법 제7조", "quote": QUOTE}, related=[decree])
        point = {"kind": "RULE", "text": "보증금은 원래 금액의 20분의 1까지만 올릴 수 있어요.", "basis": "약정한 차임등의 20분의 1의 금액을 초과하지 못한다"}
        with patch("legal_explain.local_json", side_effect=[draft(points=[point]), OK]) as model:
            result = explain(req)
        self.assertEqual(result["sources"], ["주택임대차보호법 시행령 제8조"])
        self.assertEqual(model.call_args_list[0].args[1]["related"][0]["text"], decree["quote"])
        self.assertIn("related", model.call_args_list[1].args[1])
        # 관련 조문에도 없는 문장은 여전히 거절한다.
        with patch.dict("os.environ", {"AURORE_EXPLAIN_ATTEMPTS": "1"}), patch("legal_explain.local_json", side_effect=[draft(points=[{**point, "basis": "어디에도 없는 문장입니다"}]), OK]):
            with self.assertRaises(HTTPException): explain(req)

    def test_external_budget_exhaustion_falls_back_to_local_and_pauses_external_calls(self):
        import external_model
        from urllib.error import HTTPError
        import io
        error = HTTPError("https://api.anthropic.com/v1/messages", 400, "Bad Request", {}, io.BytesIO(b'{"error":{"message":"Your credit balance is too low"}}'))
        env = {"AURORE_EXPLAIN_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "test-key"}
        external_model._blocked_until = 0.0
        try:
            with patch.dict("os.environ", env), patch("external_model.urllib.request.urlopen", side_effect=error) as web,                     patch("legal_explain.local_json", side_effect=[draft(), OK, draft(), OK]) as local:
                first = explain(request())
                second = explain(request())
            self.assertTrue(first["verified"] and second["verified"])
            self.assertEqual(local.call_count, 4)
            # 첫 호출에서 예산 소진을 알게 된 뒤에는 쿨다운 동안 외부 호출을 하지 않는다.
            self.assertEqual(web.call_count, 1)
            self.assertEqual(external_model.external_blocked(), "BUDGET_EXHAUSTED")
        finally:
            external_model._blocked_until = 0.0

    def test_fallback_can_be_disabled_and_bad_requests_are_not_masked(self):
        import external_model
        from urllib.error import HTTPError
        import io
        external_model._blocked_until = 0.0
        env = {"AURORE_EXPLAIN_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "test-key", "AURORE_EXPLAIN_FALLBACK": "0"}
        overloaded = HTTPError("u", 529, "Overloaded", {}, io.BytesIO(b"{}"))
        try:
            with patch.dict("os.environ", env), patch("external_model.urllib.request.urlopen", side_effect=overloaded), patch("legal_explain.local_json", return_value=draft()):
                with self.assertRaises(HTTPException):
                    explain(request())
            external_model._blocked_until = 0.0
            malformed = HTTPError("u", 400, "Bad Request", {}, io.BytesIO(b'{"error":{"message":"max_tokens: invalid"}}'))
            with patch.dict("os.environ", {**env, "AURORE_EXPLAIN_FALLBACK": "1"}), patch("external_model.urllib.request.urlopen", side_effect=malformed), patch("legal_explain.local_json", return_value=draft()) as local:
                with self.assertRaises(HTTPException):
                    explain(request())
                local.assert_not_called()  # 요청 형식 오류는 코드 문제라 로컬로 덮지 않는다
        finally:
            external_model._blocked_until = 0.0

    def test_retry_after_rejection_passes_hint_and_succeeds(self):
        bad = draft(summaryBasis="보증금을 즉시 돌려받을 수 있다")
        with patch("legal_explain.local_json", side_effect=[bad, draft(), OK]) as model:
            result = explain(request())
        self.assertTrue(result["verified"])
        self.assertEqual(model.call_count, 3)
        self.assertNotIn("previousAttempt", model.call_args_list[0].args[1])
        self.assertIn("글자 그대로", model.call_args_list[1].args[1]["previousAttempt"])

    def test_retry_is_bounded_and_keeps_the_same_checks(self):
        bad = draft(summaryBasis="보증금을 즉시 돌려받을 수 있다")
        with patch("legal_explain.local_json", side_effect=[bad, bad]) as model:
            with self.assertRaises(HTTPException) as caught:
                explain(request())
        self.assertIn("BASIS_NOT_IN_QUOTE", caught.exception.detail)
        self.assertEqual(model.call_count, 2)

    def test_summary_only_rejection_is_rescued_by_a_supported_rule_point(self):
        rule = {"kind": "RULE", "text": "임차권등기명령을 신청할 수 있습니다.", "basis": "임차권등기명령을 신청할 수 있다"}
        two = draft(points=[rule] + draft()["points"])
        with patch("legal_explain.local_json", side_effect=[two, {"unsupported": [0], "assertsUserFacts": False}]):
            result = explain(request())
        self.assertEqual(result["summary"], rule["text"])
        self.assertEqual(result["summaryBasis"], rule["basis"])
        self.assertEqual(len(result["points"]), 2)

    def test_external_provider_needs_key_and_is_validated(self):
        env = {"AURORE_EXPLAIN_PROVIDER": "anthropic"}
        import external_model
        external_model._blocked_until = 0.0
        # 키가 없으면 로컬 모델로 대신 처리한다. 로컬 모델도 설정돼 있지 않으면 실패한다(503).
        with patch.dict("os.environ", env, clear=True):
            with self.assertRaises(HTTPException) as caught:
                explain(request())
        self.assertEqual(caught.exception.status_code, 503)
        with patch.dict("os.environ", env, clear=True), patch("legal_explain.local_json", side_effect=[draft(), OK]) as local:
            self.assertTrue(explain(request())["verified"])
            self.assertEqual(local.call_count, 2)
        external_model._blocked_until = 0.0
        # 외부 모델이 만든 결과도 같은 결정적 검증을 통과해야 한다.
        with patch.dict("os.environ", {**env, "ANTHROPIC_API_KEY": "test"}, clear=True):
            with patch("legal_explain._anthropic_json", side_effect=[draft(summaryBasis="없는 구간입니다 정말로"), OK]):
                with self.assertRaises(HTTPException):
                    explain(request())
            with patch("legal_explain._anthropic_json", side_effect=[draft(), OK]) as external:
                self.assertTrue(explain(request())["verified"])
            self.assertEqual(external.call_count, 2)

    def test_basis_tolerates_whitespace_only(self):
        spaced = draft(summaryBasis="임대차가  끝난 후\n보증금이 반환되지 아니한 경우")
        with patch("legal_explain.local_json", side_effect=[spaced, OK]):
            self.assertTrue(explain(request())["verified"])
        self.assertIn("BASIS_NOT_IN_QUOTE", self.assertRejected(draft(summaryBasis="임대차가 끝난 뒤 보증금이 반환되지 아니한 경우")))

    def test_invalid_model_json(self):
        self.assertIn("EXPLANATION_INVALID", self.assertRejected({"summary": "x"}))


if __name__ == "__main__":
    unittest.main()
