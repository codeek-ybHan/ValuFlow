"""Embedding provider. backend 에서만 호출하며 API Key 는 Authorization 헤더로만 쓰고 오류 · 로그에 남기지 않는다."""
from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol

import httpx

from app.ai.errors import AiGatewayError, MESSAGES

EMBEDDING_DIM = 1536
BATCH_SIZE = 64
MAX_INPUT_CHARS = 6000


class EmbeddingProvider(Protocol):
    model: str
    dimensions: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class OpenAiEmbeddings:
    def __init__(self, api_key: str, model: str = "text-embedding-3-small", base_url: str = "https://api.openai.com/v1", client: httpx.Client | None = None, timeout: float = 60.0):
        self._key = api_key
        self.model = model
        self.dimensions = EMBEDDING_DIM
        self._base = base_url.rstrip("/")
        self._http = client or httpx.Client(timeout=timeout)

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), BATCH_SIZE):
            batch = [t[:MAX_INPUT_CHARS] or " " for t in texts[i:i + BATCH_SIZE]]
            try:
                res = self._http.post(f"{self._base}/embeddings", json={"model": self.model, "input": batch, "dimensions": self.dimensions}, headers={"Authorization": f"Bearer {self._key}"})
            except httpx.HTTPError:
                raise AiGatewayError("provider-error", MESSAGES["provider-error"], 502) from None
            if res.status_code == 429:
                raise AiGatewayError("provider-rate-limit", MESSAGES["provider-rate-limit"], 429)
            if res.status_code >= 400:
                raise AiGatewayError("provider-error", MESSAGES["provider-error"], 502)  # 원문(오류 본문)을 노출하지 않는다
            try:
                data = sorted(res.json()["data"], key=lambda d: d["index"])
                vectors = [list(map(float, d["embedding"])) for d in data]
            except (ValueError, KeyError, TypeError):
                raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502) from None
            if len(vectors) != len(batch) or any(len(v) != self.dimensions for v in vectors):
                raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502)
            out.extend(vectors)
        return out


_TOKEN = re.compile(r"[0-9A-Za-z가-힣]+")


class HashEmbeddings:
    """테스트 · 오프라인용 결정적 embedding: 단어 + 한글 2-gram 을 hash 해 L2 정규화한다 (의미 모델은 아니지만 어휘가 겹치면 가깝다)."""

    def __init__(self, dimensions: int = EMBEDDING_DIM, model: str = "hash-bow-1536"):
        self.model = model
        self.dimensions = dimensions

    def _tokens(self, text: str) -> list[str]:
        toks: list[str] = []
        for w in _TOKEN.findall(text.lower()):
            toks.append(w)
            if re.search(r"[가-힣]", w):
                toks.extend(w[i:i + 2] for i in range(len(w) - 1))
        return toks

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for text in texts:
            v = [0.0] * self.dimensions
            for t in self._tokens(text):
                h = int.from_bytes(hashlib.md5(t.encode()).digest()[:8], "big")
                v[h % self.dimensions] += 1.0 if (h >> 63) & 1 else -1.0
            norm = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / norm for x in v])
        return out
