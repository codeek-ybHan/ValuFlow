"""OpenDART 공시 원문(document.xml, ZIP) 파싱.

원문은 DART 고유 XML(DART4)이지만 `R&D` 처럼 이스케이프되지 않은 문자가 섞여 있어 엄격한 XML 파서로는 읽히지 않는다.
그래서 관용적인 파서(HTMLParser)로 구조(SECTION-n / TITLE / P / TABLE)만 뽑는다. 숫자 재무제표 정규화(HistoricalData)와는 완전히 분리된 문서 Retrieval 용 경로다.
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser

from app.dart.models import DartApiError

_WS = re.compile(r"[ \t 　]+")
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def clean_text(s: str) -> str:
    """공백 정리 + 제어문자 제거. 줄바꿈은 문단 경계가 아니라 일반 공백으로 취급한다."""
    return _WS.sub(" ", _CTRL.sub("", s).replace("\r", " ").replace("\n", " ")).strip()


@dataclass
class Block:
    kind: str  # "p" | "table"
    text: str


@dataclass
class Section:
    path: list[str]
    blocks: list[Block] = field(default_factory=list)
    page_number: int | None = None   # PDF 는 page 단위 Section 이고, OpenDART 는 section 경로로 위치를 나타낸다


@dataclass
class ParsedDocument:
    sections: list[Section]

    @property
    def char_count(self) -> int:
        return sum(len(b.text) for s in self.sections for b in s.blocks)


class _DartParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sections: list[Section] = [Section(["표지"])]
        self._stack: list[tuple[int, str]] = []  # (level, title)
        self._cur = self.sections[0]
        self._in_title = False
        self._title_buf: list[str] = []
        self._p_depth = 0
        self._p_buf: list[str] = []
        self._table_depth = 0
        self._rows: list[list[str]] = []
        self._cell: list[str] | None = None

    # 구조
    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.startswith("section-"):
            try:
                level = int(tag.split("-")[1])
            except ValueError:
                return
            while self._stack and self._stack[-1][0] >= level:
                self._stack.pop()
            self._stack.append((level, ""))
            self._cur = Section([t for _, t in self._stack])
            self.sections.append(self._cur)
        elif tag == "title":
            self._in_title, self._title_buf = True, []
        elif tag == "table":
            self._table_depth += 1
            if self._table_depth == 1:
                self._rows = []
        elif tag == "tr" and self._table_depth == 1:
            self._rows.append([])
        elif tag in ("td", "th", "te", "tu") and self._table_depth == 1:
            self._cell = []
        elif tag == "p" and self._table_depth == 0:
            self._p_depth += 1
            if self._p_depth == 1:
                self._p_buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and self._in_title:
            self._in_title = False
            title = clean_text("".join(self._title_buf))
            if self._stack and title:
                level = self._stack[-1][0]
                self._stack[-1] = (level, title)
                self._cur.path = [t for _, t in self._stack]
        elif tag in ("td", "th", "te", "tu") and self._table_depth == 1 and self._cell is not None:
            text = clean_text("".join(self._cell))
            if self._rows:
                self._rows[-1].append(text)
            self._cell = None
        elif tag == "table" and self._table_depth > 0:
            self._table_depth -= 1
            if self._table_depth == 0:
                lines = [" | ".join(c for c in row if c) for row in self._rows]
                text = "\n".join(l for l in lines if l.strip())
                if text:
                    self._cur.blocks.append(Block("table", text))
                self._rows = []
        elif tag == "p" and self._table_depth == 0 and self._p_depth > 0:
            self._p_depth -= 1
            if self._p_depth == 0:
                text = clean_text("".join(self._p_buf))
                if text:
                    self._cur.blocks.append(Block("p", text))

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_buf.append(data)
        elif self._cell is not None:
            self._cell.append(data)
        elif self._p_depth > 0 and self._table_depth == 0:
            self._p_buf.append(data)

    def error(self, message: str) -> None:  # pragma: no cover - HTMLParser API
        pass


def parse_document_xml(xml: str) -> ParsedDocument:
    parser = _DartParser()
    parser.feed(xml)
    parser.close()
    sections = [s for s in parser.sections if s.blocks]
    return ParsedDocument(sections=sections)


def read_document_zip(zip_bytes: bytes) -> str:
    """document.xml 의 ZIP 에서 본문 XML(접수번호.xml)을 읽는다. 첨부(감사보고서 등)는 이번 단계의 대상이 아니다."""
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            names = sorted((n for n in z.namelist() if n.lower().endswith(".xml")), key=lambda n: (n.count("_"), n))
            if not names:
                raise DartApiError("unknown")
            raw = z.read(names[0])
    except zipfile.BadZipFile:
        raise DartApiError("unknown") from None
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")
