"""단순 in-memory TTL cache. 외부 API 를 질문마다 호출하지 않도록 provider 가 쓴다 (성공한 결과만 저장한다).
TTL 은 데이터 성격별로 다르다: 시세는 짧게, 재무 · 비교기업은 길게, 금리는 일 단위, 뉴스는 짧게. 프로세스가 여러 개이거나 재시작되면 cache 도 따로다 (DB cache 는 이후 단계)."""
from __future__ import annotations

import threading
import time
from typing import Callable, Generic, TypeVar

T = TypeVar("T")


class TTLCache(Generic[T]):
    def __init__(self, clock: Callable[[], float] = time.monotonic, max_items: int = 512):
        self._clock, self._max = clock, max_items
        self._data: dict[str, tuple[float, T]] = {}
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get_or_load(self, key: str, ttl: float, loader: Callable[[], T]) -> T:
        now = self._clock()
        with self._lock:
            hit = self._data.get(key)
            if hit and hit[0] > now:
                self.hits += 1
                return hit[1]
            self.misses += 1
        value = loader()  # 실패(예외)는 저장하지 않는다
        with self._lock:
            if len(self._data) >= self._max:
                for k in [k for k, (exp, _) in self._data.items() if exp <= now] or [next(iter(self._data))]:
                    self._data.pop(k, None)
            self._data[key] = (self._clock() + ttl, value)
        return value
