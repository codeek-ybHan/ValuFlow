"""OpenDART HTTP client. Key 는 요청 파라미터로만 쓰고 예외/로그에 남기지 않는다."""
from __future__ import annotations

import zipfile
import io
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from app.config import Settings
from app.dart.models import DartApiError, STATUS_TO_ERROR


def map_status(status: str | None) -> None:
    """OpenDART status 가 정상(000)이 아니면 DartApiError 를 던진다."""
    if status is None or status == "000":
        return
    raise DartApiError(STATUS_TO_ERROR.get(status, "unknown"))


class DartHttpClient:
    def __init__(self, settings: Settings, http: httpx.Client | None = None):
        self._settings = settings
        self._http = http or httpx.Client(timeout=settings.timeout_seconds)

    def _get(self, path: str, params: dict[str, str]) -> httpx.Response:
        if not self._settings.has_api_key:
            raise DartApiError("invalid-key", "서버에 DART_API_KEY 가 설정되어 있지 않습니다.")
        url = f"{self._settings.dart_base_url}/{path}"
        try:
            response = self._http.get(url, params={"crtfc_key": self._settings.dart_api_key, **params})
        except httpx.HTTPError:
            # httpx 예외 메시지에는 Key 가 담긴 URL 이 들어갈 수 있으므로 버린다.
            raise DartApiError("dart-unavailable") from None
        if response.status_code == 429:
            raise DartApiError("rate-limit")
        if response.status_code >= 500:
            raise DartApiError("dart-unavailable")
        if response.status_code >= 400:
            raise DartApiError("invalid-request")
        return response

    def fetch_corp_code_zip(self) -> bytes:
        """corpCode.xml 은 XML 텍스트가 아니라 ZIP binary 다. 오류일 때만 XML 상태 메시지가 온다."""
        content = self._get("corpCode.xml", {}).content
        if not zipfile.is_zipfile(io.BytesIO(content)):
            try:
                status = ET.fromstring(content).findtext("status")
            except ET.ParseError:
                raise DartApiError("unknown") from None
            map_status(status)
            raise DartApiError("unknown")
        return content

    def fetch_company(self, corp_code: str) -> dict[str, Any]:
        response = self._get("company.json", {"corp_code": corp_code})
        try:
            body = response.json()
        except ValueError:
            raise DartApiError("unknown") from None
        if not isinstance(body, dict):
            raise DartApiError("unknown")
        map_status(body.get("status"))
        return body

    def fetch_financials(self, corp_code: str, business_year: int, report_code: str, fs_div: str) -> list[dict[str, Any]]:
        """단일회사 전체 재무제표(fnlttSinglAcntAll). 데이터가 없으면(status 013) DartApiError('no-data')."""
        response = self._get("fnlttSinglAcntAll.json", {
            "corp_code": corp_code, "bsns_year": str(business_year), "reprt_code": report_code, "fs_div": fs_div,
        })
        try:
            body = response.json()
        except ValueError:
            raise DartApiError("unknown") from None
        if not isinstance(body, dict):
            raise DartApiError("unknown")
        map_status(body.get("status"))
        rows = body.get("list")
        if not isinstance(rows, list):
            raise DartApiError("no-data")
        return [r for r in rows if isinstance(r, dict)]

    def list_filings(self, corp_code: str, bgn_de: str, end_de: str, page: int = 1, page_count: int = 100, filing_type: str = "A") -> dict[str, Any]:
        """공시검색(list.json). 정기공시(A)가 기본. 데이터가 없으면(013) 빈 목록을 돌려준다."""
        response = self._get("list.json", {"corp_code": corp_code, "bgn_de": bgn_de, "end_de": end_de, "pblntf_ty": filing_type,
                                           "page_no": str(page), "page_count": str(page_count)})
        try:
            body = response.json()
        except ValueError:
            raise DartApiError("unknown") from None
        if not isinstance(body, dict):
            raise DartApiError("unknown")
        if body.get("status") == "013":
            return {"list": [], "total_page": 0}
        map_status(body.get("status"))
        return body

    def fetch_document_zip(self, receipt_no: str) -> bytes:
        """공시 원문(document.xml): XML 이 아니라 ZIP binary 다. 오류일 때만 XML 상태 메시지가 온다."""
        content = self._get("document.xml", {"rcept_no": receipt_no}).content
        if not zipfile.is_zipfile(io.BytesIO(content)):
            try:
                status = ET.fromstring(content).findtext("status")
            except ET.ParseError:
                raise DartApiError("unknown") from None
            map_status(status)
            raise DartApiError("unknown")
        return content
