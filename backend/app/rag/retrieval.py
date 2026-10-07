"""공시 chunk 검색: Vector 검색 + Keyword 검색을 조합한 hybrid retrieval (RRF).

- 항상 corp_code 로 먼저 걸러 낸다 (다른 기업 문서는 절대 검색되지 않는다). 회사 단위 chunk 수가 작아 ANN index 없이 정확 검색(exact)을 쓴다.
- 보고서 종류 · 사업연도 filter 를 지원한다. embedding model 이 다른 chunk 는 섞어서 비교하지 않는다.
- 이 단계의 Vector 검색은 의미 유사도, Keyword 검색은 질의어가 그대로 들어간 chunk 를 보완한다. 둘 중 하나만 쓰도록 mode 로 바꿀 수 있다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import case, func, literal, or_, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import DisclosureChunk, DisclosureDocument
from app.rag.embeddings import EmbeddingProvider

RRF_K = 60
MAX_KEYWORDS = 8
_TERM = re.compile(r"[0-9A-Za-z가-힣&]{2,}")
# 질의의 조사 · 어미가 붙은 단어에서 핵심어를 얻기 위한 최소한의 접미사 제거 (형태소 분석기는 쓰지 않는다)
_SUFFIX = re.compile(r"(에서는|에서|으로|에게|에는|와의|과의|이란|라는|에는|은|는|이|가|을|를|의|에|도|와|과|로)$")
STOP_PREFIXES = ("설명", "알려", "어떻", "어떤", "관련", "대해", "대한", "말했", "밝혔")
STOPWORDS = {"어떤", "어떻게", "무엇", "관련", "내용", "공시", "회사", "회사가", "해서", "있어", "대한", "대해", "설명", "알려줘", "무엇을", "하고", "있는지"}


# 공시 용어는 질문과 다르게 쓰이는 경우가 많다 (질문 '설비투자' ↔ 공시 '시설투자'). keyword 검색에서만 쓰는 작은 동의어 사전이다.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "설비투자": ("시설투자", "설비투자", "CAPEX", "유형자산 취득"),
    "시설투자": ("시설투자", "설비투자", "CAPEX"),
    "capex": ("시설투자", "설비투자", "CAPEX"),
    "재고": ("재고자산", "재고"),
    "환율": ("환율", "환위험", "외환"),
    "리스크": ("위험", "리스크"),
    "위험": ("위험", "리스크"),
    "연구개발": ("연구개발", "R&D"),
    "수요": ("수요",),
}
TABLE_WEIGHT = 0.5   # 표 위주 chunk 의 RRF 기여도 (같은 점수라면 서술형 문단을 우선한다)


@dataclass(frozen=True)
class Hit:
    chunk_id: int
    chunk_index: int
    text: str
    section: str
    score: float                 # cosine similarity (0~1 근처)
    matched_by: tuple[str, ...]  # ("vector", "keyword")
    kind: str
    receipt_no: str
    corp_code: str
    corp_name: str
    report_name: str
    report_type: str
    filing_date: str
    business_year: int | None
    url: str | None
    ingested_at: str


def keywords(query: str) -> list[str]:
    seen: list[str] = []
    for w in _TERM.findall(query):
        stem = _SUFFIX.sub("", w) if re.search(r"[가-힣]", w) and len(w) > 2 else w
        stem = stem if len(stem) >= 2 else w
        if stem not in STOPWORDS and w not in STOPWORDS and not w.startswith(STOP_PREFIXES) and stem not in seen:
            seen.append(stem)
    return seen[:MAX_KEYWORDS]


@dataclass
class DisclosureRetriever:
    session_factory: sessionmaker[Session]
    embedder: EmbeddingProvider
    min_score: float = 0.3
    mode: Literal["hybrid", "vector", "keyword"] = "hybrid"
    candidate_factor: int = 4

    def has_documents(self, corp_code: str) -> bool:
        with self.session_factory() as s:
            return s.execute(select(DisclosureDocument.id).where(DisclosureDocument.corp_code == corp_code, DisclosureDocument.embedding_model == self.embedder.model).limit(1)).first() is not None

    def available_documents(self, corp_code: str) -> list[tuple[str, int | None]]:
        """이 회사에서 검색 가능한 (보고서 종류, 사업연도) 목록. 필터에 걸려 결과가 없을 때 모델이 필터를 고칠 수 있게 알려 준다."""
        with self.session_factory() as s:
            rows = s.execute(select(DisclosureDocument.report_type, DisclosureDocument.business_year).where(
                DisclosureDocument.corp_code == corp_code, DisclosureDocument.embedding_model == self.embedder.model).distinct().order_by(DisclosureDocument.business_year.desc())).all()
        return [(r[0], r[1]) for r in rows]

    def search(self, corp_code: str, query: str, top_k: int = 5, report_types: list[str] | None = None, business_years: list[int] | None = None) -> list[Hit]:
        qvec = self.embedder.embed([query])[0]
        n = max(top_k * self.candidate_factor, 20)
        dist = DisclosureChunk.embedding.cosine_distance(qvec)

        def base():
            q = select(DisclosureChunk, DisclosureDocument, dist.label("dist")).join(DisclosureDocument, DisclosureDocument.id == DisclosureChunk.document_id).where(
                DisclosureDocument.corp_code == corp_code, DisclosureDocument.embedding_model == self.embedder.model)
            if report_types:
                q = q.where(DisclosureDocument.report_type.in_(report_types))
            if business_years:
                q = q.where(DisclosureDocument.business_year.in_(business_years))
            return q

        terms = keywords(query)
        with self.session_factory() as s:
            vector_rows = s.execute(base().order_by(dist).limit(n)).all() if self.mode in ("hybrid", "vector") else []
            keyword_rows = []
            if terms and self.mode in ("hybrid", "keyword"):
                kscore = sum((case((or_(*[DisclosureChunk.text.icontains(v, autoescape=True) for v in SYNONYMS.get(t.lower(), (t,))]), 1), else_=0) for t in terms), literal(0))
                keyword_rows = s.execute(base().add_columns(kscore.label("kscore")).where(kscore > 0).order_by(kscore.desc(), dist).limit(n)).all()

        fused: dict[int, dict] = {}
        for rank, (chunk, doc, d) in enumerate(vector_rows):
            e = fused.setdefault(chunk.id, {"chunk": chunk, "doc": doc, "sim": 1 - float(d), "rrf": 0.0, "by": set()})
            e["rrf"] += (TABLE_WEIGHT if chunk.kind == "table" else 1.0) / (RRF_K + rank + 1)
            e["by"].add("vector")
        # 질의어가 2개 이하이면 모두, 그 이상이면 절반 이상이 들어간 chunk 만 keyword 후보로 인정한다
        need = len(terms) if len(terms) <= 2 else -(-len(terms) // 2)
        for rank, (chunk, doc, d, ks) in enumerate(keyword_rows):
            if ks < need:
                continue
            e = fused.setdefault(chunk.id, {"chunk": chunk, "doc": doc, "sim": 1 - float(d), "rrf": 0.0, "by": set()})
            e["rrf"] += (TABLE_WEIGHT if chunk.kind == "table" else 1.0) / (RRF_K + rank + 1)
            e["by"].add("keyword")

        # 관련성: 의미 유사도가 기준 이상이거나, keyword 로 직접 매칭된 chunk 만 돌려준다 (관련 없는 질의에 억지로 top-K 를 채우지 않는다)
        kept = [e for e in fused.values() if e["sim"] >= self.min_score or "keyword" in e["by"]]
        kept.sort(key=lambda e: (-e["rrf"], -e["sim"]))
        return [
            Hit(chunk_id=e["chunk"].id, chunk_index=e["chunk"].chunk_index, text=e["chunk"].text, section=e["chunk"].section, score=round(e["sim"], 4),
                matched_by=tuple(sorted(e["by"])), kind=e["chunk"].kind, receipt_no=e["doc"].receipt_no, corp_code=e["doc"].corp_code, corp_name=e["doc"].corp_name, report_name=e["doc"].report_name,
                report_type=e["doc"].report_type, filing_date=e["doc"].filing_date.isoformat(), business_year=e["doc"].business_year, url=e["doc"].url,
                ingested_at=e["doc"].ingested_at.isoformat())
            for e in kept[:top_k]
        ]
