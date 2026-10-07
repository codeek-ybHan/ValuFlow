"""AI Analyst LLM gateway: 질문 → 모델 → Tool 요청 → (frontend 가 Tool 실행) → Tool 결과 → 모델 → 최종 답변.

원칙
  - backend 는 valuation / historical 계산을 하지 않는다. Tool 은 frontend 의 deterministic runtime 이 실행하고, 결과만 받아 모델에 돌려준다.
  - 모델이 요청한 Tool 이름 · 입력은 backend 가 가진 허용 카탈로그(tool_catalog.json)로 검증한다. frontend 가 보낸 schema 는 믿지 않는다.
  - Tool loop 는 최대 호출 횟수(기본 5)로 제한한다. 한 번에 하나의 Tool 만 요청한다.
  - 최종 답변은 AiAnalystAnswer JSON schema 를 따라야 하며, 파싱 / 검증에 실패하면 invalid-model-output 이다 (문자열로 묵살하지 않는다).
  - 상태는 서버에 저장하지 않고 서명된 token 으로 주고받는다 (state.py).
"""
from __future__ import annotations

import json
import logging
import sys
import re
import secrets
import time
from typing import Any, Callable

from app.ai.catalog import ANSWER_SCHEMA, WORKFLOW_ANSWER_SCHEMA, load_catalog, tool_map, validate_value
from app.ai.errors import AiGatewayError, MESSAGES
from app.ai.provider import AiModelProvider, ModelTurn, ToolSpec
from app.ai.runtime import BackendTool
from app.ai.state import sign_state, verify_state

log = logging.getLogger("valuflow.ai")

DEFAULT_MAX_TOOL_CALLS = 5
DEFAULT_AGENT_MAX_TOOL_CALLS = 10     # Agent workflow 의 상한 (요청이 더 크게 요청해도 이 값으로 제한한다)
MAX_WORKFLOW_STEPS = 14
MAX_OBSERVATION_ITEMS = 8
MAX_OBSERVATION_CHARS = 160
STATE_TTL_SECONDS = 15 * 60
MAX_QUESTION_CHARS = 2000
MAX_TOOL_RESULT_CHARS = 60_000
AI_STATE_MISMATCH = "conversationId 가 대화 상태와 일치하지 않습니다."
TOOL_RESULT_STATUSES = {"ok", "unsupported", "unavailable", "invalid-input", "no-data", "rate-limit"}
TOOL_RESULT_KEYS = ("status", "tool", "data", "reason", "message", "sources", "warnings")


def _context_message(minimal_context: dict[str, Any] | None) -> str:
    """질문마다 달라지는 가벼운 context 요약 (수치 없음). 전체 ProjectState / Raw 행은 prompt 에 넣지 않는다."""
    return "Current context summary (no financial figures; use tools for any numbers):\n" + json.dumps(minimal_context or {}, ensure_ascii=False, sort_keys=True)


def _workflow_message(wf: dict[str, Any], budget: int) -> str:
    """검증된 workflow 계획으로 만든 system 안내. 계획은 Tool 이름과 목적뿐이며 값 · 데이터는 없다."""
    req = [s for s in wf["steps"] if not s["optional"]]
    opt = [s for s in wf["steps"] if s["optional"]]
    lines = [f"Agent workflow: {wf['label']} ({wf['type']}). You are an analyst-support agent, not an autonomous one.",
             f"Tool budget: at most {budget} tool calls in total; never repeat an identical call. Call every REQUIRED step (in this order) before you answer, unless its tool returns unavailable / no-data; call OPTIONAL steps only when the question or an observation needs them; do not call tools outside this plan unless an observation clearly requires it."]
    lines += ["REQUIRED steps:"] + [f"{i}. {s['tool']} - {s['purpose']}" for i, s in enumerate(req, 1)]
    if opt:
        lines += ["OPTIONAL steps:"] + [f"- {s['tool']} - {s['purpose']}" for s in opt]
    lines += ["Adapt to observations: after each result decide whether the next suggested tool is still needed or whether another one is. When a quality warning appears consider getMappingTrace; when news mentions a company event consider searchDisclosures.",
              "Never change valuation assumptions, Forecast, WACC, peer multiples or scenarios. If you think a change is worth considering, do NOT claim it was made: put it in proposedActions so the analyst can approve or reject it. Add a proposedAction ONLY when the tool results support a specific change: target = the exact assumption name as in the tool result, currentValue = that assumption's current value from the tools, proposedValue = a concrete value derived from tool data, rationale = why. A market observation (e.g. the risk-free rate) is evidence for a WACC input, not the WACC itself. If you cannot state all four concretely, leave proposedActions empty and describe the question in judgmentItems.",
              "In the final JSON also fill: reviewedAreas (areas you actually reviewed), limitations (data you could not obtain, e.g. a failed tool), judgmentItems (assumptions the analyst must decide), claims (each key claim with the tools that support it; use only tools you called successfully). Do not reveal internal reasoning."]
    return "\n".join(lines)


