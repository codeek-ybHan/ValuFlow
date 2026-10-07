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
import re
import secrets
import time
from typing import Any, Callable

from app.ai.catalog import ANSWER_SCHEMA, load_catalog, tool_map, validate_value
from app.ai.errors import AiGatewayError, MESSAGES
from app.ai.provider import AiModelProvider, ModelTurn, ToolSpec
from app.ai.runtime import BackendTool
from app.ai.state import sign_state, verify_state

log = logging.getLogger("valuflow.ai")

DEFAULT_MAX_TOOL_CALLS = 5
STATE_TTL_SECONDS = 15 * 60
MAX_QUESTION_CHARS = 2000
MAX_TOOL_RESULT_CHARS = 60_000
AI_STATE_MISMATCH = "conversationId 가 대화 상태와 일치하지 않습니다."
TOOL_RESULT_STATUSES = {"ok", "unsupported", "unavailable", "invalid-input"}
TOOL_RESULT_KEYS = ("status", "tool", "data", "reason", "message", "sources", "warnings")


def _context_message(minimal_context: dict[str, Any] | None) -> str:
    """질문마다 달라지는 가벼운 context 요약 (수치 없음). 전체 ProjectState / Raw 행은 prompt 에 넣지 않는다."""
    return "Current context summary (no financial figures; use tools for any numbers):\n" + json.dumps(minimal_context or {}, ensure_ascii=False, sort_keys=True)


def _retrieval_audit(result: dict[str, Any]) -> dict[str, Any]:
    """검색 Tool 의 audit 정보 (문서 id · source type · 건수). 본문(chunk text) · embedding 은 담지 않는다."""
    data = result.get("data") if isinstance(result.get("data"), dict) else None
    if not data or "results" not in data:
        return {}
    items = data["results"]
    ret = data.get("retrieval") or {}
    return {"documentIds": sorted({str(i.get("documentId")) for i in items if i.get("documentId")}), "sourceTypes": sorted({i["sourceType"] for i in items if i.get("sourceType")}),
            "retrievalCount": len(items), "rerankedCount": int(ret.get("reranked") or 0)}


class AiGateway:
    def __init__(self, provider: AiModelProvider, secret: bytes, max_tool_calls: int = DEFAULT_MAX_TOOL_CALLS, ttl: int = STATE_TTL_SECONDS, clock: Callable[[], float] = time.time,
                 backend_tools: dict[str, BackendTool] | None = None):
        self._provider = provider
        self._backend_tools = backend_tools or {}
        self._secret = secret
        self._max_calls = max_tool_calls
        self._ttl = ttl
        self._clock = clock

    # ---- 공개 ----
    def query(self, question: str, minimal_context: dict[str, Any] | None = None, tool_names: list[str] | None = None) -> dict[str, Any]:
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
        state = {
            "v": 1, "cid": secrets.token_hex(8), "created": self._clock(), "tools": names, "calls": 0, "pending": None,
            # backend Tool 이 쓰는 context: 모델이 정하는 값이 아니라 질문 시작 시 frontend 가 보낸 context 에서 온다 (corpCode 격리)
            "ctx": {"corpCode": corp_code, "corpName": company.get("name") if isinstance(company.get("name"), str) else None, "support": support.get("status")},
            "backendResults": [], "trace": [],
            "messages": [
                {"role": "system", "content": load_catalog()["systemInstruction"]},
                {"role": "system", "content": _context_message(minimal_context)},
                {"role": "user", "content": question},
            ],
        }
        return self._advance(state)

    def tool_result(self, token: str, call_id: str, tool_result: dict[str, Any], conversation_id: str | None = None) -> dict[str, Any]:
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
        return self._advance(state)

    # ---- 내부 ----
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
            turn: ModelTurn = self._provider.create_response(state["messages"], self._specs(state["tools"]), ANSWER_SCHEMA)
            if turn.kind == "final":
                return {"status": "final", "conversationId": state["cid"], "answer": self._parse_answer(turn.content), "toolCalls": state["calls"],
                        "toolTrace": state["trace"], "backendToolResults": state["backendResults"]}
            if turn.kind != "tool_call" or not turn.name or not turn.call_id:
                raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502)
            if turn.name not in state["tools"] or turn.name not in catalog:
                raise AiGatewayError("unknown-tool", f"{MESSAGES['unknown-tool']} ({turn.name})", 502)
            if state["calls"] >= self._max_calls:
                log.info("ai conversation %s stopped: tool limit", state["cid"])
                return {"status": "tool-limit", "conversationId": state["cid"], "toolCalls": state["calls"], "toolTrace": state["trace"], "backendToolResults": state["backendResults"],
                        "message": f"Tool 호출 한도({self._max_calls}회)에 도달해 안전하게 종료했습니다."}
            args = turn.arguments or {}
            state["calls"] += 1
            state["messages"].append({"role": "assistant_tool_call", "callId": turn.call_id, "name": turn.name, "arguments": args})
            err = validate_value(catalog[turn.name]["inputSchema"], args)
            execution = catalog[turn.name].get("execution", "frontend")
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
            return {"status": "tool-call", "conversationId": state["cid"], "state": sign_state(state, self._secret), "callId": turn.call_id,
                    "tool": turn.name, "input": args, "toolCalls": state["calls"]}

    def _run_backend_tool(self, name: str, ctx: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
        impl = self._backend_tools.get(name)
        if impl is None:
            return {"status": "unavailable", "tool": name, "reason": "This tool is not configured on the server.", "sources": [], "warnings": []}
        try:
            return impl(ctx, args)
        except AiGatewayError as e:  # embedding / provider 오류: 질문 전체를 실패시키지 않고 이 Tool 만 unavailable 로 알린다
            return {"status": "unavailable", "tool": name, "reason": f"Tool failed ({e.code}).", "sources": [], "warnings": []}
        except Exception:  # noqa: BLE001  (DB 등 내부 오류의 원문은 모델 · 응답에 싣지 않는다)
            log.exception("backend tool %s failed", name)
            return {"status": "unavailable", "tool": name, "reason": "Tool failed (internal error).", "sources": [], "warnings": []}

    @staticmethod
    def _parse_answer(content: str) -> dict[str, Any]:
        try:
            answer = json.loads(content)
        except (ValueError, TypeError):
            raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502) from None
        if validate_value(ANSWER_SCHEMA, answer) is not None:
            raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502)
        # AiAnalystAnswer(TS) 형태로: 비어 있는 period / unit 은 생략한다
        for e in answer["evidence"]:
            for k in ("period", "unit"):
                if e.get(k) is None:
                    e.pop(k, None)
        return answer
