"""RAG 문서 저장소 (PostgreSQL + pgvector): OpenDART 공시와 사용자 PDF 가 같은 테이블 · 같은 vector space 를 쓴다. 한 문서의 저장은 한 transaction 이다: 문서 · chunk · embedding 중 하나라도 실패하면 아무것도 남지 않는다.

Idempotency: OpenDART 는 receipt_no(접수번호), 사용자 PDF 는 file_hash(SHA-256)가 문서 식별자다. 같은 식별자가 이미 저장되어 있으면 다시 ingestion 하지 않는다.
삭제는 문서 → chunk(embedding 포함)가 함께 사라진다 (FK ON DELETE CASCADE).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Sequence

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.dart.filings import Filing
from app.knowledge.document import NormalizedDocument, SOURCE_OPENDART, SOURCE_UPLOAD
from app.db.models import DisclosureChunk, DisclosureDocument
from app.rag.chunking import Chunk
from app.services.financial_store import FinancialStore


class DisclosureStore:
    def __init__(self, session_factory: sessionmaker[Session]):
        self._sf = session_factory

    def has_document(self, receipt_no: str, embedding_model: str) -> bool:
        with self._sf() as s:
            return s.execute(select(DisclosureDocument.id).where(DisclosureDocument.receipt_no == receipt_no, DisclosureDocument.embedding_model == embedding_model)).first() is not None

    def count_documents(self, corp_code: str, embedding_model: str) -> int:
        with self._sf() as s:
            return s.execute(select(func.count()).select_from(DisclosureDocument).where(DisclosureDocument.corp_code == corp_code, DisclosureDocument.embedding_model == embedding_model)).scalar_one()

    def list_documents(self, corp_code: str) -> list[dict]:
        with self._sf() as s:
            rows = s.execute(select(DisclosureDocument).where(DisclosureDocument.corp_code == corp_code, DisclosureDocument.source_type == SOURCE_OPENDART).order_by(DisclosureDocument.filing_date.desc())).scalars().all()
            return [{"receiptNo": d.receipt_no, "reportName": d.report_name, "reportType": d.report_type, "filingDate": d.filing_date.isoformat(), "businessYear": d.business_year,
                     "chunkCount": d.chunk_count, "embeddingModel": d.embedding_model} for d in rows]

    # ---- 통합 문서 관리 (OpenDART + 사용자 PDF) ----
    @staticmethod
    def _describe(d: DisclosureDocument) -> dict[str, Any]:
        return {"documentId": d.id, "sourceType": d.source_type, "title": d.title or d.report_name, "documentType": d.report_type, "corpCode": d.corp_code, "corpName": d.corp_name,
                "businessYear": d.business_year, "filingDate": d.filing_date.isoformat() if d.filing_date else None, "uploadedAt": d.uploaded_at.isoformat() if d.uploaded_at else None,
                "sourceName": d.source_name, "receiptNo": d.receipt_no, "originalFilename": d.original_filename, "notes": d.notes, "chunkCount": d.chunk_count,
                "sectionCount": d.section_count, "embeddingModel": d.embedding_model, "status": d.status}

    def list_knowledge(self, source_type: str | None = None, corp_code: str | None = None) -> list[dict[str, Any]]:
        with self._sf() as s:
            q = select(DisclosureDocument).order_by(DisclosureDocument.id.desc())
            if source_type:
                q = q.where(DisclosureDocument.source_type == source_type)
            if corp_code:
                q = q.where(DisclosureDocument.corp_code == corp_code)
            return [self._describe(d) for d in s.execute(q).scalars().all()]

    def get_knowledge(self, document_id: int) -> dict[str, Any] | None:
        with self._sf() as s:
            d = s.get(DisclosureDocument, document_id)
            return self._describe(d) if d else None

    def count_uploads(self) -> int:
        with self._sf() as s:
            return int(s.execute(select(func.count()).select_from(DisclosureDocument).where(DisclosureDocument.source_type == SOURCE_UPLOAD)).scalar_one())

    def find_upload_by_hash(self, file_hash: str) -> dict[str, Any] | None:
        with self._sf() as s:
            d = s.execute(select(DisclosureDocument).where(DisclosureDocument.file_hash == file_hash)).scalar_one_or_none()
            return self._describe(d) if d else None

    def save_upload(self, doc: NormalizedDocument, chunks: Sequence[Chunk], embeddings: Sequence[Sequence[float]], embedding_model: str, owner_token_hash: str | None = None) -> dict[str, Any]:
        """사용자 PDF 를 문서 + chunk(page 번호 포함) + embedding 으로 한 transaction 저장한다."""
        if len(chunks) != len(embeddings):
            raise ValueError("chunks / embeddings length mismatch")
        meta = doc.metadata
        with self._sf.begin() as s:
            row = DisclosureDocument(
                receipt_no=None, company_id=None, corp_code=doc.corp_code, corp_name=doc.corp_name, report_name=doc.title, report_type=doc.document_type or "other", is_correction=False,
                filing_date=None, business_year=doc.business_year, source=SOURCE_UPLOAD, source_type=SOURCE_UPLOAD, title=doc.title, source_name=doc.source_name, notes=meta.get("notes"),
                original_filename=meta.get("originalFilename"), file_hash=meta.get("fileHash"), uploaded_at=doc.uploaded_at or datetime.now(timezone.utc), status="ready", url=None,
                section_count=len(doc.sections), chunk_count=len(chunks), char_count=doc.char_count, embedding_model=embedding_model, owner_token_hash=owner_token_hash)
            s.add(row)
            s.flush()
            if chunks:
                s.execute(insert(DisclosureChunk), [
                    {"document_id": row.id, "chunk_index": c.index, "section": c.section, "section_path": list(c.section_path), "page_number": c.page_number, "kind": c.kind, "text": c.text,
                     "char_count": len(c.text), "embedding": list(e)} for c, e in zip(chunks, embeddings)])
            s.flush()
            s.refresh(row)
            return self._describe(row)

    def owner_hash(self, document_id: int) -> tuple[bool, str | None]:
        """(문서가 있는가, 삭제 토큰 해시). 해시는 외부로 내보내지 않고 권한 검사에만 쓴다."""
        with self._sf() as s:
            d = s.get(DisclosureDocument, document_id)
            return (d is not None, d.owner_token_hash if d is not None else None)

    def delete_document(self, document_id: int) -> bool:
        """문서와 그 chunk · embedding 을 함께 지운다. 있었으면 True."""
        with self._sf.begin() as s:
            return s.execute(delete(DisclosureDocument).where(DisclosureDocument.id == document_id)).rowcount > 0

    def chunk_embed_inputs(self, document_id: int) -> list[tuple[int, str]]:
        """(chunk id, embedding 에 넣을 문장). 재인덱싱에서 저장된 chunk 를 현재 embedding model 로 다시 embedding 하는 데 쓴다."""
        with self._sf() as s:
            d = s.get(DisclosureDocument, document_id)
            if d is None:
                return []
            rows = s.execute(select(DisclosureChunk.id, DisclosureChunk.section, DisclosureChunk.text).where(DisclosureChunk.document_id == document_id).order_by(DisclosureChunk.chunk_index)).all()
            label = d.title or d.report_name
            return [(r.id, f"[{r.section or label}] {r.text}" if d.source_type == SOURCE_OPENDART else f"[{label}] {r.text}") for r in rows]

    def replace_embeddings(self, document_id: int, chunk_ids: Sequence[int], embeddings: Sequence[Sequence[float]], embedding_model: str) -> None:
        if len(chunk_ids) != len(embeddings):
            raise ValueError("chunks / embeddings length mismatch")
        with self._sf.begin() as s:
            for cid, e in zip(chunk_ids, embeddings):
                s.execute(update(DisclosureChunk).where(DisclosureChunk.id == cid, DisclosureChunk.document_id == document_id).values(embedding=list(e)))
            s.execute(update(DisclosureDocument).where(DisclosureDocument.id == document_id).values(embedding_model=embedding_model))

    def save_document(self, filing: Filing, company_name: str, chunks: Sequence[Chunk], embeddings: Sequence[Sequence[float]], embedding_model: str, section_count: int, char_count: int) -> int:
        """문서와 chunk 를 한 transaction 으로 저장한다 (같은 접수번호가 있으면 교체)."""
        if len(chunks) != len(embeddings):
            raise ValueError("chunks / embeddings length mismatch")
        with self._sf.begin() as s:
            company = FinancialStore._upsert_company(s, corp_code=filing.corp_code, corp_name=company_name or filing.corp_name or filing.corp_code)
            s.execute(delete(DisclosureDocument).where(DisclosureDocument.receipt_no == filing.receipt_no))
            doc = DisclosureDocument(
                receipt_no=filing.receipt_no, company_id=company.id, corp_code=filing.corp_code, corp_name=filing.corp_name or company_name, report_name=filing.report_name, title=filing.report_name, source_type=SOURCE_OPENDART,
                report_type=filing.report_type, is_correction=filing.is_correction, filing_date=filing.filing_date, business_year=filing.business_year, url=filing.url,
                section_count=section_count, chunk_count=len(chunks), char_count=char_count, embedding_model=embedding_model)
            s.add(doc)
            s.flush()
            if chunks:
                s.execute(insert(DisclosureChunk), [
                    {"document_id": doc.id, "chunk_index": c.index, "section": c.section, "section_path": list(c.section_path), "kind": c.kind, "text": c.text, "char_count": len(c.text), "embedding": list(e)}
                    for c, e in zip(chunks, embeddings)])
            return doc.id
