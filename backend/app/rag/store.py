"""공시 문서 저장소 (PostgreSQL + pgvector). 한 문서의 저장은 한 transaction 이다: 문서 · chunk · embedding 중 하나라도 실패하면 아무것도 남지 않는다.

Idempotency: receipt_no(접수번호)가 문서 버전이다. 같은 receipt_no 가 이미 같은 embedding model 로 저장되어 있으면 다시 ingestion 하지 않는다 (force 일 때만 교체).
"""
from __future__ import annotations

from typing import Sequence

from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session, sessionmaker

from app.dart.filings import Filing
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
            rows = s.execute(select(DisclosureDocument).where(DisclosureDocument.corp_code == corp_code).order_by(DisclosureDocument.filing_date.desc())).scalars().all()
            return [{"receiptNo": d.receipt_no, "reportName": d.report_name, "reportType": d.report_type, "filingDate": d.filing_date.isoformat(), "businessYear": d.business_year,
                     "chunkCount": d.chunk_count, "embeddingModel": d.embedding_model} for d in rows]

    def save_document(self, filing: Filing, company_name: str, chunks: Sequence[Chunk], embeddings: Sequence[Sequence[float]], embedding_model: str, section_count: int, char_count: int) -> int:
        """문서와 chunk 를 한 transaction 으로 저장한다 (같은 접수번호가 있으면 교체)."""
        if len(chunks) != len(embeddings):
            raise ValueError("chunks / embeddings length mismatch")
        with self._sf.begin() as s:
            company = FinancialStore._upsert_company(s, corp_code=filing.corp_code, corp_name=company_name or filing.corp_name or filing.corp_code)
            s.execute(delete(DisclosureDocument).where(DisclosureDocument.receipt_no == filing.receipt_no))
            doc = DisclosureDocument(
                receipt_no=filing.receipt_no, company_id=company.id, corp_code=filing.corp_code, corp_name=filing.corp_name or company_name, report_name=filing.report_name,
                report_type=filing.report_type, is_correction=filing.is_correction, filing_date=filing.filing_date, business_year=filing.business_year, url=filing.url,
                section_count=section_count, chunk_count=len(chunks), char_count=char_count, embedding_model=embedding_model)
            s.add(doc)
            s.flush()
            if chunks:
                s.execute(insert(DisclosureChunk), [
                    {"document_id": doc.id, "chunk_index": c.index, "section": c.section, "section_path": list(c.section_path), "kind": c.kind, "text": c.text, "char_count": len(c.text), "embedding": list(e)}
                    for c, e in zip(chunks, embeddings)])
            return doc.id
