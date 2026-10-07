"""company.json(기업개황) 응답 → CompanyDetail. OpenDART 원본 필드명은 이 파일 밖으로 나가지 않는다."""
from __future__ import annotations

from typing import Any

from app.dart.models import CompanyDetail, DartApiError


def _s(body: dict[str, Any], key: str) -> str | None:
    value = body.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _date(value: str | None) -> str | None:
    """YYYYMMDD → YYYY-MM-DD. 형식이 다르면 None (값을 지어내지 않는다)."""
    if value and len(value) == 8 and value.isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return None


def _month(value: str | None) -> int | None:
    if value and value.isdigit() and 1 <= int(value) <= 12:
        return int(value)
    return None


def parse_company(body: dict[str, Any]) -> CompanyDetail:
    corp_code, corp_name = _s(body, "corp_code"), _s(body, "corp_name")
    if not corp_code or not corp_name:
        raise DartApiError("unknown")
    return CompanyDetail(
        corp_code=corp_code,
        corp_name=corp_name,
        corp_name_eng=_s(body, "corp_name_eng"),
        stock_code=_s(body, "stock_code"),
        ceo_name=_s(body, "ceo_nm"),
        corp_class=_s(body, "corp_cls"),
        address=_s(body, "adres"),
        homepage=_s(body, "hm_url"),
        industry_code=_s(body, "induty_code"),
        establishment_date=_date(_s(body, "est_dt")),
        fiscal_month=_month(_s(body, "acc_mt")),
    )
