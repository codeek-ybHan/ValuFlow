"""공시 Retrieval 품질 평가 (실제 OpenDART + 실제 embedding, DART_API_KEY / OPENAI_API_KEY 필요).

삼성전자 최신 사업보고서를 임시 PostgreSQL(pgserver)에 ingestion 하고, 대표 질의 7개가 관련 section 을 Top-K 안으로 가져오는지 확인한다.
  .venv/bin/python -m scripts.eval_disclosure_retrieval [topK]
"""
from __future__ import annotations

import re
import sys
import tempfile
import time
from datetime import date

import pgserver
from alembic import command
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import load_settings
from app.dart.client import DartHttpClient
from app.dart.filings import DartDisclosureSource
from app.db.session import normalize_database_url
from app.rag.embeddings import OpenAiEmbeddings
from app.rag.ingestion import DisclosureIngestionService
from app.rag.retrieval import DisclosureRetriever
from app.rag.store import DisclosureStore
from tests.conftest import alembic_config

SAMSUNG = "00126380"

# (질의, 관련 chunk 로 인정하는 조건: section + text 에 대한 정규식)
QUERIES: list[tuple[str, str]] = [
    ("설비투자", r"시설투자|설비투자"),
    ("반도체 수요", r"(반도체|메모리|DS부문).{0,80}수요|수요.{0,80}(반도체|메모리)"),
    ("재고", r"재고자산"),
    ("주요 위험", r"위험관리|위험요인|위험\b"),
    ("연구개발", r"연구개발"),
    ("메모리 사업", r"메모리.{0,60}(사업|시장|매출|제품)"),
    ("환율 리스크", r"환율.{0,60}(위험|리스크|변동)|환위험"),
]


def build(settings, top_k: int):
    server = pgserver.get_server(tempfile.mkdtemp(prefix="valuflow-rag-"), cleanup_mode="stop")
    url = normalize_database_url(server.get_uri())
    command.upgrade(alembic_config(url), "head")
    sf = sessionmaker(bind=create_engine(url), expire_on_commit=False)
    embedder = OpenAiEmbeddings(settings.openai_api_key, settings.embedding_model, settings.openai_base_url)
    store = DisclosureStore(sf)
    ingest = DisclosureIngestionService(DartDisclosureSource(DartHttpClient(settings)), embedder, store)
    return server, sf, embedder, store, ingest


def evaluate(retriever: DisclosureRetriever, top_k: int) -> list[tuple[str, bool, int | None, list]]:
    rows = []
    for q, pattern in QUERIES:
        hits = retriever.search(SAMSUNG, q, top_k=top_k)
        rank = next((i + 1 for i, h in enumerate(hits) if re.search(pattern, h.section + " " + h.text)), None)
        rows.append((q, rank is not None, rank, hits))
    return rows


def main(argv: list[str]) -> int:
    top_k = int(argv[0]) if argv else 5
    settings = load_settings()
    if not (settings.has_api_key and settings.has_ai):
        print("DART_API_KEY 와 OPENAI_API_KEY 가 필요합니다.")
        return 1
    server, sf, embedder, store, ingest = build(settings, top_k)
    try:
        t = time.time()
        report = ingest.ingest(SAMSUNG, ["annual"], None, limit=1)
        docs = store.list_documents(SAMSUNG)
        print(f"ingestion: {report.to_dict()} ({time.time() - t:.0f}s) docs={[(d['reportName'], d['chunkCount']) for d in docs]}")
        for mode in ("vector", "hybrid"):
            retriever = DisclosureRetriever(sf, embedder, min_score=settings.retrieval_min_score, mode=mode)  # type: ignore[arg-type]
            rows = evaluate(retriever, top_k)
            ok = sum(1 for r in rows if r[1])
            print(f"\n== mode={mode} top{top_k}: {ok}/{len(rows)} ==")
            for q, hit, rank, hits in rows:
                print(f"  [{'OK ' if hit else 'MISS'}] {q:10s} first relevant rank={rank} | top1: {hits[0].section[:48] if hits else '-'} (score {hits[0].score if hits else '-'})")
        # 관련 없는 질의는 억지로 결과를 채우지 않는다
        for q in ("바나나 아이스크림 레시피", "우주 정거장 건설 일정", "How to bake sourdough bread"):
            wide = DisclosureRetriever(sf, embedder, min_score=0.0, mode="vector").search(SAMSUNG, q, top_k=3)
            kept = DisclosureRetriever(sf, embedder, min_score=settings.retrieval_min_score).search(SAMSUNG, q, top_k=top_k)
            print(f"\nunrelated '{q}': best vector scores {[h.score for h in wide]} → kept with min_score={settings.retrieval_min_score}: {len(kept)}")
        for q, _ in QUERIES:
            low = DisclosureRetriever(sf, embedder, min_score=0.0, mode="vector").search(SAMSUNG, q, top_k=5)
            print(f"  relevant-query '{q}' vector scores {[h.score for h in low]}")
    finally:
        server.cleanup()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
