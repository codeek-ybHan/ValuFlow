"""Backend 도메인 모델과 오류. OpenDART 원본 응답은 이 모델로 변환해서만 내보낸다."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ErrorCode = Literal["invalid-key", "no-data", "rate-limit", "dart-unavailable", "invalid-request", "unknown"]

# OpenDART status → application error. 000 은 정상.
STATUS_TO_ERROR: dict[str, ErrorCode] = {
    "010": "invalid-key",       # 등록되지 않은 키
    "011": "invalid-key",       # 사용할 수 없는 키
    "012": "invalid-key",       # 접근 불가 IP
    "901": "invalid-key",       # 사용자 계정 유효기간 만료
    "013": "no-data",           # 조회된 데이터 없음
    "014": "no-data",           # 파일이 존재하지 않음
    "020": "rate-limit",        # 요청 제한 초과
    "021": "invalid-request",   # 조회 가능한 회사 개수 초과
    "100": "invalid-request",   # 필드 값 오류
    "101": "invalid-request",   # 부적절한 접근
    "800": "dart-unavailable",  # 시스템 점검
    "900": "unknown",           # 정의되지 않은 오류
}

# 사용자에게 보여 주는 문구. OpenDART 의 원문 메시지, URL, Key 는 담지 않는다.
ERROR_MESSAGES: dict[ErrorCode, str] = {
    "invalid-key": "OpenDART API Key 설정에 문제가 있습니다. 서버 설정을 확인하세요.",
    "no-data": "조회된 데이터가 없습니다.",
    "rate-limit": "OpenDART 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
    "dart-unavailable": "OpenDART 에 연결할 수 없습니다. 잠시 후 다시 시도하세요.",
    "invalid-request": "요청 값이 올바르지 않습니다.",
    "unknown": "알 수 없는 오류가 발생했습니다.",
}

HTTP_STATUS: dict[ErrorCode, int] = {
    "invalid-key": 502,
    "no-data": 404,
    "rate-limit": 429,
    "dart-unavailable": 503,
    "invalid-request": 400,
    "unknown": 502,
}


class DartApiError(Exception):
    """OpenDART 호출 실패. message 는 항상 정제된 문구이며 Key 나 원본 오류를 담지 않는다."""

    def __init__(self, code: ErrorCode, message: str | None = None):
        self.code: ErrorCode = code
        self.message = message or ERROR_MESSAGES[code]
        super().__init__(self.message)


@dataclass(frozen=True)
class CorpRecord:
    corp_code: str
    corp_name: str
    corp_eng_name: str | None
    stock_code: str | None
    modify_date: str | None


@dataclass(frozen=True)
class CompanyDetail:
    corp_code: str
    corp_name: str
    corp_name_eng: str | None
    stock_code: str | None
    ceo_name: str | None
    corp_class: str | None
    address: str | None
    homepage: str | None
    industry_code: str | None
    establishment_date: str | None
    fiscal_month: int | None


@dataclass(frozen=True)
class FinancialAccount:
    """DartRawAccount 로 내보내는 한 행 (회계연도 하나, 계정 하나). raw 에 원본 응답 행 전체를 보존한다."""

    account_name: str
    account_id: str | None
    statement_type: str          # BS | IS | CF  (포괄손익계산서 CIS 는 IS 로 묶음)
    raw_statement_type: str      # 원본 sj_div (BS / IS / CIS / CF)
    basis: str                   # Consolidated | Separate
    fiscal_year: int
    report_year: int
    amount: float | int | None   # 빈 값은 0 이 아니라 None
    currency: str | None
    raw: dict


@dataclass
class FinancialsQuality:
    basis_requested: str
    basis_used: str | None
    basis_fallback: bool
    years_requested: list[int]
    years_received: list[int]
    missing_years: list[int]
    raw_account_count: int
    warnings: list[str]
