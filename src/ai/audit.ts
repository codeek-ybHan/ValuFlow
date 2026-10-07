// AI 디버깅용 audit event. 이번 단계에서는 타입과 생성 함수만 두고 저장은 하지 않는다.
import type { ToolResult } from './tools/result.ts';
import type { AiAnalystAnswer } from './answer.ts';

export interface AiAuditEvent {
  timestamp: string;
  question: string;
  toolUsed: string[];
  sourceUsed: string[];
  warningsIncluded: string[];
}

export function createAuditEvent(question: string, results: ToolResult<unknown>[], answer?: AiAnalystAnswer, now: () => Date = () => new Date()): AiAuditEvent {
  return {
    timestamp: now().toISOString(),
    question,
    toolUsed: [...new Set(results.map((r) => r.tool))],
    sourceUsed: [...new Set(results.flatMap((r) => r.sources).map((s) => `${s.kind}:${s.origin}${s.basis ? `:${s.basis}` : ''}`))],
    warningsIncluded: answer ? [...answer.warnings] : [...new Set(results.flatMap((r) => r.warnings).map((w) => w.text))],
  };
}
