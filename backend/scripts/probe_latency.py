"""STEP 08-8: 외부 provider 지연 측정 (실제 네트워크). 절대적인 성능 보장이 아니라 provider 간 · 호출 간 상대 비교용이다.
사용: PYTHONPATH=. .venv/bin/python -m scripts.probe_latency [반복 횟수=3]
"""
from __future__ import annotations

import statistics
import sys
import time

from app.config import load_settings
from app.external.registry import build_external


def timed(label: str, fn, n: int) -> None:
    ms: list[float] = []
    err = None
    for _ in range(n):
        t = time.perf_counter()
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            err = type(e).__name__
        ms.append((time.perf_counter() - t) * 1000)
    rest = ms[1:] or [0.0]
    print(f"{label:34s} 첫 호출(비캐시)={ms[0]:7.0f}ms  이후(캐시) 평균={statistics.mean(rest):5.0f}ms  n={n}" + (f"  (last error: {err})" if err else ""))


def main(argv: list[str]) -> int:
    n = int(argv[0]) if argv else 3
    ext = build_external(load_settings())
    if ext.market is not None:
        timed("market snapshot (Yahoo)", lambda: ext.market.snapshot_by_stock_code("005930"), n)
        snap = ext.market.snapshot_by_stock_code("005930")   # 위에서 캐시됨
        if ext.comparables is not None:
            timed("comparable candidates (Yahoo)", lambda: ext.comparables.candidates(snap, "korea", None, 5), n)
    if ext.rates is not None:
        timed("risk-free rate (FRED)", lambda: ext.rates.risk_free_rate("KR"), n)
    if ext.news is not None:
        timed("news search (Google News)", lambda: ext.news.search('"삼성전자"', 7, 5), n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
