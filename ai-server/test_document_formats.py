import io
import unittest
import zipfile

import document_extract as extract
import document_formats as formats


def make_zip(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buffer.getvalue()


class DocumentFormatsTest(unittest.TestCase):
    def test_csv_and_tsv(self):
        data = "이름,보증금,비고\n김철수,250000000,\"서울, 마포\"\n".encode("utf-8")
        self.assertEqual(extract.extract(data, "csv")["text"], "이름 | 보증금 | 비고\n김철수 | 250000000 | 서울, 마포")
        self.assertIn("가 | 나", extract.extract("가\t나\n".encode("utf-8"), "tsv")["text"])

    def test_csv_cp949(self):
        self.assertIn("보증금", extract.extract("보증금,금액\n".encode("cp949"), "csv")["text"])

    def test_csv_rejects_binary(self):
        with self.assertRaises(ValueError):
            extract.extract(b"PK\x03\x04binary", "csv")

    def test_xlsx_shared_and_inline_strings(self):
        sheet = ('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
                 '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
                 '<row r="2"><c r="A2" t="inlineStr"><is><t>임대인</t></is></c><c r="B2"><v>250000000</v></c></row>'
                 '</sheetData></worksheet>')
        shared = ('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                  '<si><t>항목</t></si><si><t>금액</t></si></sst>')
        data = make_zip({"xl/worksheets/sheet1.xml": sheet, "xl/sharedStrings.xml": shared})
        text = extract.extract(data, "xlsx")["text"]
        self.assertIn("항목 | 금액", text)
        self.assertIn("임대인 | 250000000", text)

    def test_pptx_slides_in_order(self):
        def slide(text):
            return ('<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>%s</a:t></a:r></a:p></p:sld>' % text)
        data = make_zip({"ppt/slides/slide2.xml": slide("둘째"), "ppt/slides/slide1.xml": slide("첫째")})
        text = extract.extract(data, "pptx")["text"]
        self.assertLess(text.index("첫째"), text.index("둘째"))

    def test_odt_paragraphs(self):
        content = ('<office:document-content xmlns:office="o" xmlns:text="t">'
                   '<text:p>제1조 목적</text:p><text:h>제목</text:h></office:document-content>')
        text = extract.extract(make_zip({"content.xml": content}), "odt")["text"]
        self.assertIn("제1조 목적", text)
        self.assertIn("제목", text)

    def test_rtf_text_hex_and_unicode(self):
        rtf = (b"{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\pard Hello \\'b0\\'a1\\'b3\\'aa \\u54620?\\par second line\\par}")
        text = extract.extract(rtf, "rtf")["text"]
        self.assertIn("Hello", text)
        self.assertIn("가나", text)
        self.assertIn("한", text)
        self.assertIn("second line", text)
        self.assertNotIn("Arial", text)

    def test_unsafe_xml_rejected(self):
        bomb = '<!DOCTYPE x [<!ENTITY a "b">]><x/>'
        with self.assertRaises(ValueError):
            formats.parse_xml(bomb.encode())

    def test_xlsx_without_sheets_is_mismatch(self):
        with self.assertRaises(ValueError):
            extract.extract(make_zip({"readme.txt": "x"}), "xlsx")


if __name__ == "__main__":
    unittest.main()
