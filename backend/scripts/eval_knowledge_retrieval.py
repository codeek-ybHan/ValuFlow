"""통합 RAG Retrieval 평가: Vector only vs Hybrid vs Hybrid + Reranker (실제 OpenDART · OpenAI embedding · 로컬 cross-encoder).

대상
  1) OpenDART: 삼성전자 최신 사업보고서 (chunk 단위 정답 라벨)
  2) User PDF: 같은 보고서의 '사업의 내용' 발췌를 실제 PDF 로 만들어 업로드한 문서 (page 단위 인용 확인)
라벨: 질의마다 (weak, direct) 정규식으로 corpus 의 모든 chunk 에 등급을 매긴다 — 0: 무관, 1: 주제를 언급(weak), 2: 질문에 직접 답하는 서술(weak + direct).
      라벨은 검색 결과와 독립적으로(corpus 전체를 훑어) 만들어진다. 정규식 라벨은 사람이 읽고 검수한 것이 아니므로 절대 지표가 아니라 방식 간 상대 비교로 읽는다.
지표: Hit@1, Hit@5, MRR@10(등급≥1), nDCG@5(등급 0/1/2), P@5(등급≥1 비율)
  PYTHONPATH=. .venv/bin/python -m scripts.eval_knowledge_retrieval [--db DIR] [--out docs/STEP08-3_unified_rag_eval.md]
"""
from __future__ import annotations

import argparse
import dataclasses
import io
import math
import os
import re
import sys
import time
from dataclasses import dataclass

import pgserver
from alembic import command
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.config import load_settings
from app.dart.client import DartHttpClient
from app.dart.filings import DartDisclosureSource
from app.db.models import DisclosureChunk, DisclosureDocument
from app.db.session import normalize_database_url
from app.knowledge.service import KnowledgeService, parse_meta
from app.rag.embeddings import OpenAiEmbeddings
from app.rag.ingestion import DisclosureIngestionService
from app.rag.rerank import build_reranker
from app.rag.retrieval import DisclosureRetriever, Scope
from app.rag.store import DisclosureStore
from tests.conftest import alembic_config

SAMSUNG = "00126380"
PDF_TITLE = "삼성전자 사업의 내용 발췌 (PDF)"


@dataclass(frozen=True)
class Q:
    query: str
    weak: str
    direct: str


QUERIES = [
    Q("설비투자", r"시설투자|설비투자|CAPEX", r"(시설투자|설비투자).{0,60}(조원|억원|확대|증설|계획|집행)|(조원|억원|확대|계획).{0,40}(시설투자|설비투자)"),
    Q("HBM", r"HBM", r"HBM.{0,80}(수요|공급|판매|확대|양산|매출)"),
    Q("반도체 수요", r"(반도체|메모리|DRAM|NAND|서버).{0,80}수요|수요.{0,80}(반도체|메모리|DRAM|NAND|서버)", r"수요.{0,40}(증가|감소|둔화|회복|강세|확대|전망)|(증가|회복|강세|둔화).{0,40}수요"),
    Q("재고", r"재고자산|재고", r"재고자산.{0,40}(증가|감소|평가|충당|조정|회전)|재고.{0,30}(조정|증가|감소|수준)"),
    Q("환율 리스크", r"환율|환위험|외환", r"(환율|환위험).{0,60}(위험|변동|관리|영향)|(위험|영향).{0,40}환율"),
    Q("연구개발", r"연구개발", r"연구개발.{0,40}(투자|비용|활동|확대|조직|인력)|R&D"),
    Q("AI 수요", r"\bAI\b|인공지능", r"AI.{0,60}(수요|서버|인프라|투자)|(수요|서버|인프라).{0,40}AI"),
    Q("CAPEX", r"CAPEX|시설투자|설비투자|투자 규모|투자액", r"(시설투자|설비투자|CAPEX).{0,60}(조원|억원|규모|금액|확대|계획)|투자.{0,10}(규모|금액)"),
]
MODES = ["A. Vector only", "B. Hybrid", "C. Hybrid + Reranker"]


