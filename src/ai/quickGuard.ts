// Quick Answer(runAiQuery) 의 요약 숫자 가드레일 (STEP 08-8): claim 구조가 없으므로 문장 단위로 검증한다.
// Tool 결과(엔진 · 문서 · 외부 데이터)에서 찾을 수 없거나, Valuation 지표인데 엔진 값이 아닌 숫자가 든 문장은 제거한다. 모두 제거되면 안전 문구로 바꾼다.
import type { AiAnalystAnswer, AnswerViolation } from './answer.ts';
import type { ToolResult } from './tools/result.ts';
import { extractEvidence } from './grounding/evidence.ts';
import { groundAnalysis } from './grounding/verify.ts';

export const QUICK_NO_GROUNDED_SUMMARY = '근거가 확인된 숫자가 없어 요약을 제공하지 못했습니다. 질문을 더 구체적으로 하거나 Deep Analysis 로 확인하세요.';

export function enforceQuickNumbers(answer: AiAnalystAnswer, results: ToolResult<unknown>[]): { answer: AiAnalystAnswer; violations: AnswerViolation[]; corrections: string[] } {
  const index = extractEvidence(results);
  const ungrounded = (text: string) => groundAnalysis({ summary: text, claims: [], proposedActions: [], index }).report.summaryNumbers.filter((n) => n.status === 'ungrounded').map((n) => n.text);
  // 근거 항목(evidence 행)의 값도 같다: 모델이 직접 계산한 값(예: 하락률 13.6%)은 근거 항목으로 남기지 않는다
  const keptEvidence = answer.evidence.filter((e) => ungrounded(`${e.label}: ${e.value}`).length === 0);
  const evidenceDropped = keptEvidence.length !== answer.evidence.length;
  answer = evidenceDropped ? { ...answer, evidence: keptEvidence } : answer;
  const bad = ungrounded(answer.summary);
  if (bad.length === 0) return evidenceDropped
    ? { answer, violations: [{ code: 'ungrounded-number', detail: 'evidence item with a number that is not in any tool result was removed' }], corrections: ['ungrounded-numbers-removed'] }
    : { answer, violations: [], corrections: [] };
  const sentences = answer.summary.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((s) => !bad.some((b) => s.includes(b)));
  return {
    answer: { ...answer, summary: kept.length > 0 ? kept.join(' ') : QUICK_NO_GROUNDED_SUMMARY },
    violations: bad.map((b) => ({ code: 'ungrounded-text-number' as const, detail: `summary number "${b}" is not found in any tool result` })),
    corrections: ['ungrounded-numbers-removed'],
  };
}
