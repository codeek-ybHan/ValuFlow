// AI 디버깅용 audit event. 이번 단계에서는 타입과 생성 함수만 두고 저장은 하지 않는다.
import type { ToolResult } from './tools/result.ts';
import type { AiAnalystAnswer, AnswerViolation } from './answer.ts';
import type { QuestionClassification } from './capabilities.ts';

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

// ---- STEP 08-2: 질문 한 건의 audit event (메모리 / 개발 logging 용, DB 저장 없음) ----

export type AiFinalStatus = 'answered' | 'answered-with-corrections' | 'tool-limit' | 'error';

/** API Key · Raw payload · Tool 결과 본문 · 공시 chunk 본문 · embedding 은 기록하지 않는다: Tool 이름, 출처 라벨, 경고 문구, 문서 식별자만 남긴다. */
export interface AiQueryAuditEvent extends AiAuditEvent {
  conversationId: string | null;
  classification: { mode: QuestionClassification['mode']; capabilities: string[]; matched: boolean; suggestedTools: string[] };
  toolsRequested: string[];
  toolsExecuted: { tool: string; status: string }[];
  /** Tool 별 실행 위치 (frontend: deterministic ValuFlow Tool · backend: 공시 검색 등 외부 Retrieval Tool) */
  toolRuntimes: { tool: string; runtime: string }[];
  /** 공시 문서 출처: `접수번호 | section` (본문은 기록하지 않는다) */
  documentSources: string[];
  /** 검색된 공시 문서의 접수번호 */
  retrievedDocumentIds: string[];
  finalStatus: AiFinalStatus;
  /** 모델 답변에서 감지한 가드레일 위반 코드 */
  violations: AnswerViolation['code'][];
  /** 결정적으로 보정한 항목 (예: warnings-restored, sources-merged) */
  corrections: string[];
  errorCode: string | null;
}
