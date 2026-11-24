import base64
import unittest

import document_ocr as ocr


class DocumentOcrTest(unittest.TestCase):
    def test_image_kind_uses_magic_bytes(self):
        self.assertEqual(ocr.image_kind(b"\x89PNG\r\n\x1a\n" + b"0" * 8), "png")
        self.assertEqual(ocr.image_kind(b"\xff\xd8\xff\xe0" + b"0" * 8), "jpg")
        self.assertEqual(ocr.image_kind(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "webp")
        self.assertIsNone(ocr.image_kind(b"%PDF-1.7 not an image"))
        self.assertIsNone(ocr.image_kind(b"hello world"))

    def test_clean_removes_code_fence_and_repeated_lines(self):
        self.assertEqual(ocr.clean("```text\n제1조 목적\n```"), "제1조 목적")
        looped = "제1조\n" + "같은 줄\n" * 10 + "제2조"
        cleaned = ocr.clean(looped).split("\n")
        self.assertLessEqual(cleaned.count("같은 줄"), 4)
        self.assertEqual(cleaned[0], "제1조")
        self.assertEqual(cleaned[-1], "제2조")

    def test_unreliable_when_empty_or_looping(self):
        self.assertTrue(ocr.looks_unreliable("", 0))
        self.assertTrue(ocr.looks_unreliable("한 줄\n" * 20, 100))
        self.assertFalse(ocr.looks_unreliable("제1조 목적\n제2조 기간\n제3조 대금", 30))

    def test_rejects_non_image_payload(self):
        from fastapi import HTTPException
        payload = ocr.OcrRequest(image=base64.b64encode(b"not an image at all really").decode())
        with self.assertRaises(HTTPException) as caught:
            ocr.read_image(payload)
        self.assertEqual(caught.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