def _observation_message(obs: Any) -> str | None:
    """frontend 가 보낸 observation 을 길이 · 형태를 제한해서 안내문으로 만든다 (문서 본문 · 원문은 observation 에 없다)."""
    if not isinstance(obs, dict) or not isinstance(obs.get("tool"), str):
        return None
    clip = lambda x: str(x)[:MAX_OBSERVATION_CHARS]  # noqa: E731
    lst = lambda k: [clip(x) for x in (obs.get(k) if isinstance(obs.get(k), list) else [])[:MAX_OBSERVATION_ITEMS] if isinstance(x, (str, int, float))]  # noqa: E731
    hints = [h for h in (obs.get("nextHints") if isinstance(obs.get("nextHints"), list) else [])[:4] if isinstance(h, dict) and isinstance(h.get("tool"), str) and h["tool"] in tool_map()]
    parts = [f"Workflow observation for {clip(obs['tool'])}: status={clip(obs.get('status', ''))}."]
    for label, key in (("findings", "findings"), ("missing", "missing"), ("review warnings", "warnings")):
        if lst(key):
            parts.append(f"{label}: " + "; ".join(lst(key)) + ".")
    if hints:
        parts.append("Suggested next (if still needed): " + "; ".join(f"{h['tool']} ({clip(h.get('reason', ''))})" for h in hints) + ".")
    return " ".join(parts)


def _retrieval_audit(result: dict[str, Any]) -> dict[str, Any]:
    """검색 Tool 의 audit 정보 (문서 id · source type · 건수). 본문(chunk text) · embedding 은 담지 않는다."""
    data = result.get("data") if isinstance(result.get("data"), dict) else None
    if not data or "results" not in data or "retrieval" not in data:   # 외부 데이터 Tool(시세 · 금리 · 비교기업 · 뉴스): 출처 종류만 기록한다
        types = sorted({s["type"] for s in result.get("sources", []) if isinstance(s, dict) and s.get("type")})
        return {"sourceTypes": types} if types else {}
    items = data["results"]
    ret = data.get("retrieval") or {}
    return {"documentIds": sorted({str(i.get("documentId")) for i in items if i.get("documentId")}), "sourceTypes": sorted({i["sourceType"] for i in items if i.get("sourceType")}),
            "retrievalCount": len(items), "rerankedCount": int(ret.get("reranked") or 0)}


