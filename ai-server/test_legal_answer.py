import unittest
from unittest.mock import patch
from fastapi import HTTPException
from legal_answer import AnswerRequest, ProposeRequest, answer, propose

PROV = [
    {"label": "민법 제759조(동물의 점유자의 책임)", "text": "①동물의 점유자는 그 동물이 타인에게 가한 손해를 배상할 책임이 있다. 그러나 동물의 종류와 성질에 따라 그 보관에 상당한 주의를 해태하지 아니한 때에는 그러하지 아니하다."},
    {"label": "동물보호법 제101조(과태료)", "text": "③ 다음 각 호의 어느 하나에 해당하는 자에게는 50만원 이하의 과태료를 부과한다."},
]


def req():
    return AnswerRequest(question="반려견이 이웃을 물었어요 제가 책임을 져야 하나요?", provisions=PROV)


def good(**override):
    value = {
        "legal": True,
        "conclusion": "네, 원칙적으로 반려견의 주인이 다친 사람의 손해를 배상할 책임이 있어요.",
        "conclusionRefs": [0],
        "actions": [{"text": "다친 분의 치료비 영수증을 받아 두고 보험 처리를 확인해 보세요.", "refs": []}],
        "details": [{"text": "목줄 위반이면 50만원 이하의 과태료가 나올 수 있어요.", "refs": [1]}],
        "cautions": [{"text": "보관에 상당한 주의를 다했다면 책임을 지지 않을 수 있어요.", "refs": [0]}],
        "checkFacts": ["반려견에게 목줄을 하고 있었나요?"],
        "needsExpert": True,
    }
    value.update(override)
    return value


class ProposeTests(unittest.TestCase):
    def test_keeps_well_formed_articles_only(self):
        out = {"legal": True, "citations": [{"law": "민법", "article": "제759조"}, {"law": "민법", "article": "759"}, {"law": "동물보호법", "article": "제 16 조"}]}
        with patch("legal_answer._model_json", return_value=out):
            result = propose(ProposeRequest(question="반려견이 이웃을 물었어요"))
        self.assertEqual(result["citations"], [{"law": "민법", "article": "제759조"}, {"law": "동물보호법", "article": "제16조"}])

    def test_non_legal(self):
        with patch("legal_answer._model_json", return_value={"legal": False, "citations": []}):
            self.assertFalse(propose(ProposeRequest(question="오늘 점심 뭐 먹지"))["legal"])


class AnswerTests(unittest.TestCase):
    def test_grounded_and_general_items_survive(self):
        with patch("legal_answer._model_json", return_value=good()):
            result = answer(req())
        self.assertTrue(result["legal"])
        self.assertEqual(result["conclusionRefs"], [0])
        self.assertEqual(result["actions"][0]["refs"], [])  # 근거 없는 일반 안내(화면에는 표시 없이 나간다)
        self.assertEqual(result["details"][0]["refs"], [1])
        self.assertEqual(result["dropped"], 0)

    def test_unknown_figures_are_kept_but_marked_while_bad_articles_and_refs_are_dropped(self):
        bad = good(details=[{"text": "3년 이하의 징역에 처해질 수 있어요.", "refs": [0]}, {"text": "범위 밖 근거", "refs": [9]}], actions=[{"text": "제760조에 따라 공동 책임이에요.", "refs": []}])
        with patch("legal_answer._model_json", return_value=bad):
            result = answer(req())
        # 범위 밖 근거 번호는 그 번호만 빼고 항목은 살리며, 원문에 없는 조문 번호가 든 항목만 버린다.
        self.assertEqual([item["text"] for item in result["details"]], ["3년 이하의 징역에 처해질 수 있어요.", "범위 밖 근거"])
        self.assertEqual(result["actions"], [])  # 원문에 없는 조문 번호가 든 항목은 버린다
        self.assertEqual(result["details"][1]["refs"], [])
        self.assertTrue(result["details"][0]["unverifiedFigure"])
        self.assertEqual(result["dropped"], 1)
        self.assertEqual(result["markedFigures"], 1)

    def test_conclusion_with_an_unverified_number_is_kept_and_marked_not_retried(self):
        with patch("legal_answer._model_json", return_value=good(conclusion="네, 보증금을 3개월 안에 돌려받을 수 있어요.")) as model:
            result = answer(req())
        self.assertEqual(model.call_count, 1)
        self.assertTrue(result["conclusionUnverifiedFigure"])

    def test_equivalent_figures_from_fractions_are_allowed(self):
        prov = AnswerRequest(question="질문", provisions=[{"label": "주택임대차보호법 시행령 제8조", "text": "증액청구는 약정한 차임등의 20분의 1의 금액을 초과하지 못한다."}])
        with patch("legal_answer._model_json", return_value=good(conclusion="기존 보증금의 5%까지 올릴 수 있어요.", conclusionRefs=[0], actions=[], details=[], cautions=[])):
            result = answer(prov)
        self.assertFalse(result["conclusionUnverifiedFigure"])
        self.assertEqual(result["markedFigures"], 0)

    def test_bad_conclusion_is_retried_once_then_rejected(self):
        bad = good(conclusion="무조건 100% 배상해야 해요.")
        with patch("legal_answer._model_json", side_effect=[bad, good()]) as model:
            self.assertTrue(answer(req())["legal"])
        self.assertIn("previousAttempt", model.call_args_list[1].args[1])
        with patch("legal_answer._model_json", side_effect=[bad, bad]):
            with self.assertRaises(HTTPException):
                answer(req())

    def test_extra_items_and_long_text_are_trimmed_instead_of_rejecting_the_answer(self):
        many = good(
            actions=[{"text": "할 일 %d" % i, "refs": []} for i in range(6)],
            details=[{"text": "내용 %d" % i, "refs": [0, 1, 0, 1, 0, 1]} for i in range(5)],
            cautions=[{"text": "주의 %d" % i, "refs": []} for i in range(4)],
            checkFacts=["확인 %d" % i for i in range(5)],
            conclusion="결론입니다. " + "가" * 400,
        )
        with patch("legal_answer._model_json", return_value=many) as model:
            result = answer(req())
        self.assertEqual(model.call_count, 1)
        self.assertEqual((len(result["actions"]), len(result["details"]), len(result["cautions"]), len(result["checkFacts"])), (2, 2, 2, 2))
        self.assertLessEqual(len(result["conclusion"]), 300)
        self.assertLessEqual(len(result["details"][0]["refs"]), 2)

    def test_conclusion_keeps_good_sentences_and_drops_only_the_overconfident_one(self):
        mixed = good(conclusion="네, 원칙적으로 배상할 책임이 있어요. 무조건 100% 승소할 수 있어요. 다만 주의를 다했다면 달라질 수 있어요.", conclusionRefs=[0, 9])
        with patch("legal_answer._model_json", return_value=mixed) as model:
            result = answer(req())
        self.assertEqual(model.call_count, 1)
        self.assertEqual(result["conclusion"], "네, 원칙적으로 배상할 책임이 있어요. 다만 주의를 다했다면 달라질 수 있어요.")
        self.assertEqual(result["conclusionRefs"], [0])

    def test_non_legal_answer(self):
        with patch("legal_answer._model_json", return_value={"legal": False}):
            self.assertEqual(answer(req()), {"legal": False, "verified": True})


