"""공유 Retrieval Pipeline (OpenDART 공시 + 사용자 PDF 공통): Vector + Keyword(BM25) → 후보 병합 → RRF → Reranker.

- 모든 검색은 Scope(기업 · source · 문서 종류 · 사업연도 · 문서)로 먼저 걸러 낸다. 다른 기업에 연결된 문서는 절대 검색되지 않고,
  기업과 무관한 문서(corp_code NULL, 산업 리포트 등)는 include_unassigned 일 때만 함께 검색된다. 정확 검색(exact)이라 ANN index 를 쓰지 않는다.
- embedding model 이 다른 chunk 는 섞어서 비교하지 않는다.
- Keyword 검색은 질의어(+공시 동의어)가 chunk 에 그대로 들어간 것을 BM25 로 점수화한다 (한국어 조사 때문에 형태소가 아닌 부분 문자열 일치).
- 1단계(hybrid)가 후보를 rerank_candidates 개까지 만들고, Reranker 가 있으면 (질문, chunk) 쌍으로 다시 점수를 매겨 top_k 를 고른다.
"""
from __future__ import annotations

import logging
import sys
import math
import re
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import and_, case, func, literal, or_, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import DisclosureChunk, DisclosureDocument
from app.knowledge.document import SOURCE_OPENDART
from app.rag.embeddings import EmbeddingProvider
from app.rag.rerank import Reranker

log = logging.getLogger("valuflow.retrieval")
BM25_K1, BM25_B = 1.2, 0.75
MAX_KEYWORD_CANDIDATES = 400

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
class Scope:
    """검색 범위. corp_code · include_unassigned 로 기업 격리를 정한다 (any_corp 가 아니면 기업 조건이 항상 걸린다)."""
    corp_code: str | None = None
    include_unassigned: bool = False        # 기업과 무관한 문서(corp_code NULL)도 포함
    any_corp: bool = False                  # 기업 조건 없음 (평가 · 관리용; AI Tool 에서는 쓰지 않는다)
    source_types: tuple[str, ...] | None = None
    document_types: tuple[str, ...] | None = None
    business_years: tuple[int, ...] | None = None
    document_ids: tuple[int, ...] | None = None


@dataclass(frozen=True)
class Hit:
    chunk_id: int
    chunk_index: int
    text: str
    section: str
    score: float                 # retrievalScore: cosine similarity (0~1 근처)
    matched_by: tuple[str, ...]  # ("vector", "keyword")
    kind: str
    receipt_no: str | None
    corp_code: str | None
    corp_name: str | None
    report_name: str
    report_type: str             # 문서 종류 (documentType)
    filing_date: str | None
    business_year: int | None
    url: str | None
    ingested_at: str
    document_id: int = 0
    source_type: str = SOURCE_OPENDART
    title: str = ""
    page_number: int | None = None
    source_name: str | None = None
    uploaded_at: str | None = None
    rrf_score: float = 0.0
    retrieval_rank: int = 0      # rerank 전 순위 (1부터)
    rerank_score: float | None = None
    final_rank: int = 0


@dataclass(frozen=True)
class RetrievalStats:
    mode: str
    candidates: int            # rerank 에 넘긴(또는 넘길 수 있었던) 후보 수
    reranked: int              # 실제로 rerank 된 수 (0 이면 rerank 안 함)
    reranker: str | None
    rerank_failed: bool = False


