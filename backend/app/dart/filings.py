"""공시 목록(list.json) 메타데이터와 문서 수집 source. 목록 수집과 본문 수집(documents.py)의 책임을 분리한다."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable, Protocol

from app.dart.documents import read_document_zip

# 사업보고서 > 반기보고서 > 분기보고서 순으로 우선한다. 이후 주요사항보고서 · 감사보고서 등을 같은 형식으로 추가할 수 있다.
REPORT_TYPES: dict[str, str] = {"사업보고서": "annual", "반기보고서": "half", "분기보고서": "quarterly"}
REPORT_PRIORITY = ["annual", "half", "quarterly"]

_NAME = re.compile(r"^\s*(?P<corr>\[[^\]]*정정[^\]]*\])?\s*(?P<base>[^\s(\[]+)\s*(?:\((?P<period>\d{4})[.\-]?(?P<month>\d{2})?\))?")


@dataclass(frozen=True)
class Filing:
    receipt_no: str
    corp_code: str
    corp_name: str
    report_name: str
    report_type: str   # annual | half | quarterly | other
    filing_date: date
    business_year: int | None
    is_correction: bool

    @property
    def url(self) -> str:
        return f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={self.receipt_no}"


def parse_report_name(report_nm: str) -> tuple[str, int | None, bool]:
    """'[기재정정]사업보고서 (2025.12)' → ('annual', 2025, True). 알 수 없는 보고서는 'other'."""
    m = _NAME.match(report_nm or "")
    if not m:
        return "other", None, False
    base = m.group("base")
    rtype = next((v for k, v in REPORT_TYPES.items() if base.startswith(k)), "other")
    year = int(m.group("period")) if m.group("period") else None
    return rtype, year, bool(m.group("corr"))


def parse_filing_rows(rows: Iterable[dict[str, Any]]) -> list[Filing]:
    out: list[Filing] = []
    for r in rows:
        rcept, corp, name, dt = str(r.get("rcept_no") or ""), str(r.get("corp_code") or ""), str(r.get("report_nm") or ""), str(r.get("rcept_dt") or "")
        if not (rcept and corp and name) or len(dt) != 8 or not dt.isdigit():
            continue
        rtype, year, corr = parse_report_name(name)
        try:
            filed = datetime.strptime(dt, "%Y%m%d").date()
        except ValueError:
            continue
        out.append(Filing(rcept, corp, str(r.get("corp_name") or ""), name.strip(), rtype, filed, year, corr))
    return out


class FilingsSource(Protocol):
    def list_filings(self, corp_code: str, bgn_de: str, end_de: str) -> list[Filing]: ...
    def fetch_document(self, receipt_no: str) -> str: ...


class DartDisclosureSource:
    """OpenDART 기반 FilingsSource (backend 에서만 호출한다)."""

    def __init__(self, client: Any):
        self._client = client

    def list_filings(self, corp_code: str, bgn_de: str, end_de: str) -> list[Filing]:
        filings: list[Filing] = []
        page = 1
        while page <= 10:
            body = self._client.list_filings(corp_code, bgn_de, end_de, page=page)
            filings.extend(parse_filing_rows(body.get("list", [])))
            if page >= int(body.get("total_page") or 0):
                break
            page += 1
        return filings

    def fetch_document(self, receipt_no: str) -> str:
        return read_document_zip(self._client.fetch_document_zip(receipt_no))
