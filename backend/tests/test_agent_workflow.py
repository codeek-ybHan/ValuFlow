"""Agent workflow 의 gateway 쪽 테스트: 계획 검증, 한도, 반복 호출 차단, write Tool 차단, observation, workflow 답변 schema. (mock 모델 · mock Tool, 실제 LLM 없음)"""
import json

import pytest

from app.ai.catalog import WORKFLOW_ANSWER_SCHEMA, load_catalog, validate_value
from app.ai.errors import AiGatewayError
from app.ai.gateway import AiGateway
from app.ai.state import derive_secret
from tests.test_ai_gateway import ANSWER, KEY, MockProvider, final, ok_result, tool_call

CTX = {"company": {"corpCode": "00126380", "name": "삼성전자"}, "support": {"status": "supported"}}
WF_EXTRA = {"reviewedAreas": ["WACC"], "limitations": [], "judgmentItems": ["최종 WACC"], "claims": [{"claim": "c", "tools": ["getValuationResult"]}], "proposedActions": []}
WF_ANSWER = {**ANSWER, **WF_EXTRA}


def plan(kind="wacc-review", tools=("getForecastAssumptions", "getValuationResult", "getMarketAssumptions"), mx=10):
    return {"type": kind, "steps": [{"id": f"s{i}", "tool": t, "purpose": f"purpose {t}", "optional": i > 1} for i, t in enumerate(tools)], "maxToolCalls": mx}


def gw(turns, backend=None, **kw):
    provider = MockProvider(turns)
    return AiGateway(provider, derive_secret("", KEY), backend_tools=backend or {}, **kw), provider


def counting_backend(name="getMarketAssumptions"):
    calls = []

    def tool(ctx, args):
        calls.append(args)
        return {"status": "ok", "tool": name, "data": {"applied": False}, "sources": [], "warnings": []}
    return {name: tool}, calls


def test_catalog_exports_workflows_and_operations():
    cat = load_catalog()
    assert {w["type"] for w in cat["workflows"]} == {"historical-review", "forecast-review", "wacc-review", "dcf-review", "sensitivity-scenario-review", "comparable-review", "event-review", "full-valuation-review"}
    assert all(t["operation"] in ("read", "search") for t in cat["tools"]), "현재 write Tool 은 없다"
    assert {t["name"]: t["operation"] for t in cat["tools"]}["searchKnowledge"] == "search" and {t["name"]: t["operation"] for t in cat["tools"]}["getMarketData"] == "read"


def test_workflow_plan_is_validated_and_budget_is_capped():
    g, _ = gw([final(WF_ANSWER)])
    for bad in ({"type": "hack-review", "steps": plan()["steps"], "maxToolCalls": 5},                       # 알 수 없는 종류
                {**plan(), "steps": []}, {**plan(), "steps": plan()["steps"] * 6},                          # 단계 수
                plan(tools=("getForecastAssumptions", "searchCompanyNews")),                                # 이 workflow 의 Tool 이 아님
                {**plan(), "maxToolCalls": 0}, {**plan(), "maxToolCalls": True}, "wacc-review"):
        with pytest.raises(AiGatewayError) as e:
            g.query("q", CTX, None, bad)
        assert e.value.code == "invalid-request" and e.value.status == 400
    with pytest.raises(AiGatewayError):
        g.query("q", CTX, ["getValuationResult"], plan())    # 이 요청에 허용되지 않은 Tool
    # 요청한 한도는 서버 상한으로 제한된다
    capped, _ = gw([tool_call("getMappingTrace", {"field": "revenue", "fiscalYear": 2010 + i}, id_=f"c{i}") for i in range(1, 8)], agent_max_tool_calls=3)
    r = capped.query("q", CTX, None, plan(mx=99))
    n = 0
    while r["status"] == "tool-call":
        n += 1
        r = capped.tool_result(r["state"], r["callId"], ok_result(r["tool"]), r["conversationId"])
    assert r["status"] == "tool-limit" and r["toolCalls"] == 3 and n == 3
    plain, _ = gw([tool_call("getMappingTrace", {"field": "revenue", "fiscalYear": 2010 + i}, id_=f"p{i}") for i in range(1, 8)], agent_max_tool_calls=3)
    r = plain.query("q", CTX)
    k = 0
    while r["status"] == "tool-call":
        k += 1
        r = plain.tool_result(r["state"], r["callId"], ok_result(r["tool"]), r["conversationId"])
    assert k == 5, "일반 질문의 한도(5회)는 그대로다"


