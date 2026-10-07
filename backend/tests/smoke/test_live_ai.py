"""실제 LLM smoke test. OPENAI_API_KEY 가 있을 때만 실행하고, 없으면 skip 한다 (CI 는 LLM API 에 의존하지 않는다).

Tool Runtime(frontend)은 TS 라서 여기서는 같은 envelope 의 Tool 결과를 stub 으로 만든다 (삼성전자 정규화 golden 의 값 사용).
확인하는 것: 모델이 Tool 을 호출하는가, 답변이 Tool 값에 근거하는가, 출처를 포함하는가, 없는 값(D&A)을 지어내지 않는가.
"""
import json
import re
from pathlib import Path

import pytest

from app.ai.gateway import AiGateway
from app.ai.provider import OpenAiProvider
from app.ai.state import derive_secret
from app.config import load_settings

settings = load_settings()
pytestmark = pytest.mark.skipif(not settings.has_ai, reason="OPENAI_API_KEY 가 없어 실제 LLM smoke test 를 건너뜁니다.")

GOLDEN = json.loads((Path(__file__).resolve().parents[1] / "golden" / "samsung.json").read_text(encoding="utf-8"))["expected"]["data"]
AT = "2026-10-07T00:00:00+00:00"
D_A_REASON = "Not available from current OpenDART financial statement source."


def historical_result() -> dict:
    rev, op = GOLDEN["incomeStatement"]["revenue"], GOLDEN["incomeStatement"]["operatingProfit"]
    margin = [o / r for o, r in zip(op, rev)]
    growth = [None] + [rev[i] / rev[i - 1] - 1 for i in range(1, 3)]
    return {
        "status": "ok", "tool": "getHistoricalAnalysis",
        "data": {
            "periods": ["2023A", "2024A", "2025A"], "unit": "KRW million (비율 제외)",
            "metrics": {
                "operatingMargin": {"label": "Operating Margin", "unit": "ratio (소수)", "values": margin, "status": "available", "notes": []},
                "revenueGrowth": {"label": "Revenue Growth (YoY)", "unit": "ratio (소수)", "values": growth, "status": "available", "notes": []},
                "depreciation": {"label": "D&A", "unit": "KRW million", "values": [None, None, None], "status": "missing", "notes": [], "missing": {"status": "missing", "value": None, "reason": D_A_REASON}},
            },
            "trends": {"operatingMargin": {"direction": "improving", "quality": "available"}, "revenueGrowth": {"direction": "decelerating", "quality": "available"}},
            "revenueCagr": 0.135, "capexBasis": "CAPEX (PPE only)",
            "depreciation": {"status": "missing", "value": None, "reason": D_A_REASON},
        },
        "sources": [{"kind": "actual", "origin": "opendart", "basis": "Consolidated", "fetchedAt": AT, "persisted": True, "note": None}],
        "warnings": [{"code": "data-quality", "text": "D&A not available from current OpenDART financial statement source.", "level": "note"}],
    }


def run(question: str):
    gateway = AiGateway(OpenAiProvider(settings.openai_api_key, settings.openai_model, settings.openai_base_url), derive_secret(settings.ai_state_secret, settings.openai_api_key))
    ctx = {"company": {"name": "삼성전자", "stockCode": "005930", "basis": "Consolidated"}, "support": {"status": "supported"}, "dataKinds": {"historical": "actual", "assumptions": "none", "results": "none"},
           "periods": ["2023A", "2024A", "2025A"], "availability": {"historical": True, "dataQuality": True, "valuationResult": False}}
    resp = gateway.query(question, ctx)
    called = []
    for _ in range(6):
        if resp["status"] != "tool-call":
            break
        called.append(resp["tool"])
        result = historical_result() if resp["tool"] == "getHistoricalAnalysis" else {"status": "unavailable", "tool": resp["tool"], "reason": "not available in this smoke test", "sources": [], "warnings": []}
        resp = gateway.tool_result(resp["state"], resp["callId"], result, resp["conversationId"])
    return called, resp


def test_operating_margin_question_uses_historical_tool():
    called, resp = run("최근 영업이익률이 어떻게 변했어?")
    assert "getHistoricalAnalysis" in called, called
    assert resp["status"] == "final", resp
    a = resp["answer"]
    text = a["summary"] + " " + " ".join(e["value"] + " " + e["label"] for e in a["evidence"])
    found = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text.replace(",", ""))]
    # 표시용 반올림(2.54% 등)은 허용한다: 기대값(2.5 / 10.9 / 13.1)에서 0.06 이내
    for expected in (2.5, 10.9, 13.1):
        assert any(abs(f - expected) <= 0.06 for f in found), f"{expected}% 에 해당하는 값이 답변에 없다: {text}"
    assert not re.search(r"(매수|매도|buy|sell)", a["summary"], re.I)
    assert any(e["tool"] == "getHistoricalAnalysis" for e in a["evidence"])


def test_depreciation_question_does_not_invent_a_number():
    called, resp = run("현재 D&A는 얼마야?")
    assert resp["status"] == "final", (called, resp)
    a = resp["answer"]
    for e in a["evidence"]:
        if re.search(r"D&A|감가상각|depreciation", e["label"], re.I):
            assert not re.search(r"\d", e["value"]), f"D&A 에 숫자를 만들었다: {e}"
    assert not re.search(r"D&A.{0,20}\d[\d,\.]{3,}", a["summary"]), a["summary"]
