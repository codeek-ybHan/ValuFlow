"""LLM provider 추상화. 특정 SDK 가 application logic 에 퍼지지 않도록 gateway 는 이 interface 만 안다.

대화는 provider 중립 형식으로 보관한다:
  {"role": "system" | "user", "content": str}
  {"role": "assistant_tool_call", "callId": str, "name": str, "arguments": dict}
  {"role": "tool_result", "callId": str, "content": str(JSON)}
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from app.ai.errors import AiGatewayError, MESSAGES


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class ModelTurn:
    """모델의 한 번의 응답: Tool 요청(tool_call) 또는 최종 답변(final, content 는 JSON 문자열)."""
    kind: str  # "tool_call" | "final"
    call_id: str = ""
    name: str = ""
    arguments: dict[str, Any] | None = None
    content: str = ""


class AiModelProvider(Protocol):
    def create_response(self, messages: list[dict[str, Any]], tools: list[ToolSpec], answer_schema: dict[str, Any]) -> ModelTurn: ...


def _to_openai_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m["role"]
        if role in ("system", "user"):
            out.append({"role": role, "content": m["content"]})
        elif role == "assistant_tool_call":
            out.append({"role": "assistant", "content": None, "tool_calls": [{"id": m["callId"], "type": "function", "function": {"name": m["name"], "arguments": json.dumps(m["arguments"], ensure_ascii=False)}}]})
        elif role == "tool_result":
            out.append({"role": "tool", "tool_call_id": m["callId"], "content": m["content"]})
    return out


class OpenAiProvider:
    """OpenAI Chat Completions (Tool Calling + structured output). Key 는 Authorization 헤더로만 쓰고 오류 · 로그에 남기지 않는다."""

    def __init__(self, api_key: str, model: str = "gpt-4.1-mini", base_url: str = "https://api.openai.com/v1", client: httpx.Client | None = None, timeout: float = 60.0):
        self._key = api_key
        self._model = model
        self._base = base_url.rstrip("/")
        self._http = client or httpx.Client(timeout=timeout)

    def create_response(self, messages: list[dict[str, Any]], tools: list[ToolSpec], answer_schema: dict[str, Any]) -> ModelTurn:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": _to_openai_messages(messages),
            "response_format": {"type": "json_schema", "json_schema": {"name": "ai_analyst_answer", "strict": True, "schema": answer_schema}},
        }
        if tools:   # Tool 이 없으면(교정 재생성) tools / tool_choice 를 보내지 않는다
            payload["tools"] = [{"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}} for t in tools]
            payload["tool_choice"] = "auto"
            payload["parallel_tool_calls"] = False  # 한 번에 하나의 Tool 만 요청한다 (frontend 가 순서대로 실행)
        res = None
        for attempt in range(2):   # 일시적인 timeout · 5xx 는 한 번만 다시 시도한다 (4xx · 429 는 재시도하지 않는다)
            try:
                res = self._http.post(f"{self._base}/chat/completions", json=payload, headers={"Authorization": f"Bearer {self._key}"})
            except httpx.HTTPError:
                if attempt == 0:
                    continue
                raise AiGatewayError("provider-error", MESSAGES["provider-error"], 502) from None
            if res.status_code in (500, 502, 503, 504) and attempt == 0:
                continue
            break
        assert res is not None
        if res.status_code == 429:
            raise AiGatewayError("provider-rate-limit", MESSAGES["provider-rate-limit"], 429)
        if res.status_code >= 400:
            raise AiGatewayError("provider-error", MESSAGES["provider-error"], 502)  # 401 / 5xx 등: 원문을 노출하지 않는다
        try:
            choice = res.json()["choices"][0]
            msg = choice["message"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502) from None
        calls = msg.get("tool_calls") or []
        if calls:
            fn = calls[0].get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except ValueError:
                raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502) from None
            if not isinstance(args, dict):
                raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502)
            return ModelTurn(kind="tool_call", call_id=str(calls[0].get("id") or ""), name=str(fn.get("name") or ""), arguments=args)
        content = msg.get("content")
        if msg.get("refusal") or not isinstance(content, str) or choice.get("finish_reason") == "length":
            raise AiGatewayError("invalid-model-output", MESSAGES["invalid-model-output"], 502)
        return ModelTurn(kind="final", content=content)
