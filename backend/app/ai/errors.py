"""AI Gateway 오류. message 는 항상 정제된 문구이며 API Key · 모델 원문 오류 · 내부 payload 를 담지 않는다."""
from __future__ import annotations


class AiGatewayError(Exception):
    def __init__(self, code: str, message: str, status: int = 502):
        self.code = code
        self.message = message
        self.status = status
        super().__init__(message)


MESSAGES = {
    "ai-not-configured": "AI Analyst 가 설정되어 있지 않습니다. 서버에 OPENAI_API_KEY 를 설정하세요.",
    "provider-error": "AI 서비스를 호출하지 못했습니다. 잠시 후 다시 시도하세요.",
    "provider-rate-limit": "AI 서비스 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
    "invalid-model-output": "모델 응답을 해석할 수 없습니다 (구조화된 답변 형식 위반).",
    "unknown-tool": "모델이 허용되지 않은 Tool 을 요청했습니다.",
    "invalid-state": "대화 상태가 올바르지 않습니다.",
    "state-expired": "대화가 만료되었습니다. 질문을 다시 시작하세요.",
    "invalid-tool-result": "Tool 결과 형식이 올바르지 않습니다.",
    "tool-result-too-large": "Tool 결과가 너무 큽니다.",
    "conversation-too-large": "대화가 너무 길어졌습니다.",
}
