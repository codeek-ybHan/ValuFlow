"""Reranker: hybrid retrieval 이 모은 후보를 "이 chunk 가 질문에 얼마나 직접적인 근거인가" 기준으로 다시 정렬한다.

embedding similarity 는 질문과 chunk 를 따로 벡터로 만들어 비교한다. cross-encoder 는 (질문, chunk) 쌍을 함께 읽고 점수를 매기므로 더 정확하지만 느려서
후보 15개 정도에만 적용한다. LLM 에 후보 전체를 넣어 재정렬시키는 방식은 비용 · 일관성 때문에 쓰지 않는다.

구현
  - CrossEncoderReranker: 로컬 cross-encoder (fastembed ONNX, 기본 jina-reranker-v2-base-multilingual). 외부 API 호출 없음. 첫 호출 때 모델을 내려받는다.
  - CohereReranker: Cohere Rerank API (COHERE_API_KEY). serverless 처럼 로컬 모델을 둘 수 없는 환경용.
점수는 0~1 (높을수록 직접적인 근거)로 정규화한다.
"""
from __future__ import annotations

import logging
import math
import threading
from typing import Protocol

import httpx

from app.ai.errors import AiGatewayError, MESSAGES

log = logging.getLogger("valuflow.rerank")
MAX_RERANK_CHARS = 1800


class Reranker(Protocol):
    name: str

    def score(self, query: str, texts: list[str]) -> list[float]:
        """texts 와 같은 순서의 0~1 점수 (높을수록 질문에 직접적인 근거)."""
        ...


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(min(x, 50.0), -50.0)))


class CrossEncoderReranker:
    """로컬 cross-encoder. 모델은 처음 필요할 때 한 번만 불러온다 (서버 시작 · 테스트를 느리게 하지 않는다)."""

    def __init__(self, model: str = "jinaai/jina-reranker-v2-base-multilingual", cache_dir: str | None = None):
        self.name = model
        self._cache_dir = cache_dir
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._model is None:
                from fastembed.rerank.cross_encoder import TextCrossEncoder  # 선택 의존성 (requirements-rerank.txt)
                self._model = TextCrossEncoder(self.name, cache_dir=self._cache_dir)
            return self._model

    def score(self, query: str, texts: list[str]) -> list[float]:
        if not texts:
            return []
        raw = list(self._load().rerank(query, [t[:MAX_RERANK_CHARS] for t in texts]))
        if len(raw) != len(texts):
            raise ValueError("reranker returned a wrong number of scores")
        return [_sigmoid(float(x)) for x in raw]


class CohereReranker:
    def __init__(self, api_key: str, model: str = "rerank-v3.5", base_url: str = "https://api.cohere.com/v2", client: httpx.Client | None = None, timeout: float = 30.0):
        self._key = api_key
        self.name = model
        self._base = base_url.rstrip("/")
        self._http = client or httpx.Client(timeout=timeout)

    def score(self, query: str, texts: list[str]) -> list[float]:
        if not texts:
            return []
        try:
            res = self._http.post(f"{self._base}/rerank", json={"model": self.name, "query": query, "documents": [t[:MAX_RERANK_CHARS] for t in texts], "top_n": len(texts)},
                                  headers={"Authorization": f"Bearer {self._key}"})
        except httpx.HTTPError:
            raise AiGatewayError("provider-error", MESSAGES["provider-error"], 502) from None
        if res.status_code >= 400:
            raise AiGatewayError("provider-rate-limit" if res.status_code == 429 else "provider-error", MESSAGES["provider-rate-limit" if res.status_code == 429 else "provider-error"], res.status_code if res.status_code == 429 else 502)
        try:
            scores = [0.0] * len(texts)
            for r in res.json()["results"]:
                scores[int(r["index"])] = float(r["relevance_score"])
            return scores
        except (ValueError, KeyError, TypeError, IndexError):
            raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502) from None


def build_reranker(kind: str, model: str = "", cohere_key: str = "", cache_dir: str | None = None) -> Reranker | None:
    """설정 → Reranker. kind: none | cross-encoder | cohere | auto (fastembed 가 설치되어 있으면 cross-encoder, 아니면 none)."""
    kind = (kind or "none").lower()
    if kind == "auto":
        try:
            import fastembed  # noqa: F401
            kind = "cross-encoder"
        except ImportError:
            log.info("fastembed is not installed: reranking is disabled")
            return None
    if kind == "cross-encoder":
        return CrossEncoderReranker(model or "jinaai/jina-reranker-v2-base-multilingual", cache_dir)
    if kind == "cohere":
        return CohereReranker(cohere_key, model or "rerank-v3.5") if cohere_key else None
    return None
