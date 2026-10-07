"""허용 Tool 카탈로그와 답변 schema. tool_catalog.json 은 TS(src/ai)에서 내보낸 것이며, backend 는 frontend 가 보낸 schema 를 믿지 않고 이 목록으로 검증한다."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

ANSWER_MODES = ["explain", "compare", "diagnose", "valuation", "source", "quality"]

_NULLABLE_STR = {"type": ["string", "null"]}

# 모델의 최종 답변 형식 (AiAnalystAnswer). OpenAI structured output(strict) 호환: 모든 속성 required, additionalProperties false.
ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["mode", "summary", "evidence", "warnings", "sources", "suggestedNextActions"],
    "properties": {
        "mode": {"type": "string", "enum": ANSWER_MODES},
        "summary": {"type": "string"},
        "evidence": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False, "required": ["label", "value", "period", "unit", "tool"],
                "properties": {"label": {"type": "string"}, "value": {"type": "string"}, "period": _NULLABLE_STR, "unit": _NULLABLE_STR, "tool": {"type": "string"}},
            },
        },
        "warnings": {"type": "array", "items": {"type": "string"}},
        "sources": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["kind", "type", "origin", "basis", "fetchedAt", "corpName", "reportName", "filingDate", "section", "receiptNo", "title", "page", "sourceName", "uploadedAt", "documentId"],
                "properties": {
                    "kind": {"type": "string", "enum": ["actual", "assumption", "calculated", "document"]},
                    "type": {"type": "string", "enum": ["financial-data", "disclosure-document", "uploaded-document"]},
                    "origin": {"type": "string"}, "basis": _NULLABLE_STR, "fetchedAt": _NULLABLE_STR,
                    "corpName": _NULLABLE_STR, "reportName": _NULLABLE_STR, "filingDate": _NULLABLE_STR, "section": _NULLABLE_STR, "receiptNo": _NULLABLE_STR,
                    "title": _NULLABLE_STR, "page": {"type": ["integer", "null"]}, "sourceName": _NULLABLE_STR, "uploadedAt": _NULLABLE_STR, "documentId": _NULLABLE_STR,
                },
            },
        },
        "suggestedNextActions": {"type": "array", "items": {"type": "string"}},
    },
}


@lru_cache(maxsize=1)
def load_catalog() -> dict[str, Any]:
    return json.loads(Path(__file__).with_name("tool_catalog.json").read_text(encoding="utf-8"))


def tool_map() -> dict[str, dict[str, Any]]:
    return {t["name"]: t for t in load_catalog()["tools"]}


_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None)}


def _type_ok(t: str, v: Any) -> bool:
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    return isinstance(v, _TYPES[t]) and not (t != "boolean" and isinstance(v, bool))


def validate_value(schema: dict[str, Any], value: Any, path: str = "$") -> str | None:
    """JSON Schema 부분집합(type · enum · required · properties · items · additionalProperties) 검증. 문제가 없으면 None."""
    t = schema.get("type")
    types = t if isinstance(t, list) else ([t] if t else [])
    if types and not any(_type_ok(x, value) for x in types):
        return f"{path}: expected {'/'.join(types)}"
    if "enum" in schema and value not in schema["enum"]:
        return f"{path}: must be one of {schema['enum']}"
    if isinstance(value, dict) and ("object" in types or "properties" in schema):
        props = schema.get("properties", {})
        for r in schema.get("required", []):
            if r not in value:
                return f"{path}.{r}: required"
        for k, v in value.items():
            if k in props:
                err = validate_value(props[k], v, f"{path}.{k}")
                if err:
                    return err
            elif schema.get("additionalProperties") is False or props:
                return f"{path}.{k}: unknown property"
    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            err = validate_value(schema["items"], item, f"{path}[{i}]")
            if err:
                return err
    return None
