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
