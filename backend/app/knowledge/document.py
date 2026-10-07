"""OpenDART · 사용자 PDF 가 공유하는 문서 모델 (NormalizedDocument).

Loader 만 source 별로 다르고, 이 모델로 정규화된 뒤에는 chunking · embedding · 저장 · 검색 · rerank 가 모두 같은 경로를 쓴다.
위치 정보: OpenDART 는 section 경로, PDF 는 page 번호를 sections 에 보존한다 ("어느 문서의 어느 부분인가").
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.dart.documents import Block, Section

SOURCE_OPENDART = "opendart"
SOURCE_UPLOAD = "user-upload"
SOURCE_TYPES = (SOURCE_OPENDART, SOURCE_UPLOAD)


@dataclass
class NormalizedDocument:
    document_id: str                       # opendart: 접수번호 · user-upload: file hash 기반 id
    title: str
    source_type: str                       # opendart | user-upload
    sections: list[Section]                # Section.page_number(PDF) 또는 Section.path(OpenDART)
    corp_code: str | None = None
    corp_name: str | None = None
    document_type: str | None = None       # annual | half | quarterly | industry-report | ir | ...
    business_year: int | None = None
    filing_date: date | None = None
    uploaded_at: datetime | None = None
    source_name: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def char_count(self) -> int:
        return sum(len(b.text) for s in self.sections for b in s.blocks)

    @property
    def page_count(self) -> int | None:
        pages = [s.page_number for s in self.sections if s.page_number is not None]
        return max(pages) if pages else None


__all__ = ["Block", "Section", "NormalizedDocument", "SOURCE_OPENDART", "SOURCE_UPLOAD", "SOURCE_TYPES"]
