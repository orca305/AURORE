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
        self.assertEqual(result["actions"][0]["refs"], [])  # 일반 안내
        self.assertEqual(result["details"][0]["refs"], [1])
        self.assertEqual(result["dropped"], 0)

    def test_unknown_figures_are_kept_but_marked_while_bad_articles_and_refs_are_dropped(self):
        bad = good(details=[{"text": "3년 이하의 징역에 처해질 수 있어요.", "refs": [0]}, {"text": "제760조에 따라 공동 책임이에요.", "refs": []}, {"text": "범위 밖 근거", "refs": [9]}])
        with patch("legal_answer._model_json", return_value=bad):
            result = answer(req())
        self.assertEqual([item["text"] for item in result["details"]], ["3년 이하의 징역에 처해질 수 있어요."])
        self.assertTrue(result["details"][0]["unverifiedFigure"])
        self.assertEqual(result["dropped"], 2)
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

    def test_non_legal_answer(self):
        with patch("legal_answer._model_json", return_value={"legal": False}):
            self.assertEqual(answer(req()), {"legal": False, "verified": True})


if __name__ == "__main__":
    unittest.main()