@dataclass(frozen=True)
class RetrievalResult:
    hits: list[Hit]
    stats: RetrievalStats


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
    """Shared retrieval pipeline. (이름은 STEP 08-3 의 공시 검색에서 왔지만 OpenDART · 사용자 PDF 를 모두 검색한다.)"""
    session_factory: sessionmaker[Session]
    embedder: EmbeddingProvider
    min_score: float = 0.3
    mode: Literal["hybrid", "vector", "keyword"] = "hybrid"
    candidate_factor: int = 4
    reranker: Reranker | None = None
    rerank_candidates: int = 15
    rerank_min_score: float | None = None
    rerank_table_weight: float = 0.75   # rerank 정렬 점수에 곱하는 표 chunk prior (1.0 이면 모델 점수 그대로)

    # ---- 범위 helper ----
    def _filters(self, scope: Scope) -> list:
        f = [DisclosureDocument.embedding_model == self.embedder.model, DisclosureDocument.status == "ready"]
        if not scope.any_corp:
            own = DisclosureDocument.corp_code == scope.corp_code if scope.corp_code else None
            if own is not None and scope.include_unassigned:
                f.append(or_(own, DisclosureDocument.corp_code.is_(None)))
            elif own is not None:
                f.append(own)
            elif scope.include_unassigned:
                f.append(DisclosureDocument.corp_code.is_(None))
            else:
                f.append(literal(False))  # 기업도 없고 미지정 문서도 허용하지 않으면 아무것도 검색하지 않는다
        if scope.source_types:
            f.append(DisclosureDocument.source_type.in_(scope.source_types))
        if scope.document_types:
            f.append(DisclosureDocument.report_type.in_(scope.document_types))
        if scope.business_years:
            f.append(DisclosureDocument.business_year.in_(scope.business_years))
        if scope.document_ids:
            f.append(DisclosureDocument.id.in_(scope.document_ids))
        return f

    def scope_has_documents(self, scope: Scope) -> bool:
        with self.session_factory() as s:
            return s.execute(select(DisclosureDocument.id).where(*self._filters(Scope(scope.corp_code, scope.include_unassigned, scope.any_corp, scope.source_types))).limit(1)).first() is not None

    def scope_available(self, scope: Scope) -> list[dict]:
        """범위(기업 · source)에 검색 가능한 문서 요약. 필터에 걸려 결과가 없을 때 모델이 필터를 고칠 수 있게 알려 준다."""
        base = Scope(scope.corp_code, scope.include_unassigned, scope.any_corp, scope.source_types)
        with self.session_factory() as s:
            rows = s.execute(select(DisclosureDocument.source_type, DisclosureDocument.report_type, DisclosureDocument.business_year, DisclosureDocument.title, DisclosureDocument.report_name)
                             .where(*self._filters(base)).order_by(DisclosureDocument.business_year.desc().nulls_last(), DisclosureDocument.id.desc()).limit(30)).all()
        return [{"sourceType": r[0], "documentType": r[1], "businessYear": r[2], "title": r[3] or r[4]} for r in rows]

    def has_documents(self, corp_code: str) -> bool:
        return self.scope_has_documents(Scope(corp_code, source_types=(SOURCE_OPENDART,)))

    def available_documents(self, corp_code: str) -> list[tuple[str, int | None]]:
        """이 회사에서 검색 가능한 OpenDART (보고서 종류, 사업연도) 목록."""
        with self.session_factory() as s:
            rows = s.execute(select(DisclosureDocument.report_type, DisclosureDocument.business_year).where(*self._filters(Scope(corp_code, source_types=(SOURCE_OPENDART,)))).distinct()
                             .order_by(DisclosureDocument.business_year.desc())).all()
        return [(r[0], r[1]) for r in rows]

    # ---- 1단계 후보 ----
    @staticmethod
    def _bm25(rows, terms: list[str], df: dict[str, int], n_docs: int, avgdl: float, need: int) -> list[tuple[float, tuple]]:
        scored = []
        for row in rows:
            chunk = row[0]
            text = chunk.text.lower()
            dl = max(len(text), 1)
            score, matched = 0.0, 0
            for t in terms:
                variants = [v.lower() for v in SYNONYMS.get(t.lower(), (t,))]
                tf = sum(text.count(v) for v in variants)
                if tf == 0:
                    continue
                matched += 1
                idf = math.log(1 + (n_docs - df[t] + 0.5) / (df[t] + 0.5))
                score += idf * tf * (BM25_K1 + 1) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * dl / max(avgdl, 1)))
            if matched >= need:
                scored.append((score, row))
        scored.sort(key=lambda x: -x[0])
        return scored

    def _candidates(self, query: str, scope: Scope, n: int) -> list[dict]:
        """Vector + Keyword(BM25) 후보를 RRF 로 합친 목록 (rrf 내림차순). 관련성 기준에 못 미치는 후보는 이미 제외된다."""
        qvec = self.embedder.embed([query])[0]  # cosine similarity 는 모든 후보에 필요해 keyword 모드에서도 질의를 embedding 한다
        dist = DisclosureChunk.embedding.cosine_distance(qvec)
        filters = self._filters(scope)

        def base(*extra):
            return select(DisclosureChunk, DisclosureDocument, dist.label("dist"), *extra).join(DisclosureDocument, DisclosureDocument.id == DisclosureChunk.document_id).where(*filters)

        terms = keywords(query)
        with self.session_factory() as s:
            vector_rows = s.execute(base().order_by(dist).limit(n)).all() if self.mode in ("hybrid", "vector") else []
            keyword_ranked: list[tuple[float, tuple]] = []
            if terms and self.mode in ("hybrid", "keyword"):
                conds = {t: or_(*[DisclosureChunk.text.icontains(v, autoescape=True) for v in SYNONYMS.get(t.lower(), (t,))]) for t in terms}
                stats = s.execute(select(func.count(), func.avg(DisclosureChunk.char_count), *[func.sum(case((c, 1), else_=0)) for c in conds.values()])
                                  .select_from(DisclosureChunk).join(DisclosureDocument, DisclosureDocument.id == DisclosureChunk.document_id).where(*filters)).one()
                n_docs, avgdl = int(stats[0] or 0), float(stats[1] or 1)
                df = {t: int(stats[2 + i] or 0) for i, t in enumerate(conds)}
                kscore = sum((case((c, 1), else_=0) for c in conds.values()), literal(0))
                rows = s.execute(base().where(kscore > 0).order_by(kscore.desc(), dist).limit(MAX_KEYWORD_CANDIDATES)).all()
                # 질의어가 2개 이하이면 모두, 그 이상이면 절반 이상이 들어간 chunk 만 keyword 후보로 인정한다
                need = len(terms) if len(terms) <= 2 else -(-len(terms) // 2)
                keyword_ranked = self._bm25(rows, terms, df, n_docs, avgdl, need)[:n]

        fused: dict[int, dict] = {}

        def add(row, rank: int, by: str) -> None:
            chunk, doc, d = row[0], row[1], row[2]
            e = fused.setdefault(chunk.id, {"chunk": chunk, "doc": doc, "sim": 1 - float(d), "rrf": 0.0, "by": set()})
            e["rrf"] += (TABLE_WEIGHT if chunk.kind == "table" else 1.0) / (RRF_K + rank + 1)
            e["by"].add(by)

        for rank, row in enumerate(vector_rows):
            add(row, rank, "vector")
        for rank, (_, row) in enumerate(keyword_ranked):
            add(row, rank, "keyword")
        # 관련성: 의미 유사도가 기준 이상이거나, keyword 로 직접 매칭된 chunk 만 후보가 된다 (관련 없는 질의에 억지로 top-K 를 채우지 않는다)
        kept = [e for e in fused.values() if e["sim"] >= self.min_score or "keyword" in e["by"]]
        kept.sort(key=lambda e: (-e["rrf"], -e["sim"]))
        return kept

    @staticmethod
    def _hit(e: dict, retrieval_rank: int, final_rank: int, rerank_score: float | None) -> Hit:
        c, d = e["chunk"], e["doc"]
        return Hit(chunk_id=c.id, chunk_index=c.chunk_index, text=c.text, section=c.section, score=round(e["sim"], 4), matched_by=tuple(sorted(e["by"])), kind=c.kind,
                   receipt_no=d.receipt_no, corp_code=d.corp_code, corp_name=d.corp_name, report_name=d.report_name, report_type=d.report_type,
                   filing_date=d.filing_date.isoformat() if d.filing_date else None, business_year=d.business_year, url=d.url, ingested_at=d.ingested_at.isoformat(),
                   document_id=d.id, source_type=d.source_type, title=d.title or d.report_name, page_number=c.page_number, source_name=d.source_name,
                   uploaded_at=d.uploaded_at.isoformat() if d.uploaded_at else None, rrf_score=round(e["rrf"], 6), retrieval_rank=retrieval_rank,
                   rerank_score=None if rerank_score is None else round(rerank_score, 4), final_rank=final_rank)

    def retrieve(self, query: str, scope: Scope, top_k: int = 5, rerank: bool = True) -> RetrievalResult:
        """Vector + Keyword → RRF → (Reranker) → 최종 top_k. rerank=False 이거나 Reranker 가 없으면 hybrid 순서 그대로다."""
        use_rerank = rerank and self.reranker is not None
        n = max(top_k * self.candidate_factor, self.rerank_candidates, 20)
        kept = self._candidates(query, scope, n)
        pool = kept[: max(self.rerank_candidates, top_k)] if use_rerank else kept[:top_k]
        mode = self.mode
        if not use_rerank or not pool:
            return RetrievalResult([self._hit(e, i + 1, i + 1, None) for i, e in enumerate(pool)], RetrievalStats(mode, len(pool), 0, None))
        try:
            scores = self.reranker.score(query, [f"{e['doc'].title or e['doc'].report_name} {e['chunk'].section}\n{e['chunk'].text}".strip() for e in pool])  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001  (reranker 장애로 검색 전체가 실패하지 않는다: hybrid 순서로 돌려준다)
            log.error("reranker failed (%s); falling back to hybrid order", type(sys.exc_info()[1]).__name__)   # 예외 본문 · traceback 은 남기지 않는다 (credential 이 섞일 수 있다)
            return RetrievalResult([self._hit(e, i + 1, i + 1, None) for i, e in enumerate(pool[:top_k])], RetrievalStats(mode, len(pool), 0, self.reranker.name, True))  # type: ignore[union-attr]
        # 표 위주 chunk 는 서술형 문단보다 질문에 직접 답하는 경우가 드물다: 1단계와 같은 prior(TABLE_WEIGHT)를 정렬 점수에만 반영한다 (rerankScore 는 모델 점수 그대로)
        adjusted = [scores[i] * (self.rerank_table_weight if pool[i]["chunk"].kind == "table" else 1.0) for i in range(len(pool))]
        order = sorted(range(len(pool)), key=lambda i: (-adjusted[i], i))
        if self.rerank_min_score is not None:
            order = [i for i in order if scores[i] >= self.rerank_min_score]
        hits = [self._hit(pool[i], i + 1, rank + 1, scores[i]) for rank, i in enumerate(order[:top_k])]
        return RetrievalResult(hits, RetrievalStats(mode, len(pool), len(pool), self.reranker.name))  # type: ignore[union-attr]

    def search(self, corp_code: str, query: str, top_k: int = 5, report_types: list[str] | None = None, business_years: list[int] | None = None) -> list[Hit]:
        """OpenDART 공시 검색 (기존 인터페이스): 한 기업의 공시만, hybrid(+reranker 가 설정되어 있으면 rerank)."""
        scope = Scope(corp_code, source_types=(SOURCE_OPENDART,), document_types=tuple(report_types) if report_types else None, business_years=tuple(business_years) if business_years else None)
        return self.retrieve(query, scope, top_k).hits
