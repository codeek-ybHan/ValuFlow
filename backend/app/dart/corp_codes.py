"""corpCode.xml(ZIP) 파싱, 서버 메모리 cache, 기업 검색."""
from __future__ import annotations

import io
import threading
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from typing import Callable

from app.dart.models import CorpRecord, DartApiError


def _text(node: ET.Element, tag: str) -> str | None:
    value = (node.findtext(tag) or "").strip()
    return value or None  # OpenDART 는 비상장사 stock_code 를 공백 문자열로 준다


def parse_corp_code_xml(xml_bytes: bytes) -> list[CorpRecord]:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        raise DartApiError("unknown") from None
    records: list[CorpRecord] = []
    for node in root.iter("list"):
        corp_code, corp_name = _text(node, "corp_code"), _text(node, "corp_name")
        if not corp_code or not corp_name:
            continue
        records.append(CorpRecord(
            corp_code=corp_code,
            corp_name=corp_name,
            corp_eng_name=_text(node, "corp_eng_name"),
            stock_code=_text(node, "stock_code"),
            modify_date=_text(node, "modify_date"),
        ))
    return records


def parse_corp_code_zip(zip_bytes: bytes) -> list[CorpRecord]:
    """HTTP 응답(ZIP binary) → CORPCODE.xml → CorpRecord 목록."""
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
            names = [n for n in archive.namelist() if n.upper().endswith(".XML")]
            if not names:
                raise DartApiError("unknown")
            xml_bytes = archive.read(names[0])
    except zipfile.BadZipFile:
        raise DartApiError("unknown") from None
    return parse_corp_code_xml(xml_bytes)


class CorpCodeCache:
    """전체 기업 목록을 한 번만 내려받아 재사용한다. refresh 로 다시 받을 수 있다."""

    def __init__(self, loader: Callable[[], bytes], clock: Callable[[], datetime] | None = None):
        self._loader = loader
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()
        self._records: list[CorpRecord] | None = None
        self._fetched_at: datetime | None = None

    @property
    def fetched_at(self) -> str | None:
        return self._fetched_at.isoformat() if self._fetched_at else None

    def get(self, refresh: bool = False) -> list[CorpRecord]:
        with self._lock:
            if self._records is None or refresh:
                records = parse_corp_code_zip(self._loader())  # 실패하면 기존 cache 를 유지한다
                self._records, self._fetched_at = records, self._clock()
            return self._records


def _rank(record: CorpRecord, q: str) -> int | None:
    """0 exact · 1 prefix · 2 contains. 종목코드는 exact / prefix 만 본다. 일치하지 않으면 None."""
    name = record.corp_name.casefold()
    if name == q or record.stock_code == q:
        return 0
    if name.startswith(q) or (record.stock_code is not None and q.isdigit() and record.stock_code.startswith(q)):
        return 1
    if q in name:
        return 2
    return None


def search_companies(records: list[CorpRecord], query: str, limit: int = 20) -> list[CorpRecord]:
    """exact → prefix → contains 순. 같은 등급에서는 상장사 우선, 이름이 짧은 순, 이름순. 비상장사도 제외하지 않는다."""
    q = query.strip().casefold()
    if not q or limit <= 0:
        return []
    ranked = [(r, rec) for rec in records if (r := _rank(rec, q)) is not None]
    ranked.sort(key=lambda x: (x[0], x[1].stock_code is None, len(x[1].corp_name), x[1].corp_name, x[1].corp_code))
    return [rec for _, rec in ranked[:limit]]
