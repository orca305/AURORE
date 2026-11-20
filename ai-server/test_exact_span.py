import unittest
from document_answer import exact_span

SOURCE = "① 임대차는 그 등기(登記)가 없는 경우에도\n임차인(賃借人)이 주택의 인도를 마친 때에는 효력이 생긴다."


class ExactSpanTests(unittest.TestCase):
    def test_verbatim_is_kept(self):
        self.assertEqual(exact_span("임차인(賃借人)이 주택의 인도를 마친 때에는", SOURCE), "임차인(賃借人)이 주택의 인도를 마친 때에는")

    def test_whitespace_difference_restores_the_real_source_span(self):
        span = exact_span("그 등기(登記)가 없는 경우에도 임차인(賃借人)이 주택의 인도를 마친 때에는", SOURCE)
        self.assertEqual(span, "그 등기(登記)가 없는 경우에도\n임차인(賃借人)이 주택의 인도를 마친 때에는")
        self.assertIn(span, SOURCE)

    def test_changed_characters_are_rejected(self):
        self.assertIsNone(exact_span("그 등기가 없는 경우에도 임차인이 주택의 인도를 마친 때에는", SOURCE))
        self.assertIsNone(exact_span("짧은 말", SOURCE))


if __name__ == "__main__":
    unittest.main()
