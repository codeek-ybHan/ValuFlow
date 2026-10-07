"""실제 OpenDART 응답에서 STEP 06-1 normalizer 가 필요로 하는 계정의 후보 이름을 조사한다. (DART_API_KEY 필요, STEP 06-4 매핑 보정용)

  .venv/bin/python -m scripts.inspect_raw_accounts [corp_code] [year ...]   기본: 00126380(삼성전자) 2023 2024 2025
"""
from __future__ import annotations

import sys
from collections import OrderedDict

from app.config import load_settings
from app.dart.client import DartHttpClient
from app.dart.financials import FinancialsService

# (구분, 보고서 구분, 이름에 포함되면 후보인 키워드)
TARGETS: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = [
    ("Revenue", ("IS",), ("매출", "수익", "Revenue")),
    ("COGS", ("IS",), ("매출원가", "Cost of sales")),
    ("Operating Profit", ("IS",), ("영업이익", "영업손익", "영업손실", "Operating")),
    ("Net Income", ("IS",), ("당기순", "순이익", "순손익", "Profit")),
    ("Accounts Receivable", ("BS",), ("매출채권", "수취채권", "Receivable")),
    ("Inventory", ("BS",), ("재고자산", "Inventor")),
    ("Accounts Payable", ("BS",), ("매입채무", "Payable")),
    ("Cash", ("BS",), ("현금및현금성", "현금 및 현금성", "Cash")),
    ("Interest-bearing Debt", ("BS",), ("차입금", "사채", "유동성", "리스부채", "Borrowing", "Debenture")),
    ("CFO", ("CF",), ("영업활동",)),
    ("PPE Acquisition", ("CF",), ("유형자산",)),
    ("Intangible Acquisition", ("CF",), ("무형자산",)),
    ("D&A", ("CF", "IS"), ("감가상각", "상각", "Depreciation", "Amortization")),
]


def main(argv: list[str]) -> int:
    settings = load_settings()
    if not settings.has_api_key:
        print("DART_API_KEY 가 없습니다.")
        return 1
    corp_code = argv[0] if argv else "00126380"
    years = [int(y) for y in argv[1:]] or [2023, 2024, 2025]
    service = FinancialsService(DartHttpClient(settings).fetch_financials)
    accounts, quality, fetched_at, _ = service.collect(corp_code, years)
    print(f"# Raw 계정 조사 — corpCode {corp_code}, 요청 연도 {years}, 조회 {fetched_at}")
    print(f"basisUsed={quality.basis_used} fallback={quality.basis_fallback} yearsReceived={quality.years_received} missing={quality.missing_years} rawAccountCount={quality.raw_account_count}")
    for w in quality.warnings:
        print(f"warning: {w}")
    by_stmt: dict[str, int] = {}
    for a in accounts:
        by_stmt[a.raw_statement_type] = by_stmt.get(a.raw_statement_type, 0) + 1
    print("행 수(원본 구분):", by_stmt)
    print()
    for label, stmts, keywords in TARGETS:
        found: "OrderedDict[tuple, dict]" = OrderedDict()
        for a in accounts:
            if a.statement_type in stmts and any(k.lower() in a.account_name.lower() for k in keywords):
                k = (a.raw_statement_type, a.account_id, a.account_name)
                entry = found.setdefault(k, {"years": {}})
                entry["years"][a.fiscal_year] = a.amount
        print(f"## {label} candidates")
        for (stmt, acc_id, name), v in found.items():
            vals = ", ".join(f"{y}:{v['years'].get(y)}" for y in sorted(v["years"]))
            print(f"- [{stmt}] {name}  (id={acc_id})  {vals}")
        if not found:
            print("- (없음)")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
