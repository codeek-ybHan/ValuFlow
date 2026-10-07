"""PDF Loader: 업로드된 PDF → page 단위 텍스트 → NormalizedDocument.

- backend 에서만 파싱한다 (frontend 는 PDF 내용을 읽지 않는다).
- page 번호를 반드시 보존한다 (출처 표기 "업로드 문서 p.18").
- 파일 이름은 신뢰하지 않는다: 저장 · 경로에 쓰지 않고, 표시용 metadata 로만 정리해서 남긴다. 파일 자체는 저장하지 않는다 (텍스트 chunk 만 저장).
- 스캔 PDF(OCR 필요)는 지원하지 않는다: 텍스트가 거의 없으면 text-unavailable 이다.
"""
from __future__ import annotations

import hashlib
import io
import logging
import re
from dataclasses import dataclass
from datetime import datetime

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from app.knowledge.document import Block, NormalizedDocument, Section, SOURCE_UPLOAD

log = logging.getLogger("valuflow.knowledge")

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PAGES = 400
MAX_TEXT_CHARS = 1_500_000
MIN_TOTAL_LETTERS = 40          # 문서 전체에서 글자가 이보다 적으면 텍스트 추출 불가(스캔 PDF 등)로 본다
ACCEPTED_CONTENT_TYPES = {"application/pdf", "application/x-pdf"}
_LETTER = re.compile(r"[A-Za-z가-힣]")
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_FILENAME_BAD = re.compile(r"[^\w가-힣.\- ()\[\]]+")


class PdfError(Exception):
    """업로드 거부 / 추출 실패. code 는 API 응답의 error code 이며 message 에 파일 내용 · 경로를 싣지 않는다."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


@dataclass(frozen=True)
class PdfMeta:
    title: str | None = None
    corp_code: str | None = None
    corp_name: str | None = None
    document_type: str | None = None
    business_year: int | None = None
    source_name: str | None = None
    notes: str | None = None


def safe_filename(name: str | None) -> str | None:
    """표시용 파일 이름: 경로 성분 · 제어문자 · 특수문자를 제거하고 길이를 제한한다 (저장 경로에는 쓰지 않는다)."""
    if not name:
        return None
    base = re.split(r"[\\/]", _CTRL.sub("", name))[-1]
    base = _FILENAME_BAD.sub("_", base).strip(" .")
    return base[:120] or None


def validate_upload(data: bytes, content_type: str | None, max_bytes: int = MAX_UPLOAD_BYTES) -> None:
    """PDF 인지 확인한다: 크기 · 빈 파일 · Content-Type · magic bytes(%PDF-). 실행 파일 등 다른 형식은 거부한다."""
    if not data:
        raise PdfError("empty-file", "빈 파일입니다.", 400)
    if len(data) > max_bytes:
        raise PdfError("file-too-large", f"파일은 {max_bytes // (1024 * 1024)}MB 이하여야 합니다.", 413)
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype not in ACCEPTED_CONTENT_TYPES:
        raise PdfError("unsupported-file-type", "PDF 파일(application/pdf)만 업로드할 수 있습니다.", 415)
    if not data[:1024].lstrip().startswith(b"%PDF-"):   # Content-Type 을 속인 다른 형식(실행 파일 등)
        raise PdfError("unsupported-file-type", "PDF 형식이 아닙니다.", 415)


def file_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _paragraphs(page_text: str) -> list[str]:
    """page 텍스트 → 문단. 빈 줄은 문단 경계, 문단 안의 줄바꿈은 공백으로 잇는다 (PDF 의 줄바꿈은 문단 경계가 아니다)."""
    text = _CTRL.sub("", page_text).replace("\r", "")
    out = []
    for para in re.split(r"\n\s*\n", text):
        joined = re.sub(r"\s+", " ", para).strip()
        if joined:
            out.append(joined)
    return out


def extract_pages(data: bytes) -> list[tuple[int, str]]:
    """(page_number, text) 목록. page 번호는 1부터이며 텍스트가 없는 page 도 번호를 유지한 채 건너뛴다."""
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            try:
                if not reader.decrypt(""):
                    raise PdfError("encrypted-pdf", "암호가 걸린 PDF 는 읽을 수 없습니다.", 422)
            except PdfError:
                raise
            except Exception:  # noqa: BLE001
                raise PdfError("encrypted-pdf", "암호가 걸린 PDF 는 읽을 수 없습니다.", 422) from None
        n = len(reader.pages)
        if n == 0:
            raise PdfError("invalid-pdf", "페이지가 없는 PDF 입니다.", 422)
        if n > MAX_PAGES:
            raise PdfError("too-many-pages", f"{MAX_PAGES} 페이지 이하의 PDF 만 지원합니다.", 413)
        pages: list[tuple[int, str]] = []
        for i, page in enumerate(reader.pages, start=1):
            try:
                pages.append((i, page.extract_text() or ""))
            except Exception:  # noqa: BLE001  (한 page 의 추출 실패가 문서 전체를 막지 않는다)
                log.warning("pdf page %d extraction failed", i)
                pages.append((i, ""))
        return pages
    except PdfError:
        raise
    except (PyPdfError, ValueError, OSError, KeyError, TypeError, AttributeError, RecursionError):
        raise PdfError("invalid-pdf", "손상되었거나 읽을 수 없는 PDF 입니다.", 422) from None


def load_pdf_document(data: bytes, meta: PdfMeta, original_filename: str | None = None, uploaded_at: datetime | None = None) -> NormalizedDocument:
    """검증을 마친 PDF bytes → NormalizedDocument (page 마다 Section 하나, 문단이 block)."""
    pages = extract_pages(data)
    sections = [Section(path=[], blocks=[Block("p", p) for p in _paragraphs(text)], page_number=n) for n, text in pages]
    sections = [s for s in sections if s.blocks]
    letters = sum(len(_LETTER.findall(b.text)) for s in sections for b in s.blocks)
    if letters < MIN_TOTAL_LETTERS:
        raise PdfError("text-unavailable", "텍스트를 추출할 수 없습니다 (스캔 PDF 는 아직 지원하지 않습니다).", 422)
    if sum(len(b.text) for s in sections for b in s.blocks) > MAX_TEXT_CHARS:
        raise PdfError("text-too-large", "추출된 텍스트가 너무 큽니다.", 413)
    digest = file_hash(data)
    fname = safe_filename(original_filename)
    title = (meta.title or "").strip() or (re.sub(r"\.pdf$", "", fname, flags=re.I) if fname else "") or "Untitled PDF"
    return NormalizedDocument(
        document_id=digest[:16], title=title[:200], source_type=SOURCE_UPLOAD, sections=sections, corp_code=meta.corp_code, corp_name=meta.corp_name,
        document_type=meta.document_type, business_year=meta.business_year, uploaded_at=uploaded_at, source_name=meta.source_name,
        metadata={"fileHash": digest, "originalFilename": fname, "pageCount": len(pages), "notes": meta.notes})