class AiGateway:
    def __init__(self, provider: AiModelProvider, secret: bytes, max_tool_calls: int = DEFAULT_MAX_TOOL_CALLS, ttl: int = STATE_TTL_SECONDS, clock: Callable[[], float] = time.time,
                 backend_tools: dict[str, BackendTool] | None = None, agent_max_tool_calls: int = DEFAULT_AGENT_MAX_TOOL_CALLS):
        self._provider = provider
        self._backend_tools = backend_tools or {}
        self._secret = secret
        self._max_calls = max_tool_calls
        self._agent_max = agent_max_tool_calls
        self._ttl = ttl
        self._clock = clock

    # ---- 공개 ----
    def query(self, question: str, minimal_context: dict[str, Any] | None = None, tool_names: list[str] | None = None, workflow: dict[str, Any] | None = None) -> dict[str, Any]:
        question = question.strip()
        if not question or len(question) > MAX_QUESTION_CHARS:
            raise AiGatewayError("invalid-request", "질문은 1~2000자여야 합니다.", 400)
        catalog = tool_map()
        names = list(catalog) if tool_names is None else tool_names
        unknown = [n for n in names if n not in catalog]
        if unknown:
            raise AiGatewayError("unknown-tool", f"{MESSAGES['unknown-tool']} ({', '.join(unknown)})", 400)
        mc = minimal_context or {}
        company = mc.get("company") if isinstance(mc.get("company"), dict) else {}
        support = mc.get("support") if isinstance(mc.get("support"), dict) else {}
        corp_code = company.get("corpCode") if isinstance(company.get("corpCode"), str) and re.fullmatch(r"\d{8}", company.get("corpCode", "")) else None
        wf = self._validate_workflow(workflow, names) if workflow is not None else None
        state = {
            "v": 1, "cid": secrets.token_hex(8), "created": self._clock(), "tools": names, "calls": 0, "pending": None,
            "max": min(int(wf["maxToolCalls"]), self._agent_max) if wf else self._max_calls, "workflow": wf, "seen": [], "reported": 0,
            # backend Tool 이 쓰는 context: 모델이 정하는 값이 아니라 질문 시작 시 frontend 가 보낸 context 에서 온다 (corpCode 격리)
            "ctx": {"corpCode": corp_code, "corpName": company.get("name") if isinstance(company.get("name"), str) else None, "support": support.get("status")},
            "backendResults": [], "trace": [],
            "messages": [
                {"role": "system", "content": load_catalog()["systemInstruction"]},
                {"role": "system", "content": _context_message(minimal_context)},
                {"role": "user", "content": question},
            ],
        }
        if wf:
            state["messages"].insert(2, {"role": "system", "content": _workflow_message(wf, state["max"])})
        return self._advance(state)

    def tool_result(self, token: str, call_id: str, tool_result: dict[str, Any], conversation_id: str | None = None, observation: dict[str, Any] | None = None) -> dict[str, Any]:
        state = verify_state(token, self._secret, self._ttl, self._clock)
        if conversation_id is not None and conversation_id != state.get("cid"):
            raise AiGatewayError("invalid-state", AI_STATE_MISMATCH, 400)
        pending = state.get("pending")
        if not pending or pending.get("callId") != call_id:
            raise AiGatewayError("invalid-tool-result", "대기 중인 Tool 호출과 callId 가 일치하지 않습니다.", 400)
        result = self._clean_result(tool_result, pending["name"])
        state["messages"].append({"role": "tool_result", "callId": call_id, "content": json.dumps(result, ensure_ascii=False, separators=(",", ":"))})
        for entry in reversed(state["trace"]):  # 방금 결과가 온 frontend Tool 의 상태를 기록한다
            if entry["runtime"] == "frontend" and entry["status"] == "requested":
                entry["status"] = result["status"]
                break
        state["pending"] = None
        note = _observation_message(observation) if state.get("workflow") and observation else None
        if note:   # frontend 가 Tool 결과를 요약한 observation(원문 아님)을 다음 단계 판단용으로 전달한다
            state["messages"].append({"role": "system", "content": note})
        return self._advance(state)

    # ---- 내부 ----
    def _validate_workflow(self, wf: Any, names: list[str]) -> dict[str, Any]:
        """frontend 가 보낸 workflow 계획을 검증한다: 알려진 종류, 그 종류의 Tool 만, 길이 · 한도 제한. 검증을 통과한 구조만 prompt 에 쓰인다."""
        bad = lambda m: AiGatewayError("invalid-request", f"workflow 요청이 올바르지 않습니다: {m}", 400)  # noqa: E731
        if not isinstance(wf, dict):
            raise bad("object 가 아닙니다")
        known = {w["type"]: w for w in load_catalog().get("workflows", [])}
        kind = wf.get("type")
        if kind not in known:
            raise bad("알 수 없는 workflow 종류")
        steps = wf.get("steps")
        if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_WORKFLOW_STEPS:
            raise bad("steps 개수")
        clean = []
        for s in steps:
            if not isinstance(s, dict) or not isinstance(s.get("tool"), str) or s["tool"] not in known[kind]["tools"] or s["tool"] not in names:
                raise bad("이 workflow 에서 허용되지 않는 Tool")
            clean.append({"id": str(s.get("id", ""))[:40], "tool": s["tool"], "purpose": str(s.get("purpose", ""))[:120], "optional": bool(s.get("optional", False))})
        mx = wf.get("maxToolCalls", self._agent_max)
        if isinstance(mx, bool) or not isinstance(mx, int) or mx < 1:
            raise bad("maxToolCalls")
        return {"type": kind, "label": str(known[kind]["label"]), "steps": clean, "maxToolCalls": min(mx, self._agent_max)}

    @staticmethod
    def _clean_result(raw: Any, expected_tool: str) -> dict[str, Any]:
        if not isinstance(raw, dict) or raw.get("status") not in TOOL_RESULT_STATUSES or raw.get("tool") != expected_tool:
            raise AiGatewayError("invalid-tool-result", MESSAGES["invalid-tool-result"], 400)
        cleaned = {k: raw[k] for k in TOOL_RESULT_KEYS if k in raw}  # 알려진 envelope 필드만 모델에 전달한다
        if len(json.dumps(cleaned, ensure_ascii=False)) > MAX_TOOL_RESULT_CHARS:
            raise AiGatewayError("tool-result-too-large", MESSAGES["tool-result-too-large"], 413)
        return cleaned

    def _specs(self, names: list[str]) -> list[ToolSpec]:
        catalog = tool_map()
        return [ToolSpec(n, catalog[n]["description"], catalog[n]["inputSchema"]) for n in names]

    def _advance(self, state: dict[str, Any]) -> dict[str, Any]:
        catalog = tool_map()
        while True:
            turn: ModelTurn = self._provider.create_response(state["messages"], self._specs(state["tools"]), WORKFLOW_ANSWER_SCHEMA if state.get("workflow") else ANSWER_SCHEMA)
            if turn.kind == "final":
                return {"status": "final", "conversationId": state["cid"], "answer": self._parse_answer(turn.content, WORKFLOW_ANSWER_SCHEMA if state.get("workflow") else ANSWER_SCHEMA), "toolCalls": state["calls"],
                        "toolTrace": state["trace"], "backendToolResults": state["backendResults"]}
            if turn.kind != "tool_call" or not turn.name or not turn.call_id:
                raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502)
            if turn.name not in state["tools"] or turn.name not in catalog:
                raise AiGatewayError("unknown-tool", f"{MESSAGES['unknown-tool']} ({turn.name})", 502)
            limit = state.get("max", self._max_calls)
            if state["calls"] >= limit:
                log.info("ai conversation %s stopped: tool limit", state["cid"])
                return {"status": "tool-limit", "conversationId": state["cid"], "toolCalls": state["calls"], "toolTrace": state["trace"], "backendToolResults": state["backendResults"],
                        "message": f"Tool 호출 한도({limit}회)에 도달해 안전하게 종료했습니다."}
            args = turn.arguments or {}
            state["calls"] += 1
            state["messages"].append({"role": "assistant_tool_call", "callId": turn.call_id, "name": turn.name, "arguments": args})
            execution = catalog[turn.name].get("execution", "frontend")
            key = turn.name + "|" + json.dumps(args, sort_keys=True, ensure_ascii=False)
            blocked: tuple[str, str] | None = None
            if catalog[turn.name].get("operation") == "write":   # write Tool 은 모델이 직접 실행할 수 없다 (사용자 승인 필요). 변경은 proposedActions 로 제안한다.
                blocked = ("approval-required", "This tool changes state and requires explicit user approval: it cannot be run by the model. Describe the proposed change in proposedActions instead.")
            elif key in state.setdefault("seen", []):   # 같은 Tool + 같은 입력의 반복 호출은 실행하지 않는다 (무한 loop 방지; 호출 횟수에는 포함된다)
                blocked = ("repeat-blocked", "This exact call (same tool, same input) was already made in this conversation. Use the earlier result instead of repeating it.")
            else:
                state["seen"].append(key)
            if blocked:
                state["trace"].append({"tool": turn.name, "runtime": "gateway", "status": blocked[0]})
                result = {"status": "invalid-input", "tool": turn.name, "reason": blocked[1], "sources": [], "warnings": []}
                state["messages"].append({"role": "tool_result", "callId": turn.call_id, "content": json.dumps(result, ensure_ascii=False)})
                continue
            err = validate_value(catalog[turn.name]["inputSchema"], args)
            if err:
                state["trace"].append({"tool": turn.name, "runtime": "gateway", "status": "invalid-input"})
                # 잘못된 입력은 frontend 로 보내지 않고, 모델이 고칠 수 있게 invalid-input 결과로 돌려준다 (호출 횟수에 포함)
                result = {"status": "invalid-input", "tool": turn.name, "reason": err, "sources": [], "warnings": []}
                state["messages"].append({"role": "tool_result", "callId": turn.call_id, "content": json.dumps(result, ensure_ascii=False)})
                continue
            if execution == "backend":
                # backend Tool: gateway 가 직접 실행하고 결과를 모델에 바로 전달한다 (호출 횟수 한도에는 똑같이 포함된다)
                result = self._run_backend_tool(turn.name, state["ctx"], args)
                state["backendResults"].append(result)
                state["trace"].append({"tool": turn.name, "runtime": "backend", "status": result["status"], **_retrieval_audit(result)})
                state["messages"].append({"role": "tool_result", "callId": turn.call_id, "content": json.dumps(result, ensure_ascii=False, separators=(",", ":"))})
                log.info("ai conversation %s backend-tool %s -> %s", state["cid"], turn.name, result["status"])
                continue
            state["trace"].append({"tool": turn.name, "runtime": "frontend", "status": "requested"})
            state["pending"] = {"callId": turn.call_id, "name": turn.name}
            log.info("ai conversation %s tool-call %s (%d)", state["cid"], turn.name, state["calls"])
            fresh = state["backendResults"][state.get("reported", 0):]   # 지난 응답 이후 backend 가 실행한 Tool 결과 (workflow 가 observation 을 만든다)
            state["reported"] = len(state["backendResults"])
            return {"status": "tool-call", "conversationId": state["cid"], "state": sign_state(state, self._secret), "callId": turn.call_id,
                    "tool": turn.name, "input": args, "toolCalls": state["calls"], "toolTrace": state["trace"], "backendToolResults": fresh}

    def _run_backend_tool(self, name: str, ctx: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
        impl = self._backend_tools.get(name)
        if impl is None:
            return {"status": "unavailable", "tool": name, "reason": "This tool is not configured on the server.", "sources": [], "warnings": []}
        try:
            return impl(ctx, args)
        except AiGatewayError as e:  # embedding / provider 오류: 질문 전체를 실패시키지 않고 이 Tool 만 unavailable 로 알린다
            return {"status": "unavailable", "tool": name, "reason": f"Tool failed ({e.code}).", "sources": [], "warnings": []}
        except Exception:  # noqa: BLE001  (DB 등 내부 오류의 원문은 모델 · 응답에 싣지 않는다)
            log.error("backend tool %s failed (%s)", name, type(sys.exc_info()[1]).__name__)   # 예외 본문 · traceback 은 남기지 않는다 (credential 이 섞일 수 있다)
            return {"status": "unavailable", "tool": name, "reason": "Tool failed (internal error).", "sources": [], "warnings": []}

    @staticmethod
    def _parse_answer(content: str, schema: dict[str, Any] = ANSWER_SCHEMA) -> dict[str, Any]:
        try:
            answer = json.loads(content)
        except (ValueError, TypeError):
            raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502) from None
        if validate_value(schema, answer) is not None:
            raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502)
        # AiAnalystAnswer(TS) 형태로: 비어 있는 period / unit 은 생략한다
        for e in answer["evidence"]:
            for k in ("period", "unit"):
                if e.get(k) is None:
                    e.pop(k, None)
        return answer
