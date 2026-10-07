"""단일회사 전체 재무제표(fnlttSinglAcntAll) 수집 → DartRawAccount 형태의 행.

STEP 06-3 범위: 수집과 Raw 변환까지. canonical 계정 매핑은 프론트 normalization(STEP 06-1)이 맡는다.
  - 사업보고서(11011) 한 건에는 당기 / 전기 / 전전기가 함께 있어, 보고서 한 번으로 3개 연도의 행을 만든다.
  - 하나의 dataset 은 하나의 basis(연결 또는 별도)만 쓴다. 연결 일부 + 별도 일부를 섞지 않는다.
"""
from __future__ import annotations

import re
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from app.dart.models import DartApiError, FinancialAccount, FinancialsQuality

ANNUAL_REPORT = "11011"  # 사업보고서. 반기 11012 / 분기 11013 · 11014 로 확장할 수 있다.
FS_DIV: dict[str, str] = {"Consolidated": "CFS", "Separate": "OFS"}
BasisMode = Literal["auto", "consolidated", "separate"]

# OpenDART sj_div → 내부 구분. CIS(포괄손익계산서)는 IS 로 묶고 원본 값은 raw 에 보존한다. SCE(자본변동표)는 수집하지 않는다.
STATEMENT_MAP: dict[str, str] = {"BS": "BS", "IS": "IS", "CIS": "IS", "CF": "CF"}
# 한 보고서의 세 기간: 필드 접두사 → 사업연도 대비 오프셋
PERIODS: tuple[tuple[str, int], ...] = (("thstrm", 0), ("frmtrm", 1), ("bfefrmtrm", 2))
COVER_YEARS = 3

_BLANKS = {"", "-", "—", "–"}


def parse_amount(value: Any) -> tuple[int | float | None, bool]:
    """금액 문자열 → (값, 정상 여부). 빈 값은 0 이 아니라 (None, True), 해석 불가는 (None, False)."""
    if value is None:
        return None, True
    if isinstance(value, bool):
        return None, False
    if isinstance(value, (int, float)):
        return value, True
    text = str(value).strip()
    if text in _BLANKS:
        return None, True
    negative = text.startswith("(") and text.endswith(")")
    cleaned = text[1:-1] if negative else text
    cleaned = cleaned.replace(",", "").strip()
    if not re.fullmatch(r"[+-]?\d+(\.\d+)?", cleaned):
        return None, False
    number: int | float = float(cleaned) if "." in cleaned else int(cleaned)
    if isinstance(number, float) and number.is_integer():
        number = int(number)
    return (-number if negative else number), True


def plan_report_years(years: list[int]) -> list[int]:
    """요청 연도를 덮는 사업보고서 연도. 보고서 R 은 R, R-1, R-2 를 담으므로 최신 연도부터 greedy 하게 고른다."""
    remaining = sorted(set(years), reverse=True)
    plan: list[int] = []
    while remaining:
        report = remaining[0]
        plan.append(report)
        remaining = [y for y in remaining if y < report - (COVER_YEARS - 1)]
    return plan


def parse_financial_rows(rows: list[dict[str, Any]], basis: str, report_year: int) -> tuple[list[FinancialAccount], list[str]]:
    """OpenDART 응답 행 → 기간별(FinancialAccount). 같은 응답 안의 중복 행(같은 계정·연도)은 한 번만 만든다."""
    accounts: dict[tuple, FinancialAccount] = {}
    warnings: list[str] = []
    for row in rows:
        sj = str(row.get("sj_div") or "").strip().upper()
        statement = STATEMENT_MAP.get(sj)
        name = str(row.get("account_nm") or "").strip()
        if statement is None or not name:
            continue
        for prefix, offset in PERIODS:
            if f"{prefix}_amount" not in row:
                continue  # 이 보고서에 해당 기간 열이 없다
            amount, ok = parse_amount(row.get(f"{prefix}_amount"))
            year = report_year - offset
            if not ok:
                warnings.append(f"Unparseable amount for {name} ({sj}, {year}): {row.get(f'{prefix}_amount')!r}")
            detail = str(row.get("account_detail") or "").strip()
            key = (sj, row.get("account_id"), name, detail, year)
            if key in accounts:
                if accounts[key].amount != amount:
                    warnings.append(f"Duplicate account with different amount ignored: {name} ({sj}, {year})")
                continue
            accounts[key] = FinancialAccount(
                account_name=name, account_id=(str(row["account_id"]).strip() or None) if row.get("account_id") else None,
                statement_type=statement, raw_statement_type=sj, basis=basis, fiscal_year=year, report_year=report_year,
                amount=amount, currency=(row.get("currency") or None), raw=dict(row),
            )
    return list(accounts.values()), warnings


