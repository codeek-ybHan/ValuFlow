"""사용자 PDF 업로드 → 검증 → 추출 → chunking → embedding → 저장. OpenDART ingestion 과 같은 chunking · embedding · 저장소를 쓴다 (Loader 만 다르다)."""
from __future__ import annotations

import dataclasses
import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy.exc import IntegrityError

from app.ai.errors import AiGatewayError
from app.knowledge.loaders.pdf_loader import MAX_UPLOAD_BYTES, PdfError, PdfMeta, file_hash, load_pdf_document, validate_upload
from app.rag.chunking import chunk_document
from app.rag.embeddings import EmbeddingProvider
from app.rag.store import DisclosureStore

log = logging.getLogger("valuflow.knowledge")
_CORP = re.compile(r"^\d{8}$")
_DOCTYPE = re.compile(r"^[\w가-힣\- ]{1,32}$")


def _clean(value: str | None, limit: int) -> str | None:
    v = re.sub(r"[\x00-\x1f]+", " ", value or "").strip()
    return v[:limit] if v else None


def parse_meta(title: str | None = None, corp_code: str | None = None, corp_name: str | None = None, document_type: str | None = None,
               business_year: str | int | None = None, source_name: str | None = None, notes: str | None = None) -> PdfMeta:
    corp = _clean(corp_code, 8)
    if corp and not _CORP.match(corp):
        raise PdfError("invalid-metadata", "corpCode 는 8자리 숫자여야 합니다.", 400)
    dtype = _clean(document_type, 32)
    if dtype and not _DOCTYPE.match(dtype):
        raise PdfError("invalid-metadata", "documentType 형식이 올바르지 않습니다.", 400)
    year = None
    if business_year not in (None, ""):
        try:
            year = int(business_year)
        except (TypeError, ValueError):
            raise PdfError("invalid-metadata", "businessYear 는 숫자여야 합니다.", 400) from None
        if not 1990 <= year <= 2100:
            raise PdfError("invalid-metadata", "businessYear 범위가 올바르지 않습니다.", 400)
    return PdfMeta(title=_clean(title, 200), corp_code=corp, corp_name=_clean(corp_name, 200), document_type=dtype.lower() if dtype else None, business_year=year,
                   source_name=_clean(source_name, 200), notes=_clean(notes, 2000))


class KnowledgeService:
    def __init__(self, embedder: EmbeddingProvider, store: DisclosureStore, max_bytes: int = MAX_UPLOAD_BYTES, corp_name_lookup: Callable[[str], str | None] | None = None,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc), max_documents: int | None = None):
        self._embedder, self._store, self._max, self._lookup, self._clock, self._max_docs = embedder, store, max_bytes, corp_name_lookup, clock, max_documents

    def upload_pdf(self, data: bytes, content_type: str | None, filename: str | None, meta: PdfMeta) -> dict[str, Any]:
        """반환 {"status": "ingested" | "already-exists", "document": {...}}. 실패는 PdfError(코드) 또는 AiGatewayError(embedding)."""
        validate_upload(data, content_type, self._max)
        digest = file_hash(data)
        existing = self._store.find_upload_by_hash(digest)
        if existing:  # 같은 파일은 다시 추출 · embedding 하지 않는다
            return {"status": "already-exists", "document": existing}
        if self._max_docs is not None and self._store.count_uploads() >= self._max_docs:
            raise PdfError("document-limit", "데모에 올릴 수 있는 문서 수 한도에 도달했습니다.", 409)
        if meta.corp_code and self._lookup:
            try:
                official = self._lookup(meta.corp_code)
            except Exception:  # noqa: BLE001  (기업 목록을 못 읽어도 업로드는 계속한다)
                official = None
            meta = dataclasses.replace(meta, corp_name=official or meta.corp_name)
        doc = load_pdf_document(data, meta, filename, self._clock())
        chunks = [dataclasses.replace(c, context=doc.title) for c in chunk_document(doc)]
        if not chunks:
            raise PdfError("text-unavailable", "검색에 쓸 수 있는 텍스트가 없습니다.", 422)
        vectors = self._embedder.embed([c.embed_text for c in chunks])
        try:
            saved = self._store.save_upload(doc, chunks, vectors, self._embedder.model)
        except IntegrityError:  # 같은 파일이 동시에 업로드된 경우: 먼저 저장된 문서를 돌려준다
            existing = self._store.find_upload_by_hash(digest)
            if existing:
                return {"status": "already-exists", "document": existing}
            raise
        log.info("uploaded pdf indexed: document=%s chunks=%d", saved["documentId"], len(chunks))  # 본문 · 파일 이름은 로그에 남기지 않는다
        return {"status": "ingested", "document": saved}

    def delete(self, document_id: int) -> bool:
        return self._store.delete_document(document_id)

    def reindex(self, document_id: int) -> dict[str, Any] | None:
        """저장된 chunk 를 현재 embedding model 로 다시 embedding 한다 (embedding model 을 바꾼 뒤 사용). 원본 PDF 는 저장하지 않으므로 chunking 은 다시 하지 않는다."""
        inputs = self._store.chunk_embed_inputs(document_id)
        if not inputs:
            return None
        vectors = self._embedder.embed([t for _, t in inputs])
        self._store.replace_embeddings(document_id, [i for i, _ in inputs], vectors, self._embedder.model)
        return self._store.get_knowledge(document_id)
