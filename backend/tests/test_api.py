import httpx
import pytest

from app.dart.company import parse_company
from app.dart.models import DartApiError, STATUS_TO_ERROR
from tests.conftest import COMPANY_BODY, SECRET, make_zip, to_json


def test_company_detail_parsing():  # 8
    d = parse_company(COMPANY_BODY)
    assert d.corp_name == "삼성전자(주)" and d.ceo_name == "홍길동" and d.corp_class == "Y"
    assert d.establishment_date == "1969-01-13" and d.fiscal_month == 12 and d.industry_code == "264"
    assert parse_company({**COMPANY_BODY, "est_dt": "bad", "acc_mt": "99", "hm_url": " "}).establishment_date is None
    with pytest.raises(DartApiError):
        parse_company({"status": "000"})


def test_company_endpoint_domain_shape_without_raw_fields(client):
    r = client.get("/api/companies/00126380")
    assert r.status_code == 200
    body = r.json()
    assert body["corpCode"] == "00126380" and body["corpNameEng"] and body["fiscalMonth"] == 12 and body["source"] == "OpenDART" and body["fetchedAt"]
    for raw in ("jurir_no", "bizr_no", "phn_no", "status", "message", "corp_cls"):
        assert raw not in body


def test_search_endpoint_and_cache_reuse(client, fake):
    a = client.get("/api/companies", params={"q": "삼성전자"}).json()
    client.get("/api/companies", params={"q": "하이닉스"})
    assert a["items"][0] == {"corpCode": "00126380", "corpName": "삼성전자", "stockCode": "005930", "modifyDate": "20240101"}
    assert fake.count("corpCode.xml") == 1  # 검색마다 다시 받지 않는다
    assert client.post("/api/companies/refresh").json()["count"] == 6
    assert fake.count("corpCode.xml") == 2


def test_search_validation_and_limit(client):
    assert client.get("/api/companies").status_code == 400
    assert client.get("/api/companies", params={"q": "삼성", "limit": 0}).json()["error"]["code"] == "invalid-request"
    assert len(client.get("/api/companies", params={"q": "삼성", "limit": 2}).json()["items"]) == 2
    assert client.get("/api/companies", params={"q": "   "}).json()["items"] == []
    assert client.get("/api/companies/abc").json()["error"]["code"] == "invalid-request"


@pytest.mark.parametrize("status,code,http", [
    ("010", "invalid-key", 502), ("011", "invalid-key", 502), ("012", "invalid-key", 502), ("901", "invalid-key", 502),
    ("013", "no-data", 404), ("020", "rate-limit", 429), ("100", "invalid-request", 400),
    ("800", "dart-unavailable", 503), ("900", "unknown", 502), ("777", "unknown", 502),
])
def test_error_mapping(client, fake, status, code, http):  # 9
    fake.company_response = lambda: httpx.Response(200, json={"status": status, "message": f"원문 메시지 {SECRET}"})
    r = client.get("/api/companies/00126380")
    assert r.status_code == http
    assert r.json()["error"]["code"] == code
    assert SECRET not in r.text and "원문 메시지" not in r.text


def test_http_level_errors(client, fake):
    for status, code in ((503, "dart-unavailable"), (429, "rate-limit"), (400, "invalid-request")):
        fake.company_response = lambda s=status: httpx.Response(s)
        assert client.get("/api/companies/00126380").json()["error"]["code"] == code

    def boom(request):
        raise httpx.ConnectError("failed", request=request)

    fake.company_response = lambda: (_ for _ in ()).throw(httpx.ConnectError(f"fail https://x?crtfc_key={SECRET}"))
    r = client.get("/api/companies/00126380")
    assert r.status_code == 503 and SECRET not in r.text
    fake.company_response = lambda: httpx.Response(200, content=b"<html>")
    assert client.get("/api/companies/00126380").json()["error"]["code"] == "unknown"


def test_corp_code_error_xml_instead_of_zip(client, fake):
    fake.corp_response = lambda: httpx.Response(200, content="<result><status>020</status><message>limit</message></result>".encode())
    r = client.get("/api/companies", params={"q": "삼성"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate-limit"
    fake.corp_response = lambda: httpx.Response(200, content=b"garbage")
    assert client.get("/api/companies", params={"q": "삼성"}).json()["error"]["code"] == "unknown"


def test_missing_api_key_is_reported_without_calling_dart(make_client, fake):
    c = make_client(api_key="")
    r = c.get("/api/companies/00126380")
    assert r.json()["error"]["code"] == "invalid-key" and not fake.requests
    assert c.get("/api/health").json()["dartConfigured"] is False


def test_api_key_never_in_responses(client, fake):  # 10
    seen = []
    for path in ("/api/health", "/api/companies?q=삼성전자", "/api/companies/00126380", "/api/companies/zz", "/api/companies"):
        r = client.get(path)
        seen.append(r.text + str(dict(r.headers)))
    fake.company_response = lambda: httpx.Response(200, json={"status": "010"})
    seen.append(client.get("/api/companies/00126380").text)
    assert all(SECRET not in s and "crtfc_key" not in s for s in seen)
    # 요청에는 Key 가 서버에서 붙는다 (프론트가 보낸 것이 아니다)
    assert all(r.url.params.get("crtfc_key") == SECRET for r in fake.requests)


def test_unexpected_error_hides_internals(make_client, fake):
    fake.company_response = lambda: httpx.Response(200, json={"status": "000", "corp_code": "00126380", "corp_name": 123})
    r = make_client().get("/api/companies/00126380")
    assert r.json()["error"]["code"] == "unknown" and "Traceback" not in r.text


def test_settings_repr_hides_key():
    from app.config import Settings, load_settings
    assert SECRET not in repr(Settings(dart_api_key=SECRET))
    assert load_settings({"DART_API_KEY": " abc "}).dart_api_key == "abc"
    assert load_settings({}).has_api_key is False