class RefCheckTests(unittest.TestCase):
    def run_with(self, second):
        with patch("legal_answer.model_control.provider", return_value="external"), patch("legal_answer.external_blocked", return_value=None), patch("legal_answer._model_json", side_effect=[good(), second]) as model:
            return answer(req()), model

    def test_swapped_and_unrelated_refs_are_corrected(self):
        result, model = self.run_with({"results": [{"id": 0, "refs": [0]}, {"id": 1, "refs": []}, {"id": 2, "refs": [0, 9]}]})
        self.assertEqual(model.call_count, 2)
        self.assertEqual(result["conclusionRefs"], [0])
        self.assertEqual(result["details"][0]["refs"], [])  # 관계없는 근거는 뗀다
        self.assertEqual(result["cautions"][0]["refs"], [0])  # 범위 밖 번호는 버린다

    def test_failed_check_keeps_original_refs(self):
        result, _ = self.run_with({"unexpected": True})
        self.assertEqual(result["details"][0]["refs"], [1])

    def test_local_model_skips_the_check(self):
        with patch("legal_answer.model_control.provider", return_value="local"), patch("legal_answer._model_json", return_value=good()) as model:
            answer(req())
        self.assertEqual(model.call_count, 1)


if __name__ == "__main__":
    unittest.main()


PRECS = [
    {"label": "대법원 2024다208865", "text": "판결요지: 개의 점유자가 그 보관에 상당한 주의를 해태하지 않았다는 점은 점유자가 증명하여야 하고, 목줄을 하지 않은 채 산책시킨 경우에는 주의의무를 다했다고 보기 어렵다."},
    {"label": "대법원 2019다100", "text": "판결요지: 임대차 종료 후 보증금 반환과 목적물 인도는 동시이행 관계에 있다."},
]


class PrecedentNoteTests(unittest.TestCase):
    def run_with(self, notes, precedents=PRECS):
        request = AnswerRequest(question="반려견이 이웃을 물었어요 제가 책임을 져야 하나요?", provisions=PROV, precedents=precedents)
        with patch("legal_answer._model_json", return_value=good(precedentNotes=notes)):
            return answer(request)

    def test_grounded_note_survives(self):
        result = self.run_with([{"text": "법원은 목줄을 하지 않은 채 산책시킨 경우 주의의무를 다했다고 보기 어렵다고 판단했어요.", "refs": [0]}])
        self.assertEqual(result["precedentNotes"], [{"text": "법원은 목줄을 하지 않은 채 산책시킨 경우 주의의무를 다했다고 보기 어렵다고 판단했어요.", "refs": [0]}])

    def test_unrelated_invented_or_out_of_range_notes_are_dropped(self):
        result = self.run_with([
            {"text": "법원은 건물 철거를 명령할 수 있다고 판단했어요.", "refs": [0]},  # 요지에 근거 없음
            {"text": "법원은 목줄을 하지 않은 채 산책시킨 경우 주의의무를 다했다고 보기 어렵다고 판단했어요.", "refs": [7]},  # 범위 밖 번호
            {"text": "대법원 2099다1 판결은 목줄을 하지 않은 채 산책시킨 경우 주의의무를 다했다고 보기 어렵다고 봤어요.", "refs": [0]},  # 없는 사건번호
            {"text": "법원은 목줄을 하지 않은 채 산책시킨 경우 주의의무를 다했다고 보기 어렵고 배상액은 300만원이라고 판단했어요.", "refs": [0]},  # 요지에 없는 숫자
            {"text": "법원은 목줄을 하지 않은 채 산책시킨 경우 반드시 책임을 진다고 판단했어요.", "refs": [0]},  # 단정 표현
        ])
        self.assertEqual(result["precedentNotes"], [])

    def test_no_precedents_means_no_notes(self):
        result = self.run_with([{"text": "법원은 목줄을 하지 않은 채 산책시킨 경우 주의의무를 다했다고 보기 어렵다고 판단했어요.", "refs": [0]}], precedents=[])
        self.assertEqual(result["precedentNotes"], [])