def grade(q: Q, text: str) -> int:
    if not re.search(q.weak, text):
        return 0
    return 2 if re.search(q.direct, text) else 1


def metrics(grades: list[int], corpus: list[int]) -> dict[str, float]:
    ideal = sorted(corpus, reverse=True)[:5]
    dcg = sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(grades[:5]))
    idcg = sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(ideal))
    first = next((i + 1 for i, g in enumerate(grades[:10]) if g >= 1), None)
    return {"hit1": float(bool(grades[:1]) and grades[0] >= 1), "hit5": float(any(g >= 1 for g in grades[:5])), "mrr": 1 / first if first else 0.0,
            "ndcg5": dcg / idcg if idcg else 0.0, "p5": (sum(1 for g in grades[:5] if g >= 1) / 5)}


def build_pdf(pages: list[str]) -> bytes:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfgen import canvas
    pdfmetrics.registerFont(UnicodeCIDFont("HYSMyeongJo-Medium"))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, invariant=1)
    for text in pages:
        c.setFont("HYSMyeongJo-Medium", 10)
        y, line = 800, ""
        lines: list[str] = []
        for word in text.split():
            while len(word) > 44:
                lines.append(word[:44])
                word = word[44:]
            if line and len(line) + 1 + len(word) > 44:
                lines.append(line)
                line = word
            else:
                line = f"{line} {word}".strip()
        lines.append(line)
        for ln in lines[:56]:
            c.drawString(40, y, ln)
            y -= 14
        c.showPage()
    c.save()
    return buf.getvalue()


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/tmp/valuflow-eval-pg")
    ap.add_argument("--out")
    args = ap.parse_args(argv)
    st = load_settings()
    if not (st.has_api_key and st.has_ai):
        print("DART_API_KEY 와 OPENAI_API_KEY 가 필요합니다.")
        return 1
    reranker = build_reranker("cross-encoder", st.reranker_model, "", st.reranker_cache_dir or None)
    server = pgserver.get_server(args.db, cleanup_mode="stop")
    url = normalize_database_url(server.get_uri())
    command.upgrade(alembic_config(url), "head")
    sf = sessionmaker(bind=create_engine(url), expire_on_commit=False)
    emb = OpenAiEmbeddings(st.openai_api_key, st.embedding_model, st.openai_base_url)
    store = DisclosureStore(sf)
    out: list[str] = []

    def emit(s: str = "") -> None:
        print(s)
        out.append(s)

    rep = DisclosureIngestionService(DartDisclosureSource(DartHttpClient(st)), emb, store).ingest(SAMSUNG, ["annual"], None, limit=1)
    # 실제 PDF: 같은 보고서의 '사업의 내용' chunk 를 page 로 묶어 PDF 로 만든 뒤 업로드한다 (원문 텍스트가 실제 PDF 로 들어온다)
    with sf() as s:
        rows = s.execute(select(DisclosureChunk.section, DisclosureChunk.text).join(DisclosureDocument, DisclosureDocument.id == DisclosureChunk.document_id)
                         .where(DisclosureDocument.corp_code == SAMSUNG, DisclosureDocument.source_type == "opendart", DisclosureChunk.section.like("II. 사업의 내용%")).order_by(DisclosureChunk.chunk_index)).all()
    pages, cur = [], ""
    for sec, text in rows:
        for part in (sec + ". " + text).split("\n"):
            if cur and len(cur) + len(part) > 1500:
                pages.append(cur)
                cur = ""
            cur += " " + part
    pages.append(cur)
    pdf = build_pdf(pages[:24])
    up = KnowledgeService(emb, store).upload_pdf(pdf, "application/pdf", "samsung-business.pdf", parse_meta(PDF_TITLE, None, None, "industry-report", 2025, "DART 사업보고서 발췌", None))
    emit(f"ingestion(OpenDART)={rep.to_dict()} | upload(PDF)={up['status']} doc#{up['document']['documentId']} chunks={up['document']['chunkCount']} pages={min(len(pages), 24)}")
    base = DisclosureRetriever(sf, emb, min_score=st.retrieval_min_score, rerank_candidates=15)
    retrievers = {MODES[0]: dataclasses.replace(base, mode="vector"), MODES[1]: base, MODES[2]: dataclasses.replace(base, reranker=reranker, rerank_table_weight=float(os.environ.get("EVAL_RERANK_TABLE_WEIGHT", base.rerank_table_weight)))}
    corpora = {"OpenDART 사업보고서": Scope(SAMSUNG, source_types=("opendart",)), "User PDF": Scope(None, include_unassigned=True, source_types=("user-upload",))}
    # 첫 호출에서 cross-encoder 모델을 불러온다 (측정에서 제외)
    retrievers[MODES[2]].retrieve("워밍업", corpora["User PDF"], 1)
    for cname, scope in corpora.items():
        with sf() as s:
            q = select(DisclosureChunk.text).join(DisclosureDocument, DisclosureDocument.id == DisclosureChunk.document_id)
            q = q.where(DisclosureDocument.source_type == scope.source_types[0], *([DisclosureDocument.corp_code == scope.corp_code] if scope.corp_code else [DisclosureDocument.corp_code.is_(None)]))
            texts = [t for (t,) in s.execute(q).all()]
        emit(f"\n## {cname} ({len(texts)} chunks)\n")
        agg = {m: {k: 0.0 for k in ("hit1", "hit5", "mrr", "ndcg5", "p5", "ms")} for m in MODES}
        used = 0
        detail: list[str] = []
        for qq in QUERIES:
            corpus = [grade(qq, t) for t in texts]
            if not any(corpus):
                detail.append(f"- `{qq.query}`: 이 corpus 에 정답 chunk 가 없어 제외")
                continue
            used += 1
            row = []
            for m in MODES:
                t0 = time.perf_counter()
                res = retrievers[m].retrieve(qq.query, scope, 10)
                ms = (time.perf_counter() - t0) * 1000
                grades = [grade(qq, h.text) for h in res.hits]
                mt = metrics(grades, corpus)
                for k, v in mt.items():
                    agg[m][k] += v
                agg[m]["ms"] += ms
                top = res.hits[0] if res.hits else None
                where = (f"p.{top.page_number}" if top and top.page_number else (top.section[:34] if top else "-"))
                ranks = [i + 1 for i, g in enumerate(grades) if g == 2][:3]
                row.append(f"{m[0]}: top1={'g' + str(grades[0]) if grades else '-'} ({where}) · 직접답변 rank {ranks or '-'}")
            detail.append(f"- `{qq.query}` (정답 chunk g1={sum(1 for g in corpus if g == 1)}, g2={sum(1 for g in corpus if g == 2)}) → " + " | ".join(row))
        emit("| 방식 | Hit@1 | Hit@5 | MRR@10 | nDCG@5 | P@5 | 평균 지연(ms) |\n|---|---|---|---|---|---|---|")
        for m in MODES:
            a = {k: v / used for k, v in agg[m].items()}
            emit(f"| {m} | {a['hit1']:.2f} | {a['hit5']:.2f} | {a['mrr']:.3f} | {a['ndcg5']:.3f} | {a['p5']:.2f} | {a['ms']:.0f} |")
        emit(f"\n(질의 {used}개. g2 = 질문에 직접 답하는 서술, rank 는 top10 안에서 g2 chunk 의 순위)\n")
        for d in detail:
            emit(d)
    if args.out:
        open(args.out, "w", encoding="utf-8").write("\n".join(out) + "\n")
    server.cleanup()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
