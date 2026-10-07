import zipfile
from datetime import datetime, timezone

import pytest

from app.dart.corp_codes import CorpCodeCache, parse_corp_code_xml, parse_corp_code_zip, search_companies
from app.dart.models import DartApiError
from tests.conftest import CORP_XML, make_zip


@pytest.fixture
def records():
    return parse_corp_code_zip(make_zip())


def test_zip_parse():  # 1
    r = parse_corp_code_zip(make_zip())
    assert len(r) == 6
    assert r[0].corp_code == "00126380"


def test_zip_with_different_inner_name_and_bad_zip():
    assert len(parse_corp_code_zip(make_zip(name="corpcode.XML"))) == 6
    with pytest.raises(DartApiError):
        parse_corp_code_zip(b"not a zip")
    import io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("readme.txt", "x")
    with pytest.raises(DartApiError):
        parse_corp_code_zip(buf.getvalue())


def test_xml_parsing_fields():  # 2
    r = parse_corp_code_xml(CORP_XML)
    s = r[0]
    assert (s.corp_code, s.corp_name, s.corp_eng_name, s.stock_code, s.modify_date) == ("00126380", "삼성전자", "SAMSUNG ELECTRONICS CO,.LTD", "005930", "20240101")
    assert r[1].stock_code is None  # 공백 → None
    with pytest.raises(DartApiError):
        parse_corp_code_xml(b"<broken")


def test_exact_search_first(records):  # 3
    out = search_companies(records, "삼성전자")
    assert [r.corp_name for r in out] == ["삼성전자", "삼성전자판매", "삼성전자서비스", "우리삼성전자부품"]


def test_prefix_search(records):  # 4
    out = search_companies(records, "삼성전자")
    names = [r.corp_name for r in out]
    assert names.index("삼성전자서비스") < names.index("우리삼성전자부품")
    assert [r.corp_name for r in search_companies(records, "SK")] == ["SK하이닉스"]


def test_contains_search_and_unlisted_kept(records):  # 5
    out = search_companies(records, "하이닉스")
    assert [r.corp_name for r in out] == ["하이닉스소재", "SK하이닉스"] or [r.corp_name for r in out][0] == "하이닉스소재"
    assert {r.corp_name for r in out} == {"하이닉스소재", "SK하이닉스"}
    assert any(r.stock_code is None for r in search_companies(records, "삼성전자"))  # 비상장 제거 안 함


def test_listed_first_within_same_rank(records):
    out = search_companies(records, "삼성전자")
    prefix = [r for r in out if r.corp_name.startswith("삼성전자") and r.corp_name != "삼성전자"]
    assert prefix[0].stock_code is not None and prefix[1].stock_code is None


def test_stock_code_search(records):  # 6
    assert [r.corp_name for r in search_companies(records, "005930")] == ["삼성전자"]
    assert [r.corp_name for r in search_companies(records, "0059")] == ["삼성전자"]
    assert search_companies(records, "999999") == []


def test_limit_blank_and_case(records):
    assert len(search_companies(records, "삼성", limit=2)) == 2
    assert search_companies(records, "   ") == []
    assert [r.corp_name for r in search_companies(records, "sk하이닉스")] == ["SK하이닉스"]


def test_cache_reuse_and_refresh():  # 7
    calls = []
    now = [datetime(2026, 1, 1, tzinfo=timezone.utc)]

    def loader():
        calls.append(1)
        return make_zip()

    cache = CorpCodeCache(loader, clock=lambda: now[0])
    assert cache.fetched_at is None
    a = cache.get()
    b = cache.get()
    assert a is b and len(calls) == 1
    assert cache.fetched_at == "2026-01-01T00:00:00+00:00"
    now[0] = datetime(2026, 2, 1, tzinfo=timezone.utc)
    cache.get(refresh=True)
    assert len(calls) == 2 and cache.fetched_at.startswith("2026-02-01")


def test_failed_refresh_keeps_old_cache():
    state = {"fail": False}

    def loader():
        if state["fail"]:
            raise DartApiError("dart-unavailable")
        return make_zip()

    cache = CorpCodeCache(loader)
    first = cache.get()
    state["fail"] = True
    with pytest.raises(DartApiError):
        cache.get(refresh=True)
    assert cache.get() is first
