"""PostgreSQL 저장소 계층. 쓰기는 모두 한 transaction 안에서 이뤄지며, 하나라도 실패하면 아무것도 남지 않는다.

정책 (idempotency)
  - 수집(fetch) 한 번은 `financial_fetches` 에 새 row 로 남는다 (이력 보존, 기존 Raw 를 지우지 않는다).
  - 같은 (회사, 보고서, 기준 요청 방식, 연도 조합) 의 최신 결과만 `is_current` 이며, 새 결과가 저장될 때 이전 current 는 같은 transaction 에서 해제된다.
  - Raw row 의 중복은 fetch 단위로 격리되고(unique index), 같은 fetch 안에서는 (연도, 구분, 기준, 계정 id, 계정명, 세부) 가 유일하다.
  - 정규화 값 / 품질은 fetch 에 매달린다. 규칙이 바뀌면 Raw 에서 다시 정규화(renormalize)해 교체할 수 있다.
저장하지 않는 것: HistoricalAnalysis / ForecastReference / ValuationResult / SensitivityResult.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, sessionmaker

from app.dart.models import FinancialAccount, FinancialsQuality
from app.db.models import (
    NORMALIZED_VALUE_COLUMNS, Company, DataQualityRecord, FinancialFetch, NormalizedFinancial, RawFinancialAccount, UnsupportedResult,
)

# normalize 결과(camelCase) ↔ 컬럼(snake_case)
FIELD_TO_COLUMN = {
    "revenue": "revenue", "cogs": "cogs", "grossProfit": "gross_profit", "sga": "sga", "operatingProfit": "operating_profit", "netIncome": "net_income",
    "accountsReceivable": "accounts_receivable", "inventory": "inventory", "accountsPayable": "accounts_payable",
    "totalAssets": "total_assets", "totalLiabilities": "total_liabilities", "totalEquity": "total_equity",
    "cash": "cash", "interestBearingDebt": "interest_bearing_debt", "leaseLiabilities": "lease_liabilities",
    "cfo": "cfo", "ppeAcquisition": "ppe_acquisition", "intangibleAcquisition": "intangible_acquisition", "depreciationAmortization": "depreciation_amortization",
}
SECTION_OF = {
    **{f: "incomeStatement" for f in ("revenue", "cogs", "grossProfit", "sga", "operatingProfit", "netIncome")},
    **{f: "balanceSheet" for f in ("accountsReceivable", "inventory", "accountsPayable", "totalAssets", "totalLiabilities", "totalEquity", "cash", "interestBearingDebt", "leaseLiabilities")},
    **{f: "cashFlow" for f in ("cfo", "ppeAcquisition", "intangibleAcquisition", "depreciationAmortization")},
}
REQUIRED = ("revenue", "cogs", "grossProfit", "sga", "operatingProfit", "netIncome", "accountsReceivable", "inventory", "accountsPayable", "totalAssets", "totalLiabilities", "totalEquity", "cfo", "ppeAcquisition", "intangibleAcquisition")
BALANCE_ORDER = ("accountsReceivable", "inventory", "accountsPayable", "cash", "interestBearingDebt", "leaseLiabilities", "totalAssets", "totalLiabilities", "totalEquity")
SOURCE_LABEL = {"OpenDART": "DART Annual Report"}


@dataclass(frozen=True)
class FetchKey:
    corp_code: str
    report_code: str
    basis_mode: str
    years: tuple[int, ...]

    @property
    def years_key(self) -> str:
        return ",".join(str(y) for y in sorted(set(self.years)))


def utc_iso(dt: datetime) -> str:
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()


def _num(v: Any) -> float | int | None:
    if v is None:
        return None
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return v


class FinancialStore:
    def __init__(self, session_factory: sessionmaker[Session]):
        self._sf = session_factory

    @property
    def session_factory(self) -> sessionmaker[Session]:
        return self._sf

    # ---- 기업 ----
    @staticmethod
    def _upsert_company(session: Session, *, corp_code: str, corp_name: str, stock_code: str | None = None, corp_name_eng: str | None = None,
                        corp_class: str | None = None, source: str = "OpenDART") -> Company:
        stmt = pg_insert(Company).values(corp_code=corp_code, corp_name=corp_name, stock_code=stock_code, corp_name_eng=corp_name_eng, corp_class=corp_class, source=source)
        ex = stmt.excluded
        stmt = stmt.on_conflict_do_update(
            index_elements=[Company.corp_code],
            set_={"corp_name": ex.corp_name, "stock_code": func.coalesce(ex.stock_code, Company.stock_code), "corp_name_eng": func.coalesce(ex.corp_name_eng, Company.corp_name_eng),
                  "corp_class": func.coalesce(ex.corp_class, Company.corp_class), "source": ex.source, "updated_at": func.now()},
        ).returning(Company)
        return session.execute(stmt).scalar_one()

    def upsert_company(self, **kw: Any) -> dict:
        with self._sf.begin() as s:
            c = self._upsert_company(s, **kw)
            return self._company_dict(c)

    @staticmethod
    def _company_dict(c: Company) -> dict:
        return {"id": c.id, "corpCode": c.corp_code, "stockCode": c.stock_code, "corpName": c.corp_name, "corpNameEng": c.corp_name_eng, "corpClass": c.corp_class, "source": c.source}

    def get_company(self, corp_code: str) -> dict | None:
        with self._sf() as s:
            c = s.execute(select(Company).where(Company.corp_code == corp_code)).scalar_one_or_none()
            return self._company_dict(c) if c else None

    # ---- 조회 ----
    def find_current(self, key: FetchKey) -> dict | None:
        """key 의 current fetch 를 결과 형태(normalize 결과 + 수집 메타)로 복원한다. 없으면 None."""
        with self._sf() as s:
            row = s.execute(
                select(FinancialFetch, Company).join(Company, Company.id == FinancialFetch.company_id).where(
                    Company.corp_code == key.corp_code, FinancialFetch.report_code == key.report_code, FinancialFetch.basis_mode == key.basis_mode,
                    FinancialFetch.years_key == key.years_key, FinancialFetch.is_current.is_(True))
            ).first()
            if not row:
                return None
            return self._load(s, row[0], row[1])

    def get_fetch(self, fetch_id: int) -> dict | None:
        with self._sf() as s:
            f = s.get(FinancialFetch, fetch_id)
            if not f:
                return None
            return self._load(s, f, s.get(Company, f.company_id))

    def list_fetches(self, corp_code: str, limit: int = 50) -> list[dict]:
        with self._sf() as s:
            rows = s.execute(
                select(FinancialFetch).join(Company, Company.id == FinancialFetch.company_id).where(Company.corp_code == corp_code)
                .order_by(FinancialFetch.fetched_at.desc(), FinancialFetch.id.desc()).limit(limit)).scalars().all()
            return [{"id": f.id, "status": f.status, "isCurrent": f.is_current, "basisMode": f.basis_mode, "basisUsed": f.basis_used, "years": f.requested_years,
                     "rawAccountCount": f.raw_account_count, "fetchedAt": utc_iso(f.fetched_at), "source": f.source} for f in rows]

    def load_raw(self, fetch_id: int) -> list[FinancialAccount]:
        with self._sf() as s:
            return self._load_raw(s, fetch_id)

    @staticmethod
    def _load_raw(s: Session, fetch_id: int) -> list[FinancialAccount]:
        rows = s.execute(select(RawFinancialAccount).where(RawFinancialAccount.fetch_id == fetch_id).order_by(RawFinancialAccount.id)).scalars().all()
        return [FinancialAccount(account_name=r.account_name, account_id=r.account_id, statement_type=r.statement_type, raw_statement_type=r.raw_statement_type, basis=r.basis,
                                 fiscal_year=r.fiscal_year, report_year=r.report_year, amount=_num(r.amount), currency=r.currency, raw=r.raw) for r in rows]

    def _load(self, s: Session, f: FinancialFetch, c: Company) -> dict:
        q = s.execute(select(DataQualityRecord).where(DataQualityRecord.fetch_id == f.id)).scalar_one()
        quality = {"basisRequested": q.basis_requested, "basisUsed": q.basis_used, "basisFallback": q.basis_fallback,
                   "fields": q.fields, "warnings": q.warnings, "trace": q.trace, "checks": q.checks}
        fetch = {"basisRequested": f.basis_requested, "basisUsed": f.basis_used, "basisFallback": f.basis_fallback, "yearsRequested": f.requested_years,
                 "yearsReceived": f.received_years, "missingYears": f.missing_years, "rawAccountCount": f.raw_account_count, "warnings": f.warnings}
        info = {"fetchId": f.id, "fetchedAt": utc_iso(f.fetched_at), "status": f.status, "isCurrent": f.is_current, "company": self._company_dict(c), "fetch": fetch}
        if f.status == "success":
            rows = s.execute(select(NormalizedFinancial).where(NormalizedFinancial.fetch_id == f.id).order_by(NormalizedFinancial.fiscal_year)).scalars().all()
            return {**info, "result": {"ok": True, "data": self._to_historical(f, c, rows), "quality": quality}}
        u = s.execute(select(UnsupportedResult).where(UnsupportedResult.fetch_id == f.id)).scalar_one_or_none()
        return {**info, "result": {"ok": False, "code": f.status, "reason": u.reason if u else f.status, "missingRequired": (u.detail or {}).get("missingRequired", []) if u else [], "quality": quality}}

    @staticmethod
    def _to_historical(f: FinancialFetch, c: Company, rows: list[NormalizedFinancial]) -> dict:
        meta: dict[str, Any] = {"source": SOURCE_LABEL.get(f.source, f.source), "corpCode": c.corp_code}
        if c.stock_code:
            meta["stockCode"] = c.stock_code
        meta["fetchedAt"] = utc_iso(f.fetched_at)
        sections: dict[str, dict[str, list]] = {"incomeStatement": {}, "balanceSheet": {}, "cashFlow": {}}
        for field in FIELD_TO_COLUMN:
            col = FIELD_TO_COLUMN[field]
            series = [getattr(r, col) for r in rows]
            # 필수 계정은 항상 값이 있다. 선택 계정은 모든 연도에 값이 있을 때만 포함한다 (일부만 있으면 정규화 단계에서 제외된 것이다).
            if field in REQUIRED or all(v is not None for v in series):
                sections[SECTION_OF[field]][field] = series
        bs = {k: sections["balanceSheet"][k] for k in BALANCE_ORDER if k in sections["balanceSheet"]}
        return {"meta": meta,
                "company": {"name": c.corp_name, "ticker": c.stock_code or "", "basis": f.basis_used, "currency": "KRW", "unit": "million", "period": [f"{r.fiscal_year}A" for r in rows]},
                "incomeStatement": sections["incomeStatement"], "balanceSheet": bs, "cashFlow": sections["cashFlow"]}

    # ---- 저장 (한 transaction) ----
    def save_outcome(self, *, company: dict, key: FetchKey, fetch_quality: FinancialsQuality, accounts: list[FinancialAccount], result: dict,
                     fetched_at: datetime, source: str = "OpenDART") -> int:
        """기업 · 수집 메타 · Raw · 정규화 값 · 품질 · (미지원 결과) 를 하나의 transaction 으로 저장한다. 실패하면 모두 롤백된다."""
        with self._sf.begin() as s:
            c = self._upsert_company(s, corp_code=company["corpCode"], corp_name=company["corpName"], stock_code=company.get("stockCode"),
                                     corp_name_eng=company.get("corpNameEng"), corp_class=company.get("corpClass"), source=source)
            status = "success" if result["ok"] else result["code"]
            s.execute(update(FinancialFetch).where(
                FinancialFetch.company_id == c.id, FinancialFetch.report_code == key.report_code, FinancialFetch.basis_mode == key.basis_mode,
                FinancialFetch.years_key == key.years_key, FinancialFetch.is_current.is_(True)).values(is_current=False))
            f = FinancialFetch(
                company_id=c.id, report_code=key.report_code, basis_mode=key.basis_mode, basis_requested=fetch_quality.basis_requested,
                basis_used=fetch_quality.basis_used, basis_fallback=fetch_quality.basis_fallback, requested_years=list(fetch_quality.years_requested),
                years_key=key.years_key, received_years=list(fetch_quality.years_received), missing_years=list(fetch_quality.missing_years),
                raw_account_count=fetch_quality.raw_account_count, status=status, source=source, warnings=list(fetch_quality.warnings),
                is_current=True, fetched_at=fetched_at)
            s.add(f)
            s.flush()
            self._insert_raw(s, f.id, accounts)
            self._replace_normalized(s, f, c.id, result, key)
            return f.id

    @staticmethod
    def _insert_raw(s: Session, fetch_id: int, accounts: list[FinancialAccount]) -> None:
        if not accounts:
            return
        s.execute(insert(RawFinancialAccount), [{
            "fetch_id": fetch_id, "fiscal_year": a.fiscal_year, "report_year": a.report_year, "statement_type": a.statement_type,
            "raw_statement_type": a.raw_statement_type, "basis": a.basis, "account_id": a.account_id, "account_name": a.account_name,
            "account_detail": str((a.raw or {}).get("account_detail") or "").strip(), "amount": None if a.amount is None else Decimal(str(a.amount)),
            "currency": a.currency, "unit": "KRW", "raw": a.raw or {},
        } for a in accounts])

    def _replace_normalized(self, s: Session, f: FinancialFetch, company_id: int, result: dict, key: FetchKey) -> None:
        """정규화 값 / 품질 / 미지원 결과를 (교체해서) 저장한다. 저장 도중 실패하면 호출한 transaction 이 롤백한다."""
        s.execute(delete(NormalizedFinancial).where(NormalizedFinancial.fetch_id == f.id))
        s.execute(delete(DataQualityRecord).where(DataQualityRecord.fetch_id == f.id))
        s.execute(delete(UnsupportedResult).where(UnsupportedResult.company_id == company_id, UnsupportedResult.report_code == key.report_code,
                                                  UnsupportedResult.basis_mode == key.basis_mode, UnsupportedResult.years_key == key.years_key))
        f.status = "success" if result["ok"] else result["code"]
        if result["ok"]:
            data = result["data"]
            years = [int(p[:4]) for p in data["company"]["period"]]
            rows = []
            for i, year in enumerate(years):
                row: dict[str, Any] = {"fetch_id": f.id, "company_id": company_id, "fiscal_year": year, "basis": data["company"]["basis"]}
                for field, col in FIELD_TO_COLUMN.items():
                    series = data[SECTION_OF[field]].get(field)
                    row[col] = None if series is None else series[i]  # 없는 계정은 NULL (0 이 아니다)
                rows.append(row)
            s.execute(insert(NormalizedFinancial), rows)
        self._insert_quality(s, f, result["quality"])
        if not result["ok"]:
            s.add(UnsupportedResult(company_id=company_id, fetch_id=f.id, report_code=key.report_code, basis_mode=key.basis_mode, years_key=key.years_key,
                                    code=result["code"], reason=result["reason"], detail={"missingRequired": result.get("missingRequired", []), "warnings": result["quality"]["warnings"]},
                                    fetched_at=f.fetched_at))

    @staticmethod
    def _insert_quality(s: Session, f: FinancialFetch, q: dict) -> None:
        s.add(DataQualityRecord(
            fetch_id=f.id, status=f.status, basis_requested=q["basisRequested"], basis_used=q["basisUsed"], basis_fallback=q["basisFallback"],
            years_received=list(f.received_years), missing_years=list(f.missing_years), fields=q["fields"], warnings=q["warnings"], trace=q["trace"], checks=q["checks"]))

    def renormalize(self, fetch_id: int, normalize: Callable[[list[FinancialAccount]], dict]) -> dict | None:
        """저장된 Raw 에서 다시 정규화해 정규화 값 / 품질을 교체한다 (OpenDART 호출 없음). 한 transaction."""
        with self._sf.begin() as s:
            f = s.get(FinancialFetch, fetch_id)
            if f is None:
                return None
            result = normalize(self._load_raw(s, fetch_id))
            key = FetchKey("", f.report_code, f.basis_mode, tuple(f.requested_years))
            self._replace_normalized(s, f, f.company_id, result, key)
        return self.get_fetch(fetch_id)

    # 테스트 / 운영 점검용
    def counts(self) -> dict[str, int]:
        with self._sf() as s:
            return {m.__tablename__: s.execute(select(func.count()).select_from(m)).scalar_one() for m in (Company, FinancialFetch, RawFinancialAccount, NormalizedFinancial, DataQualityRecord, UnsupportedResult)}