def test_workflow_prompt_and_answer_schema_are_isolated_from_plain_queries():
    g, provider = gw([final(WF_ANSWER), final(ANSWER)])
    out = g.query("현재 WACC 적절해?", CTX, None, plan())
    assert out["status"] == "final" and out["answer"]["proposedActions"] == [] and out["answer"]["claims"][0]["tools"] == ["getValuationResult"]
    system = [m["content"] for m in provider.calls[0]["messages"] if m["role"] == "system"]
    wf = next(s for s in system if s.startswith("Agent workflow"))
    assert "WACC Review" in wf and "at most 10 tool calls" in wf and "1. getForecastAssumptions - purpose getForecastAssumptions" in wf and "- getMarketAssumptions - purpose getMarketAssumptions" in wf
    assert "Never change valuation assumptions" in wf and "proposedActions" in wf and "Do not reveal internal reasoning" in wf
    assert "REQUIRED steps:" in wf and "OPTIONAL steps:" in wf and wf.index("getMarketAssumptions") > wf.index("getValuationResult"), "필수 / 선택 단계가 구분된다"
    assert {"reviewedAreas", "limitations", "judgmentItems", "claims", "proposedActions"} <= set(provider.calls[0]["schema_required"])
    plain = g.query("현재 WACC 는?", CTX)
    assert plain["status"] == "final" and "proposedActions" not in plain["answer"] and "reviewedAreas" not in provider.calls[1]["schema_required"]
    assert not any(m["content"].startswith("Agent workflow") for m in provider.calls[1]["messages"] if m["role"] == "system")
    # workflow 최종 답변이 schema 를 어기면(변경 제안의 type 이 허용 밖 등) 문자열로 묵살하지 않는다
    bad = {**WF_ANSWER, "proposedActions": [{"type": "apply-everything", "target": "x", "currentValue": None, "proposedValue": None, "rationale": "r"}]}
    with pytest.raises(AiGatewayError) as e:
        gw([final(bad)])[0].query("q", CTX, None, plan())
    assert e.value.code == "invalid-model-output"
    with pytest.raises(AiGatewayError):
        gw([final(ANSWER)])[0].query("q", CTX, None, plan())   # workflow 인데 추가 필드가 없다
    assert validate_value(WORKFLOW_ANSWER_SCHEMA, WF_ANSWER) is None
    ok_cp = {**WF_ANSWER, "proposedActions": [{"type": "change-wacc", "target": "WACC", "currentValue": "8.1%", "proposedValue": "7.8%", "rationale": "r"}]}
    assert validate_value(WORKFLOW_ANSWER_SCHEMA, ok_cp) is None


def test_repeated_identical_calls_are_blocked_and_still_count_toward_the_budget():
    backend, calls = counting_backend()
    g, provider = gw([tool_call("getMarketAssumptions", {}, id_="a"), tool_call("getMarketAssumptions", {}, id_="b"), tool_call("getMarketAssumptions", {}, id_="c"), final(WF_ANSWER)], backend)
    out = g.query("q", CTX, None, plan())
    assert out["status"] == "final" and len(calls) == 1, "같은 Tool + 같은 입력은 한 번만 실행된다"
    assert [(t["runtime"], t["status"]) for t in out["toolTrace"]] == [("backend", "ok"), ("gateway", "repeat-blocked"), ("gateway", "repeat-blocked")] and out["toolCalls"] == 3
    fed = json.loads(provider.calls[2]["messages"][-1]["content"])
    assert fed["status"] == "invalid-input" and "already made" in fed["reason"]
    # 입력이 다르면 반복이 아니다 / frontend Tool 도 같은 규칙
    f, _ = gw([tool_call("getMappingTrace", {"field": "revenue"}, id_="a"), tool_call("getMappingTrace", {"field": "revenue"}, id_="b"), tool_call("getMappingTrace", {"field": "operatingProfit"}, id_="c")])
    r = f.query("q", CTX)
    r = f.tool_result(r["state"], r["callId"], ok_result(r["tool"]), r["conversationId"])
    assert r["status"] == "tool-call" and r["input"] == {"field": "operatingProfit"}, "반복 호출은 frontend 로 가지 않고 건너뛴다"
    # 반복 차단은 일반 질문에도 적용된다 (예산을 소모해 loop 가 끝난다)
    h, _ = gw([tool_call("getMarketAssumptions", {}, id_=f"x{i}") for i in range(1, 9)], counting_backend()[0])
    res = h.query("q", CTX)
    assert res["status"] == "tool-limit" and [t["status"] for t in res["toolTrace"]].count("repeat-blocked") == 4


