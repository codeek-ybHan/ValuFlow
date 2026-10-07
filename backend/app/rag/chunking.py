"""문서 구조(section → paragraph → chunk)를 보존하는 chunking.

- section 경계를 넘어 chunk 를 합치지 않는다 (chunk 하나는 한 section 에 속한다).
- 문단(P)과 표(table)는 가능한 한 통째로 모으고, target 크기를 넘으면 새 chunk 를 시작한다.
- 한 문단이 max 를 넘을 때만 문장 경계에서 자르고, 그 경우에만 아주 작은 overlap 을 둔다.
- 숫자뿐인 표처럼 글자가 거의 없는 chunk 는 검색 가치가 없어 버린다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.dart.documents import ParsedDocument  # OpenDART · PDF 공통: .sections 를 가진 NormalizedDocument 도 그대로 받는다

TARGET_CHARS = 900
MAX_CHARS = 1400
OVERLAP_CHARS = 100
MIN_LETTERS = 20

_SENTENCE_END = re.compile(r"(?<=[.!?。다요음임함됨])\s+")
_LETTER = re.compile(r"[A-Za-z가-힣]")


@dataclass(frozen=True)
class Chunk:
    index: int
    section: str            # "II. 사업의 내용 > 3. 원재료 및 생산설비"
    section_path: tuple[str, ...]
    text: str
    kind: str = "text"   # text | table (표 위주 chunk 는 검색에서 가중치를 낮춘다)
    page_number: int | None = None
    context: str = ""    # embedding 앞에 붙일 문맥 (PDF 는 문서 제목). 비어 있으면 section 을 쓴다

    @property
    def embed_text(self) -> str:
        """임베딩에 쓰는 문장: section(또는 문서 제목)을 앞에 붙여 짧은 chunk 도 맥락을 갖게 한다 (저장 text 는 원문 그대로)."""
        return f"[{self.context or self.section}] {self.text}"


def _split_long(text: str, max_chars: int, overlap: int) -> list[str]:
    """max 를 넘는 문단을 문장 경계에서 자른다. 이어지는 조각은 앞 조각의 끝 overlap 글자로 시작한다."""
    sentences = [s for s in _SENTENCE_END.split(text) if s]
    pieces: list[str] = []
    cur = ""
    for s in sentences:
        while len(s) > max_chars:  # 문장 하나가 너무 길면 글자 수로 자른다
            head, s = s[:max_chars], s[max_chars:]
            if cur:
                pieces.append(cur)
                cur = ""
            pieces.append(head)
        if cur and len(cur) + 1 + len(s) > max_chars:
            pieces.append(cur)
            cur = (pieces[-1][-overlap:] + " " + s) if overlap else s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        pieces.append(cur)
    return pieces


def _split_table(text: str, max_chars: int) -> list[str]:
    """표는 행 단위로 자른다. 첫 행이 짧으면 머리글로 보고 모든 조각에 붙인다. 한 행이 너무 길면 글자 수로 자른다."""
    if len(text) <= max_chars:
        return [text]
    rows: list[str] = []
    for r in text.split("\n"):
        rows.extend(r[i:i + max_chars] for i in range(0, max(len(r), 1), max_chars))
    header = rows[0] if len(rows[0]) <= 300 else ""
    body = rows[1:] if header else rows
    pieces: list[str] = []
    cur: list[str] = [header] if header else []
    size = len(header)
    for r in body:
        if cur and size + len(r) + 1 > max_chars and (len(cur) > 1 or not header):
            pieces.append("\n".join(cur))
            cur, size = ([header] if header else []), len(header)
        cur.append(r)
        size += len(r) + 1
    if cur and (len(cur) > 1 or not header or not pieces):
        pieces.append("\n".join(cur))
    return pieces


def chunk_document(doc: ParsedDocument, target: int = TARGET_CHARS, max_chars: int = MAX_CHARS, overlap: int = OVERLAP_CHARS) -> list[Chunk]:
    chunks: list[Chunk] = []

    def emit(path: list[str], text: str, kind: str, page: int | None = None) -> None:
        text = text.strip()
        if len(_LETTER.findall(text)) < MIN_LETTERS:
            return
        chunks.append(Chunk(index=len(chunks), section=" > ".join(path), section_path=tuple(path), text=text, kind=kind, page_number=page))

    for sec in doc.sections:
        buf: list[str] = []
        buf_kinds: list[str] = []
        size = 0

        def flush() -> None:
            nonlocal buf, buf_kinds, size
            if buf:
                # 문단이 절반 이상이면 text, 표가 절반을 넘으면 table
                emit(sec.path, "\n".join(buf), "table" if buf_kinds.count("table") * 2 > len(buf_kinds) else "text", sec.page_number)
            buf, buf_kinds, size = [], [], 0

        for block in sec.blocks:
            parts = (_split_long(block.text, max_chars, overlap) if block.kind == "p" else _split_table(block.text, max_chars)) if len(block.text) > max_chars else [block.text]
            for part in parts:
                if buf and size + len(part) + 1 > target:
                    flush()
                buf.append(part)
                buf_kinds.append(block.kind)
                size += len(part) + 1
        flush()
    return chunks
