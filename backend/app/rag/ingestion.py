"""공시 ingestion: 목록 → 본문 → 구조 파싱 → chunking → embedding → 저장.
재무 숫자 정규화(HistoricalData)와는 별개의 경로이며, 원문을 숫자 데이터와 섞지 않는다."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

from app.ai.errors import AiGatewayError
from app.dart.filings import Filing, FilingsSource, REPORT_PRIORITY
from app.dart.models import DartApiError
from app.knowledge.loaders.dart_loader import load_dart_document
from app.rag.chunking import chunk_document
from app.rag.embeddings import EmbeddingProvider
from app.rag.store import DisclosureStore

log = logging.getLogger("valuflow.rag")


@dataclass
class IngestReport:
    corp_code: str
    listed: list[str] = field(default_factory=list)
    ingested: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"corpCode": self.corp_code, "listed": self.listed, "ingested": self.ingested, "skipped": self.skipped, "failed": self.failed}


def select_filings(filings: list[Filing], corp_code: str, report_types: list[str], business_years: list[int] | None, include_corrections: bool = False) -> list[Filing]:
    """요청한 회사 · 보고서 종류 · 사업연도의 문서만 고른다 (다른 기업 문서는 절대 포함하지 않는다). 사업보고서 → 반기 → 분기 순."""
    rank = {t: i for i, t in enumerate(REPORT_PRIORITY)}
    picked = [f for f in filings if f.corp_code == corp_code and f.report_type in report_types and (business_years is None or f.business_year in business_years)
              and (include_corrections or not f.is_correction)]
    return sorted(picked, key=lambda f: (rank.get(f.report_type, 99), -(f.business_year or 0), f.filing_date), reverse=False)


class DisclosureIngestionService:
    def __init__(self, source: FilingsSource, embedder: EmbeddingProvider, store: DisclosureStore, today=date.today):
        self._source, self._embedder, self._store, self._today = source, embedder, store, today

    def ingest(self, corp_code: str, report_types: list[str] | None = None, business_years: list[int] | None = None, limit: int = 3, force: bool = False) -> IngestReport:
        types = report_types or ["annual"]
        report = IngestReport(corp_code)
        today = self._today()
        first = min(business_years) if business_years else today.year - 3
        last = max(business_years) + 1 if business_years else today.year
        filings = select_filings(self._source.list_filings(corp_code, f"{first}0101", f"{min(last, today.year)}1231"), corp_code, types, business_years)[:limit]
        report.listed = [f.receipt_no for f in filings]
        for f in filings:
            if not force and self._store.has_document(f.receipt_no, self._embedder.model):
                report.skipped.append(f.receipt_no)  # 같은 접수번호 · 같은 embedding model 이면 다시 ingestion 하지 않는다
                continue
            try:
                parsed = load_dart_document(f, self._source.fetch_document(f.receipt_no))   # DART Loader → NormalizedDocument
                chunks = chunk_document(parsed)
                if not chunks:
                    raise ValueError("no chunks produced")
                vectors = self._embedder.embed([c.embed_text for c in chunks])
                self._store.save_document(f, f.corp_name, chunks, vectors, self._embedder.model, len(parsed.sections), parsed.char_count)
                report.ingested.append(f.receipt_no)
            except (DartApiError, AiGatewayError, ValueError) as e:
                code = getattr(e, "code", "invalid-document")
                log.warning("ingestion failed for %s: %s", f.receipt_no, code)  # 본문 · Key 는 로그에 남기지 않는다
                report.failed.append({"receiptNo": f.receipt_no, "code": code})
        return report
