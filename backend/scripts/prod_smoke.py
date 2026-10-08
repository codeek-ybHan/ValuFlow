"""배포된(또는 production 모드로 띄운) backend 의 smoke 점검. 공개 URL 에서 방문자 기능(access key 없이) · 관리자 보호 · PDF 를 확인한다.

   python -m scripts.prod_smoke <baseUrl> [--token ADMIN_ACCESS_TOKEN] [--origin https://frontend.example]

점검: health(secret 비노출) · 방문자는 key 없이 Report PDF · ADMIN_ONLY(저장/조회)는 key 없이 거부 · (--token) 관리자 저장 왕복 · API 문서가 닫혀 있는가 · CORS · 내부 오류 비노출.
"""
from __future__ import annotations

import argparse
import re
import sys

import httpx

MODEL = {"version": "1.0", "meta": {"title": "Smoke", "company": "삼성전자", "createdAt": "2026-10-08T00:00:00Z", "schemaVersion": "1.0", "templateId": "t", "templateVersion": "1", "filename": "ValuFlow_smoke.pdf", "footer": "smoke"},
         "blocks": [{"type": "cover", "title": "삼성전자 Valuation Report", "subtitle": None, "company": "삼성전자", "ticker": "005930", "createdAt": "2026-10-08", "valuationDate": "2026-10-08", "currency": "KRW", "monetaryUnit": "억원", "perShareUnit": "원", "version": "1.0"}]}
FORBIDDEN = ("Traceback", "psycopg", "sqlalchemy", "/srv/", "/Users/", "password=")
KEY_LIKE = re.compile(r"\bsk-[A-Za-z0-9_-]{20,}|postgres(ql)?://\S+:\S+@|api_key\s*[=:]\s*[\"']?[A-Za-z0-9]{8,}", re.I)   # 'risk-free' 같은 일반 단어는 key 가 아니다


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--token", default="")
    ap.add_argument("--origin", default="")
    a = ap.parse_args()
    http = httpx.Client(base_url=a.base.rstrip("/"), timeout=60)
    auth = {"X-ValuFlow-Access": a.token} if a.token else {}
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, ok, detail))
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}{' — ' + detail if detail and not ok else ''}")

    h = http.get("/api/health")
    body = h.json() if h.headers.get("content-type", "").startswith("application/json") else {}
    check("health 200 · status ok", h.status_code == 200 and body.get("status") in ("ok", "degraded"), h.text[:120])
    print(f"      env={body.get('appEnv')} version={body.get('version')} db={body.get('database')} ai={body.get('aiConfigured')} dart={body.get('dartConfigured')} rag={body.get('ragAvailable')} publicDemo={body.get('publicDemo')} admin={body.get('adminProtection')} rateLimit={body.get('rateLimit')} font={body.get('reportService', {}).get('font')}")
    check("health 에 credential 값 없음", not KEY_LIKE.search(h.text))
    check("API 문서 닫힘 (production)", body.get("appEnv") != "production" or http.get("/docs").status_code == 404)
    check("health: publicDemo", body.get("publicDemo") is True and "accessProtection" not in body)
    r = http.post("/api/report/pdf", json=MODEL)
    check("Report PDF 는 key 없이 가능 (공개 + rate limit)", r.status_code == 200 and r.content.startswith(b"%PDF"), f"status {r.status_code}")
    print(f"      pages={r.headers.get('x-report-pages')} font={r.headers.get('x-report-font')}")
    r = http.get("/api/analyses")
    check("ADMIN_ONLY(저장/조회)는 key 없이 거부 (401/403)", r.status_code in (401, 403), f"status {r.status_code}")
    check("거부 응답에 내부 정보 없음", not any(f in r.text for f in FORBIDDEN) and not KEY_LIKE.search(r.text))
    if a.token:
        bad = http.post("/api/report/pdf", json={"version": "9"}, headers=auth)
        check("잘못된 payload 는 정제된 오류", bad.status_code in (400, 422) and not any(f in bad.text for f in FORBIDDEN), bad.text[:100])
        listing = http.get("/api/analyses", headers=auth)
        check("저장소 조회 (200 또는 503 persistence-unavailable)", listing.status_code in (200, 503), f"status {listing.status_code}")
        if listing.status_code == 200:
            sample = {"analysisId": "smoke-1", "question": "smoke", "workflowType": "smoke", "contextSnapshotId": "ctx-smoke", "createdAt": "2026-10-08T00:00:00Z", "groundingLevel": "claim-evidence", "claims": [], "evidence": [], "sources": [], "limitations": []}
            s = http.post("/api/analyses", json=sample, headers=auth)
            g = http.get("/api/analyses/smoke-1", headers=auth)
            check("분석 저장 → 조회 왕복", s.status_code == 200 and g.status_code == 200 and g.json()["analysis"]["contextSnapshotId"] == "ctx-smoke", f"{s.status_code}/{g.status_code}")
    if a.origin:
        pre = http.options("/api/health", headers={"Origin": a.origin, "Access-Control-Request-Method": "GET"})
        check("CORS: 허용 origin", pre.headers.get("access-control-allow-origin") == a.origin)
        evil = http.options("/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
        check("CORS: 다른 origin 거부", "access-control-allow-origin" not in evil.headers)
    c = http.get("/api/companies/not-a-code")
    check("잘못된 요청은 정제된 오류", c.status_code in (400, 404, 422) and not any(f in c.text for f in FORBIDDEN))
    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} PASS" + (f" · FAIL: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
