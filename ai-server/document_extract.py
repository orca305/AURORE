"""Bounded stdin-only text extraction. Uploaded originals are never written to disk."""
import io
import json
import logging
import re
import struct
import sys
import zipfile
import zlib
from xml.etree import ElementTree as ET

MAX_FILE = 5 * 1024 * 1024
MAX_EXPANDED = 20 * 1024 * 1024
MAX_TEXT = 50000


def xml_text(data):
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("UNSAFE_XML")
    root = ET.fromstring(data)
    return "\n".join("".join(n.text or "" for n in p.iter() if n.tag.rsplit("}", 1)[-1] == "t") for p in root.iter() if p.tag.rsplit("}", 1)[-1] == "p")


def hwp_text(data):
    import olefile
    with olefile.OleFileIO(io.BytesIO(data)) as ole:
        header = ole.openstream("FileHeader").read(256)
        if not header.startswith(b"HWP Document File") or len(header) < 40:
            raise ValueError("INVALID_HWP")
        flags = struct.unpack_from("<I", header, 36)[0]
        if flags & 6:
            raise ValueError("PROTECTED_DOCUMENT")
        sections = sorted((p for p in ole.listdir() if len(p) == 2 and p[0] == "BodyText" and re.fullmatch(r"Section[0-9]+", p[1])), key=lambda p: int(p[1][7:]))
        if not sections or len(sections) > 100:
            raise ValueError("DOCUMENT_LIMIT")
        texts, expanded = [], 0
        for section in sections:
            raw = ole.openstream(section).read(MAX_FILE + 1)
            if flags & 1:
                dec = zlib.decompressobj(-15)
                raw = dec.decompress(raw, MAX_EXPANDED - expanded + 1)
                if dec.unconsumed_tail or not dec.eof:
                    raise ValueError("DOCUMENT_LIMIT")
            expanded += len(raw)
            if expanded > MAX_EXPANDED:
                raise ValueError("DOCUMENT_LIMIT")
            pos = 0
            while pos < len(raw):
                if pos + 4 > len(raw):
                    raise ValueError("INVALID_HWP")
                record = struct.unpack_from("<I", raw, pos)[0]
                pos += 4
                tag, size = record & 1023, record >> 20
                if size == 4095:
                    if pos + 4 > len(raw):
                        raise ValueError("INVALID_HWP")
                    size = struct.unpack_from("<I", raw, pos)[0]
                    pos += 4
                if pos + size > len(raw):
                    raise ValueError("INVALID_HWP")
                if tag == 67:
                    text = raw[pos:pos + size].decode("utf-16le", errors="strict")
                    # Inline/extended controls occupy eight UTF-16 units.
                    text = re.sub(r"[\x01-\x09\x0b\x0c\x0e-\x17].{7}", " ", text, flags=re.S)
                    texts.append(re.sub(r"[\x00-\x1f]", " ", text))
                pos += size
        return "\n".join(texts)


def extract(data, kind):
    partial = kind not in ("txt", "md")
    if kind in ("txt", "md"):
        if data.startswith((b"%PDF-", b"PK\x03\x04", b"\xd0\xcf\x11\xe0")) or b"\x00" in data:
            raise ValueError("FORMAT_MISMATCH")
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("cp949", errors="strict")
    elif kind == "pdf":
        from pypdf import PdfReader
        if not data.startswith(b"%PDF-"):
            raise ValueError("FORMAT_MISMATCH")
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise ValueError("PROTECTED_DOCUMENT")
        if len(reader.pages) > 100:
            raise ValueError("DOCUMENT_LIMIT")
        chunks = []
        for page in reader.pages:
            content = page.get_contents()
            if content and len(content.get_data()) > MAX_EXPANDED:
                raise ValueError("DOCUMENT_LIMIT")
            chunks.append(page.extract_text() or "")
            if sum(map(len, chunks)) > MAX_TEXT:
                raise ValueError("DOCUMENT_LIMIT")
        text = "\n\n".join(chunks)
    elif kind in ("docx", "hwpx"):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            info = z.infolist()
            if len(info) > 1000 or sum(p.file_size for p in info) > MAX_EXPANDED or any(p.flag_bits & 1 for p in info) or len(set(z.namelist())) != len(info):
                raise ValueError("DOCUMENT_LIMIT")
            names = ["word/document.xml"] if kind == "docx" else sorted((n for n in z.namelist() if re.fullmatch(r"Contents/section[0-9]+\.xml", n)), key=lambda n: int(re.search(r"section([0-9]+)", n)[1]))
            if not names or any(n not in z.namelist() for n in names):
                raise ValueError("FORMAT_MISMATCH")
            text = "\n".join(xml_text(z.read(n)) for n in names)
    elif kind == "hwp":
        text = hwp_text(data)
    else:
        raise ValueError("UNSUPPORTED_FORMAT")
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        raise ValueError("NO_TEXT")
    if len(text) > MAX_TEXT:
        raise ValueError("DOCUMENT_LIMIT")
    return {"text": text, "partial": partial}


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    try:
        raw = sys.stdin.buffer.read(MAX_FILE + 1)
        if not raw or len(raw) > MAX_FILE:
            raise ValueError("FILE_LIMIT")
        result = extract(raw, sys.argv[1])
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[A-Z_]+", str(error)) else "PARSE_FAILED"
        result = {"error": code}
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
