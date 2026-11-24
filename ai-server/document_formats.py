"""스프레드시트·발표자료·표·RTF·OpenDocument 글자 추출. document_extract.py 가 부른다(원본을 디스크에 쓰지 않는다)."""
import csv
import io
import re
import zipfile
from xml.etree import ElementTree as ET

MAX_EXPANDED = 20 * 1024 * 1024
MAX_TEXT = 50000
MAX_ROWS = 5000


def local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_xml(data):
    upper = data.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise ValueError("UNSAFE_XML")
    return ET.fromstring(data)


def safe_zip(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    info = z.infolist()
    if len(info) > 2000 or sum(p.file_size for p in info) > MAX_EXPANDED or any(p.flag_bits & 1 for p in info) or len(set(z.namelist())) != len(info):
        raise ValueError("DOCUMENT_LIMIT")
    return z


def number_key(name):
    match = re.search(r"(\d+)\.xml$", name)
    return int(match.group(1)) if match else 0


def decode_text(data):
    if b"\x00" in data:
        raise ValueError("FORMAT_MISMATCH")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp949", errors="strict")


def table_text(data, delimiter):
    if data.startswith((b"%PDF-", b"PK\x03\x04", b"\xd0\xcf\x11\xe0")):
        raise ValueError("FORMAT_MISMATCH")
    rows = []
    for row in csv.reader(io.StringIO(decode_text(data)), delimiter=delimiter):
        if len(rows) >= MAX_ROWS:
            raise ValueError("DOCUMENT_LIMIT")
        line = " | ".join(cell.strip().replace("\n", " ") for cell in row).strip(" |")
        if line:
            rows.append(line)
    return "\n".join(rows)


_RTF_SKIP = {"fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "footnote", "themedata", "colorschememapping", "latentstyles", "datastore", "generator", "listtable", "listoverridetable", "rsidtbl", "xmlnstbl", "mmathPr", "fldinst", "object", "shpinst"}
_RTF_TOKEN = re.compile(r"\\'([0-9a-fA-F]{2})|\\u(-?\d+)\??|\\([a-zA-Z]+)(-?\d+)? ?|\\([^a-zA-Z'])|([{}])|([^\\{}]+)")


def rtf_text(data):
    text = data.decode("latin-1")
    if not text.startswith("{\\rtf"):
        raise ValueError("FORMAT_MISMATCH")
    out, pending = [], bytearray()
    depth, skip_from = 0, None
    star_next = False

    def flush():
        if pending:
            out.append(bytes(pending).decode("cp949", errors="replace"))
            pending.clear()

    for match in _RTF_TOKEN.finditer(text):
        hexa, uni, word, _param, symbol, brace, plain = match.groups()
        if hexa is not None:
            if skip_from is None:
                pending.append(int(hexa, 16))
            continue
        flush()
        if brace == "{":
            depth += 1
            star_next = False
        elif brace == "}":
            if skip_from is not None and depth <= skip_from:
                skip_from = None
            depth -= 1
        elif word is not None:
            if skip_from is None and (star_next or word in _RTF_SKIP):
                skip_from = depth
            star_next = False
            if skip_from is None:
                if word in ("par", "line", "sect", "page"):
                    out.append("\n")
                elif word == "tab":
                    out.append("\t")
        elif symbol is not None:
            if symbol == "*":
                star_next = True
            elif symbol in "{}\\" and skip_from is None:
                out.append(symbol)
        elif uni is not None:
            if skip_from is None:
                code = int(uni)
                out.append(chr(code + 65536 if code < 0 else code))
        elif plain is not None and skip_from is None:
            out.append(plain)
        if sum(map(len, out)) > MAX_TEXT * 4:
            raise ValueError("DOCUMENT_LIMIT")
    flush()
    return re.sub(r"\n{3,}", "\n\n", "".join(out).replace("\r", ""))


def xlsx_text(data):
    z = safe_zip(data)
    names = z.namelist()
    shared = []
    if "xl/sharedStrings.xml" in names:
        root = parse_xml(z.read("xl/sharedStrings.xml"))
        for si in root:
            if local(si.tag) == "si":
                shared.append("".join(t.text or "" for t in si.iter() if local(t.tag) == "t"))
    sheets = sorted((n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)), key=number_key)
    if not sheets or len(sheets) > 50:
        raise ValueError("FORMAT_MISMATCH" if not sheets else "DOCUMENT_LIMIT")
    lines, rows = [], 0
    for index, name in enumerate(sheets, 1):
        lines.append("## 시트 %d" % index)
        root = parse_xml(z.read(name))
        for row in root.iter():
            if local(row.tag) != "row":
                continue
            rows += 1
            if rows > MAX_ROWS:
                raise ValueError("DOCUMENT_LIMIT")
            cells = []
            for cell in row:
                if local(cell.tag) != "c":
                    continue
                kind, value = cell.get("t"), ""
                if kind == "inlineStr":
                    value = "".join(t.text or "" for t in cell.iter() if local(t.tag) == "t")
                else:
                    v = next((child for child in cell if local(child.tag) == "v"), None)
                    value = (v.text or "") if v is not None else ""
                    if kind == "s" and value.isdigit() and int(value) < len(shared):
                        value = shared[int(value)]
                cells.append(value.strip().replace("\n", " "))
            line = " | ".join(cells).strip(" |")
            if line:
                lines.append(line)
    return "\n".join(lines)


def pptx_text(data):
    z = safe_zip(data)
    slides = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=number_key)
    if not slides:
        raise ValueError("FORMAT_MISMATCH")
    if len(slides) > 300:
        raise ValueError("DOCUMENT_LIMIT")
    lines = []
    for index, name in enumerate(slides, 1):
        lines.append("## 슬라이드 %d" % index)
        root = parse_xml(z.read(name))
        for paragraph in root.iter():
            if local(paragraph.tag) == "p":
                text = "".join(t.text or "" for t in paragraph.iter() if local(t.tag) == "t").strip()
                if text:
                    lines.append(text)
    return "\n".join(lines)


def odf_text(data):
    z = safe_zip(data)
    if "content.xml" not in z.namelist():
        raise ValueError("FORMAT_MISMATCH")
    root = parse_xml(z.read("content.xml"))
    lines = []
    for element in root.iter():
        if local(element.tag) in ("p", "h"):
            text = "".join(element.itertext()).strip()
            if text:
                lines.append(text)
        if len(lines) > MAX_ROWS * 4:
            raise ValueError("DOCUMENT_LIMIT")
    return "\n".join(lines)
