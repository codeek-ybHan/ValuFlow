"""D&A(감가상각비 · 무형자산상각비) 사업보고서 주석 fallback.

배경: OpenDART 단일회사 전체 재무제표(fnlttSinglAcntAll)에는 현금흐름표 "조정" 합계만 있고 감가상각비 · 무형자산상각비 세부 계정이 없는 회사가 있다
(삼성전자 2025 사업보고서: 연결/별도 모두 감가상각 계열 계정 0건 — 원본에 없다). 그런 경우 사업보고서 재무제표 주석에 같은 금액이 공시된다.
탐색 순서(source): ① 현금흐름 주석 "조정내역" 표(cash-flow-adjustment) → ② 주석 "비용의 성격별 분류" 표(annual-report-note). 표는 제목 문구가 아니라
구조(`당기|전기 (단위)` 헤더 블록 + 다음 데이터 블록의 행 구성)로 알아본다 — 보고서마다 제목 블록이 빠지는 경우가 있다.

규칙
  - 실제 공시 값이 있을 때만 행을 만든다. 없으면 아무것도 만들지 않고 경고만 남긴다 (0 · 매출 비율 추정 · fixture 로 채우지 않는다).
  - 행에는 출처(sourceType=annual-report-note · 접수번호 · 보고서명 · 표 이름 · 단위)를 남긴다. normalization 은 기존 D&A 규칙(이름 일치)으로 합산한다.
  - 보고서 선택: 해당 사업연도의 사업보고서 중 접수일이 가장 늦은 것(기재정정 포함, 정정본이 원본을 대체한다). 반기 · 분기 보고서는 대상이 아니다.
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass
from typing import Any

from app.dart.documents import ParsedDocument, parse_document_xml
from app.dart.filings import Filing, FilingsSource
from app.dart.models import DartApiError, FinancialAccount

log = logging.getLogger("valuflow.da_notes")

SOURCE_TYPE = "annual-report-note"
SOURCE_CF = "cash-flow-adjustment"
NOTE_TITLE = "비용의 성격별 분류"
NOTE_LABEL = {SOURCE_CF: "현금흐름 조정내역", SOURCE_TYPE: NOTE_TITLE}
SOURCE_PRIORITY = [SOURCE_CF, SOURCE_TYPE]
UNIT_KRW = {"원": 1, "천원": 1_000, "백만원": 1_000_000, "억원": 100_000_000}
_HEADER = re.compile(r"^(당기|전기)\s*\|\s*\(\s*단위\s*:\s*([가-힣]+)\s*\)\s*$", re.M)
_NUM = re.compile(r"^\(?-?[\d,]+(\.\d+)?\)?$")

# 표의 행 이름(공백 제거) → 구성요소. 정규화 rules.json 의 D&A 이름 규칙(components)과 같은 이름으로 행을 만든다.
ROW_KIND = {
    "감가상각비": "depreciation", "유형자산감가상각비": "depreciation",
    "무형자산상각비": "amortization",
    "감가상각비및무형자산상각비": "combined", "감가상각및무형자산상각비": "combined",
}
ROW_NAME = {"depreciation": "감가상각비", "amortization": "무형자산상각비", "combined": "감가상각비 및 무형자산상각비"}
ROW_ID = {"depreciation": "note_DepreciationExpense", "amortization": "note_AmortizationExpense", "combined": "note_DepreciationAndAmortisationExpense"}


@dataclass(frozen=True)
class NoteDa:
    """한 기간(당기 | 전기)의 D&A. 금액은 원 단위 (OpenDART Raw 와 같다). 없는 구성요소는 키가 없다."""
    basis: str                    # Consolidated | Separate
    period: str                   # 당기 | 전기
    values: dict[str, int]        # depreciation | amortization | combined → 원
    unit: str
    section: str
    source_type: str              # cash-flow-adjustment | annual-report-note


def _to_int(cell: str) -> int | None:
    t = cell.strip().replace(" ", "")
    if not _NUM.match(t):
        return None
    neg = t.startswith("(") and t.endswith(")")
    n = int(float(t.strip("()").replace(",", "")))
    return -n if neg else n


def _row_values(table: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in table.split("\n"):
        cells = [c.strip() for c in line.split("|")]
        if len(cells) < 2:
            continue
        kind = ROW_KIND.get(re.sub(r"\s+", "", cells[0]))
        if kind is None or kind in out:
            continue
        v = _to_int(cells[-1])
        if v is not None:
            out[kind] = v
    return out


def _classify_table(text: str) -> str | None:
    """데이터 표의 종류: 현금흐름 조정내역(조정내역 계) / 비용의 성격별 분류(원재료 등의 사용액 · 성격별 비용 합계)."""
    if "조정내역 계" in text:
        return SOURCE_CF
    if "원재료 등의 사용액" in text or "성격별 비용" in text:
        return SOURCE_TYPE
    return None


def extract_da_notes(doc: ParsedDocument) -> list[NoteDa]:
    """주석 표에서 D&A 행을 읽는다. `당기|전기 | (단위 : …)` 헤더 블록 다음 블록이 데이터 표다. 연결/별도는 섹션 제목 · 설명문으로 가른다."""
    out: list[NoteDa] = []
    for sec in doc.sections:
        blocks = sec.blocks
        path = " > ".join(sec.path)
        for i, b in enumerate(blocks[:-1]):
            hdr = _HEADER.search(b.text)
            if hdr is None or hdr.group(2) not in UNIT_KRW:
                continue
            kind = _classify_table(blocks[i + 1].text)
            if kind is None:
                continue
            values = _row_values(blocks[i + 1].text)
            if not values:
                continue
            window = " ".join(x.text for x in blocks[i:i + 6])
            basis = "Consolidated" if "연결" in path or "연결손익계산서" in window or "연결포괄손익" in window else "Separate"
            mult = UNIT_KRW[hdr.group(2)]
            out.append(NoteDa(basis, hdr.group(1), {k: v * mult for k, v in values.items()}, hdr.group(2), path, kind))
    return out


def pick_annual_report(filings: list[Filing], corp_code: str, business_year: int) -> Filing | None:
    """해당 사업연도 사업보고서 중 접수일이 가장 늦은 것 (기재정정 포함: 정정본이 원본을 대체). 반기 · 분기 보고서는 고르지 않는다."""
    cands = [f for f in filings if f.corp_code == corp_code and f.report_type == "annual" and f.business_year == business_year]
    return max(cands, key=lambda f: (f.filing_date, f.receipt_no), default=None)


def has_da(accounts: list[FinancialAccount], year: int) -> bool:
    """이미 D&A(또는 구성요소)가 재무제표 계정에 있는 연도인가."""
    names = {re.sub(r"\s+", "", n) for n in ROW_KIND}
    return any(a.fiscal_year == year and a.statement_type == "CF" and a.amount is not None and re.sub(r"\s+", "", a.account_name) in names for a in accounts)


class AnnualReportNoteSource:
    """사업보고서 원문(document.xml ZIP)에서 D&A 를 읽는다. 문서 단위 결과는 서버 메모리에 cache 한다 (영구 저장은 Historical 저장이 맡는다)."""

    def __init__(self, source: FilingsSource):
        self._source = source
        self._lock = threading.Lock()
        self._cache: dict[tuple[str, int], tuple[Filing, list[NoteDa]] | None] = {}

    def _report(self, corp_code: str, year: int) -> tuple[Filing, list[NoteDa]] | None:
        key = (corp_code, year)
        with self._lock:
            if key in self._cache:
                return self._cache[key]
        # 사업연도 Y 의 사업보고서는 Y+1 에 접수된다 (조기 · 지연 제출을 감안해 여유를 둔다)
        filings = self._source.list_filings(corp_code, f"{year + 1}0101", f"{year + 2}0331")
        filing = pick_annual_report(filings, corp_code, year)
        result: tuple[Filing, list[NoteDa]] | None = None
        if filing is not None:
            result = (filing, extract_da_notes(parse_document_xml(self._source.fetch_document(filing.receipt_no))))
        with self._lock:
            self._cache[key] = result
        return result

    def enrich(self, corp_code: str, accounts: list[FinancialAccount], years: list[int], basis: str) -> tuple[list[FinancialAccount], list[str]]:
        """D&A 계정이 없는 연도만 주석에서 채운다. 반환: (추가한 행, 경고). 어떤 오류도 Historical 조회를 막지 않는다."""
        missing = sorted((y for y in set(years) if not has_da(accounts, y)), reverse=True)
        if not missing:
            return [], []
        rows: list[FinancialAccount] = []
        warnings: list[str] = []
        pending = list(missing)
        while pending:
            report_year = pending[0]            # 보고서 R 은 당기 R 와 전기 R-1 을 담는다
            try:
                got = self._report(corp_code, report_year)
            except (DartApiError, ValueError, OSError):
                log.warning("annual report note lookup failed (year=%s)", report_year)   # 본문 · Key 는 로그에 남기지 않는다
                got = None
                warnings.append(f"D&A annual-report note unavailable for {report_year} (OpenDART document could not be read)")
                pending = [y for y in pending if y != report_year]
                continue
            if got is None:
                warnings.append(f"D&A source unavailable for {report_year}: no annual report found in OpenDART filing list")
                pending = [y for y in pending if y != report_year]
                continue
            filing, notes = got
            covered = {report_year, report_year - 1}
            done: set[int] = set()
            for src in SOURCE_PRIORITY:                 # 현금흐름 조정내역 → 비용의 성격별 분류 순으로 처음 값이 있는 source 를 쓴다 (섞지 않는다)
                for n in (n for n in notes if n.basis == basis and n.source_type == src):
                    year = report_year if n.period == "당기" else report_year - 1
                    if year not in missing or year in done or not n.values:
                        continue
                    # 합계 행과 구성요소가 함께 있으면 구성요소를 우선한다 (정규화가 합산한다)
                    kinds = [k for k in ("depreciation", "amortization") if k in n.values] or [k for k in ("combined",) if k in n.values]
                    for k in kinds:
                        rows.append(FinancialAccount(
                            account_name=ROW_NAME[k], account_id=ROW_ID[k], statement_type="CF", raw_statement_type="NOTE", basis=basis, fiscal_year=year, report_year=report_year,
                            amount=n.values[k], currency="KRW",
                            raw={"sourceType": src, "note": NOTE_LABEL[src], "receiptNo": filing.receipt_no, "reportName": filing.report_name, "section": n.section, "unit": n.unit, "period": n.period}))
                    done.add(year)
            got_years = {r.fiscal_year for r in rows}
            for y in sorted(covered & set(missing)):
                if y not in got_years:
                    warnings.append(f"D&A source unavailable for {y}: annual report {filing.receipt_no} notes (cash-flow adjustments / '{NOTE_TITLE}') have no depreciation/amortization row ({basis})")
            pending = [y for y in pending if y not in covered]
        if rows:
            ys = sorted({r.fiscal_year for r in rows})
            warnings.append(f"D&A for {', '.join(str(y) for y in ys)} taken from annual report notes (cash-flow adjustments / '{NOTE_TITLE}'); not present in OpenDART financial statement accounts")
        return rows, list(dict.fromkeys(warnings))