def test_write_tools_are_never_run_by_the_model(monkeypatch):
    import app.ai.gateway as gateway_module
    real = gateway_module.tool_map()
    fake = {**real, "updateWacc": {"name": "updateWacc", "description": "x", "inputSchema": {"type": "object", "properties": {"wacc": {"type": "number"}}, "required": ["wacc"]}, "execution": "frontend", "operation": "write", "allowedWhenUnsupported": False}}
    monkeypatch.setattr(gateway_module, "tool_map", lambda: fake)
    ran = []
    g, provider = gw([tool_call("updateWacc", {"wacc": 0.078}, id_="w1"), final(ANSWER)], {"updateWacc": lambda c, a: ran.append(a) or {}})
    out = g.query("WACC 를 바꿔줘", CTX, ["updateWacc", "getValuationResult"])
    assert out["status"] == "final", "frontend 로 tool-call 이 나가지 않는다"
    assert ran == [] and out["toolTrace"] == [{"tool": "updateWacc", "runtime": "gateway", "status": "approval-required"}]
    fed = json.loads(provider.calls[1]["messages"][-1]["content"])
    assert fed["status"] == "invalid-input" and "explicit user approval" in fed["reason"] and "proposedActions" in fed["reason"]


def test_observations_reach_the_model_only_in_workflows_and_are_sanitized():
    g, provider = gw([tool_call("getValuationResult", {}, id_="a"), final(WF_ANSWER)])
    r = g.query("q", CTX, None, plan())
    obs = {"tool": "getValuationResult", "status": "ok", "findings": [f"finding {i} " + "x" * 400 for i in range(20)], "missing": ["beta"], "warnings": ["w1"],
           "nextHints": [{"tool": "getMappingTrace", "reason": "quality"}, {"tool": "rm -rf", "reason": "evil"}, "not-a-dict"], "raw": "SHOULD-NOT-APPEAR"}
    g.tool_result(r["state"], r["callId"], ok_result("getValuationResult"), r["conversationId"], obs)
    note = [m for m in provider.calls[1]["messages"] if m["role"] == "system" and m["content"].startswith("Workflow observation")]
    assert len(note) == 1
    text = note[0]["content"]
    assert "Workflow observation for getValuationResult: status=ok." in text and "missing: beta." in text and "review warnings: w1." in text
    assert text.count("finding ") == 8 and max(len(p) for p in text.split("; ")) < 400, "개수 · 길이 제한"
    assert "getMappingTrace (quality)" in text and "rm -rf" not in text and "SHOULD-NOT-APPEAR" not in text
    p, pp = gw([tool_call("getValuationResult", {}, id_="a"), final(ANSWER)])
    r2 = p.query("q", CTX)
    p.tool_result(r2["state"], r2["callId"], ok_result("getValuationResult"), r2["conversationId"], obs)
    assert not any(m["content"].startswith("Workflow observation") for m in pp.calls[1]["messages"] if m["role"] == "system"), "workflow 가 아니면 observation 을 쓰지 않는다"


def test_tool_call_response_carries_fresh_backend_results_and_final_is_cumulative():
    backend, _ = counting_backend()
    g, _ = gw([tool_call("getMarketAssumptions", {}, id_="a"), tool_call("getValuationResult", {}, id_="b"), tool_call("getMarketAssumptions", {"x": 1}, id_="c"), final(WF_ANSWER)], backend)
    # getMarketAssumptions 의 inputSchema 는 빈 object 라 {"x": 1} 은 invalid-input: 두 번째 backend 결과는 만들어지지 않는다
    r = g.query("q", CTX, None, plan())
    assert r["status"] == "tool-call" and r["tool"] == "getValuationResult"
    assert [x["tool"] for x in r["backendToolResults"]] == ["getMarketAssumptions"] and [t["runtime"] for t in r["toolTrace"]] == ["backend", "frontend"]
    out = g.tool_result(r["state"], r["callId"], ok_result("getValuationResult"), r["conversationId"])
    assert out["status"] == "final" and [x["tool"] for x in out["backendToolResults"]] == ["getMarketAssumptions"]
