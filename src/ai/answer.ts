// AI 답변 계약. 향후 LLM 답변은 이 구조를 따르고, auditAnswer 로 근거 · 경고 · 출처 누락을 점검한다.
import type { AnswerMode } from './capabilities.ts';
import type { SourceInfo, ToolResult } from './tools/result.ts';
import { UNSUPPORTED_DISCLOSURE } from './policy.ts';

export interface AnswerEvidence {
  label: string;
  /** 문자열로 표기한 값 (Tool 결과의 값을 그대로 인용) */
  value: string;
  period?: string;
  unit?: string;
  /** 이 근거를 준 Tool */
  tool: string;
}

export interface AiAnalystAnswer {
  mode: AnswerMode;
  summary: string;
  evidence: AnswerEvidence[];
  /** 답변에 영향을 주는 DataQuality · 가정 · 지원 범위 경고 */
  warnings: string[];
  sources: Pick<SourceInfo, 'kind' | 'origin' | 'basis' | 'fetchedAt'>[];
  suggestedNextActions: string[];
}

export interface AnswerViolation {
  code: 'unknown-tool' | 'missing-warning' | 'missing-sources' | 'unsupported-not-disclosed' | 'empty-summary';
  detail: string;
}

/** 답변이 Tool 결과에 근거하는지 점검한다 (가드레일). 위반이 없으면 빈 배열. */
export function auditAnswer(answer: AiAnalystAnswer, results: ToolResult<unknown>[]): AnswerViolation[] {
  const v: AnswerViolation[] = [];
  if (answer.summary.trim() === '') v.push({ code: 'empty-summary', detail: 'summary is empty' });
  const executed = new Set(results.map((r) => r.tool));
  for (const e of answer.evidence) if (!executed.has(e.tool)) v.push({ code: 'unknown-tool', detail: `evidence "${e.label}" cites ${e.tool}, which was not called` });
  // review 수준 경고는 답변에 반드시 포함
  const material = [...new Set(results.flatMap((r) => r.warnings).filter((w) => w.level === 'review').map((w) => w.text))];
  for (const text of material) if (!answer.warnings.includes(text)) v.push({ code: 'missing-warning', detail: text });
  if (answer.evidence.length > 0 && answer.sources.length === 0) v.push({ code: 'missing-sources', detail: 'evidence without sources' });
  if (results.some((r) => r.status === 'unsupported') && !answer.summary.includes(UNSUPPORTED_DISCLOSURE)) {
    v.push({ code: 'unsupported-not-disclosed', detail: 'unsupported company must be disclosed in the summary' });
  }
  return v;
}
