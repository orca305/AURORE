import io
import struct
import unittest
import zipfile
from document_extract import extract


def package(kind, text):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        if kind == 'docx':
            z.writestr('word/document.xml', '<doc xmlns:w="urn:test"><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></doc>')
        else:
            z.writestr('Contents/section0.xml', '<doc xmlns:hp="urn:test"><hp:p><hp:run><hp:t>'+text+'</hp:t></hp:run></hp:p></doc>')
    return buffer.getvalue()


def legacy_hwp(text):
    # Minimal synthetic CFB/HWP 5 fixture, with two regular 4096-byte streams.
    FREE, END, FAT = 0xffffffff, 0xfffffffe, 0xfffffffd
    header = bytearray(512)
    header[:8] = bytes.fromhex('d0cf11e0a1b11ae1')
    struct.pack_into('<HHHHH', header, 24, 0x3e, 3, 0xfffe, 9, 6)
    struct.pack_into('<IIIIIIIII', header, 40, 0, 1, 0, 0, 4096, END, 0, END, 0)
    struct.pack_into('<109I', header, 76, 17, *([FREE]*108))
    def entry(name, typ, child=FREE, right=FREE, start=END, size=0):
        row = bytearray(128); name=(name+'\0').encode('utf-16le');row[:len(name)]=name
        struct.pack_into('<HBBIII',row,64,len(name),typ,1,FREE,right,child)
        struct.pack_into('<IQ',row,116,start,size);return row
    directory = entry('Root Entry',5,child=2)+entry('FileHeader',2,start=1,size=4096)+entry('BodyText',1,child=3,right=1)+entry('Section0',2,start=9,size=4096)
    file_header=bytearray(4096);file_header[:17]=b'HWP Document File';file_header[32:36]=bytes([0,0,0,5])
    content=text.encode('utf-16le');section=struct.pack('<I',67|(len(content)<<20))+content;section=section.ljust(4096,b'\0')
    fat=[FREE]*128;fat[0]=END
    for first in (1,9):
        for n in range(first,first+7):fat[n]=n+1
        fat[first+7]=END
    fat[17]=FAT
    return bytes(header)+bytes(directory)+bytes(file_header)+section+struct.pack('<128I',*fat)


class ExtractTests(unittest.TestCase):
    def test_text_and_zip_and_hwp(self):
        text='가상의 계약 종료 통지'
        self.assertEqual(extract(text.encode(),'txt'), {'text':text,'partial':False})
        for kind in ['docx','hwpx','hwp']:
            data=legacy_hwp(text) if kind=='hwp' else package(kind,text)
            self.assertEqual(extract(data,kind),{'text':text,'partial':True})
    def test_pdf_and_protected_and_scan(self):
        from pypdf import PdfWriter
        from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
        writer=PdfWriter();page=writer.add_blank_page(200,200)
        font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 10 100 Td (Synthetic lease document) Tj ET');page[NameObject('/Contents')]=writer._add_object(stream)
        output=io.BytesIO();writer.write(output);self.assertIn('Synthetic lease document',extract(output.getvalue(),'pdf')['text'])
        writer.encrypt('not-a-user-password');output=io.BytesIO();writer.write(output)
        with self.assertRaisesRegex(ValueError,'PROTECTED_DOCUMENT'):extract(output.getvalue(),'pdf')
        writer=PdfWriter();writer.add_blank_page(200,200);output=io.BytesIO();writer.write(output)
        with self.assertRaisesRegex(ValueError,'NO_TEXT'):extract(output.getvalue(),'pdf')
    def test_invalid_formats_and_unsafe_xml(self):
        with self.assertRaises(ValueError):extract(b'%PDF-fake','txt')
        with self.assertRaises(ValueError):extract(b'not a pdf','pdf')
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as z:z.writestr('word/document.xml','<!DOCTYPE x><doc/>')
        with self.assertRaisesRegex(ValueError,'UNSAFE_XML'):extract(buffer.getvalue(),'docx')
        with self.assertRaisesRegex(ValueError,'DOCUMENT_LIMIT'):extract(b'x'*50001,'md')

if __name__=='__main__':unittest.main()