class FinancialsService:
    """보고서 수집 · 기준(연결/별도) 선택 · 서버 메모리 cache. cache 는 영구 저장이 아니다 (영구 저장은 STEP 06-6)."""

    def __init__(self, fetch_rows: Callable[[str, int, str, str], list[dict[str, Any]]], clock: Callable[[], datetime] | None = None):
        self._fetch_rows = fetch_rows
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()
        self._cache: dict[tuple[str, int, str, str], tuple[list[dict[str, Any]] | None, str]] = {}

    def _report(self, corp_code: str, year: int, report_code: str, fs_div: str, refresh: bool) -> tuple[list[dict[str, Any]] | None, bool]:
        """(rows | None=데이터 없음, cache 에서 가져왔는가). 오류는 cache 하지 않는다."""
        key = (corp_code, year, report_code, fs_div)
        with self._lock:
            if not refresh and key in self._cache:
                return self._cache[key][0], True
        try:
            rows: list[dict[str, Any]] | None = self._fetch_rows(corp_code, year, report_code, fs_div)
        except DartApiError as e:
            if e.code != "no-data":
                raise
            rows = None
        with self._lock:
            self._cache[key] = (rows, self._clock().isoformat())
        return rows, False

    def _collect_basis(self, corp_code: str, years: list[int], basis: str, report_code: str, refresh: bool):
        by_key: dict[tuple, FinancialAccount] = {}
        warnings: list[str] = []
        cached = True
        # 가장 오래된 보고서부터 넣고 최신 보고서가 덮어쓴다: 같은 연도가 두 보고서에 있으면 정정이 반영된 최신 보고서가 대표다.
        for report_year in sorted(plan_report_years(years)):
            rows, from_cache = self._report(corp_code, report_year, report_code, FS_DIV[basis], refresh)
            cached = cached and from_cache
            if rows is None:
                warnings.append(f"No {basis} report for business year {report_year}")
                continue
            parsed, w = parse_financial_rows(rows, basis, report_year)
            warnings.extend(w)
            for a in parsed:
                by_key[(a.raw_statement_type, a.account_id, a.account_name, str(a.raw.get("account_detail") or "").strip(), a.fiscal_year)] = a
        accounts = list(by_key.values())
        return accounts, warnings, cached

    @staticmethod
    def _years_received(accounts: list[FinancialAccount], years: list[int]) -> list[int]:
        return [y for y in sorted(set(years)) if any(a.fiscal_year == y and a.amount is not None for a in accounts)]

    @staticmethod
    def _complete(accounts: list[FinancialAccount], years: list[int]) -> bool:
        """요청한 모든 연도에 BS · IS · CF 가 모두 있는가."""
        return all(any(a.fiscal_year == y and a.statement_type == s and a.amount is not None for a in accounts)
                   for y in years for s in ("BS", "IS", "CF"))

    def collect(self, corp_code: str, years: list[int], mode: BasisMode = "auto", report_code: str = ANNUAL_REPORT, refresh: bool = False):
        """(accounts, quality, fetched_at, cached). auto: 연결을 먼저 시도하고 없거나 불완전하면 별도 전체로 전환한다(섞지 않는다)."""
        years = sorted(set(years))
        requested = {"auto": "Consolidated", "consolidated": "Consolidated", "separate": "Separate"}[mode]
        order = {"auto": ["Consolidated", "Separate"], "consolidated": ["Consolidated"], "separate": ["Separate"]}[mode]
        results: dict[str, tuple[list[FinancialAccount], list[str]]] = {}
        all_cached = True
        for basis in order:
            accounts, warnings, cached = self._collect_basis(corp_code, years, basis, report_code, refresh)
            all_cached = all_cached and cached
            results[basis] = (accounts, warnings)
            if self._complete(accounts, years):
                break

        # 사용할 기준: 완전한 것 > 데이터가 더 많은 것 (같으면 요청 기준). 어떤 경우에도 두 기준을 합치지 않는다.
        def score(b: str) -> tuple[int, int]:
            return (1 if self._complete(results[b][0], years) else 0, len(self._years_received(results[b][0], years)))
        used = max(results, key=lambda b: (score(b), b == requested)) if any(results[b][0] for b in results) else None
        accounts, warnings = (results[used] if used else ([], []))
        extra: list[str] = []
        if used is None:
            extra.append("No financial statement data returned by OpenDART")
        else:
            for b in results:
                if b != used and results[b][0]:
                    extra.append(f"{b} statements were also fetched but not used (datasets are never mixed)")
            if used != requested:
                extra.append(f"{used} statements used because {requested.lower()} data unavailable or incomplete")
            elif not self._complete(accounts, years):
                extra.append("Statements are incomplete for the requested years")
            if not self._complete(accounts, years):
                for y in years:
                    for s in ("BS", "IS", "CF"):
                        if not any(a.fiscal_year == y and a.statement_type == s and a.amount is not None for a in accounts):
                            extra.append(f"Missing {s} data for {y}")
        # 요청 기준에서 나온 경고 중 사용하지 않은 기준 것은 그 기준이 불완전했다는 정보라 함께 남긴다.
        for b in results:
            if b != used:
                extra.extend(results[b][1])
        received = self._years_received(accounts, years)
        quality = FinancialsQuality(
            basis_requested=requested, basis_used=used, basis_fallback=used is not None and used != requested,
            years_requested=years, years_received=received, missing_years=[y for y in years if y not in received],
            raw_account_count=len(accounts), warnings=[*warnings, *extra],
        )
        return accounts, quality, self._clock().isoformat(), all_cached and bool(results)
