"""외부 provider 오류. kind 는 Tool 상태(status)가 된다: unavailable(호출 실패) · no-data(데이터 없음) · rate-limit(호출 한도).
message 는 정제된 문구이며 provider 원문 오류 · URL · Key 를 담지 않는다."""
from __future__ import annotations

KINDS = ("unavailable", "no-data", "rate-limit")


class ProviderError(Exception):
    def __init__(self, kind: str, message: str):
        assert kind in KINDS
        super().__init__(message)
        self.kind, self.message = kind, message
