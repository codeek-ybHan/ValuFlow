// STEP 08-8: 최종 답변 독립 검증. audit 의 값이 아니라 실제로 사용자에게 전달되는 답변을 다시 검증한다 (08-6 acceptance 기준의 자동화).
import { extractEvidence } from '../grounding/evidence.ts';
import { groundAnalysis } from '../grounding/verify.ts';
import { validateProposal, type Proposal } from '../grounding/wacc.ts';
import { sourceKey, toAnswerSource, type AnswerSource } from '../answer.ts';
import type { AiAnalystAnswer } from '../answer.ts';
import type { ToolResult } from '../tools/result.ts';
import type { WorkflowAnswer } from '../agent/types.ts';

export interface FinalCheck {
  unsupportedNumericalClaims: number;
  ungroundedNumbers: number;
  unitConversionErrors: number;
  hallucinatedSources: number;
  waccSemanticErrors: number;
  unsupportedClaims: number;
  coverage: number | null;
  claims: number;
}

export const ZERO: FinalCheck = { unsupportedNumericalClaims: 0, ungroundedNumbers: 0, unitConversionErrors: 0, hallucinatedSources: 0, waccSemanticErrors: 0, unsupportedClaims: 0, coverage: null, claims: 0 };

const hallucinated = (sources: AnswerSource[], results: ToolResult<unknown>[]) => {
  const toolSources = new Set(results.flatMap((r) => r.sources).map((s) => sourceKey(toAnswerSource(s))));
  return sources.filter((s) => !toolSources.has(sourceKey(s))).length;
};

/** Deep Analysis(WorkflowAnswer) 의 최종 답변 검증. */
export function checkWorkflowAnswer(a: WorkflowAnswer, results: ToolResult<unknown>[]): FinalCheck {
  const index = extractEvidence(results);
  const re = groundAnalysis({
    summary: a.summary, proposedActions: [], index,
    claims: a.claims.map((c) => ({ claimId: c.claimId, text: c.text, type: c.type, evidenceRefs: c.evidenceIds.map((id) => ({ tool: index.byId.get(id)?.tool ?? '', fieldPath: index.byId.get(id)?.fieldPath ?? null })) })),
  });
  const nums = [...re.claims.flatMap((c) => c.numbers), ...re.report.summaryNumbers];
  return {
    unsupportedNumericalClaims: re.claims.filter((c) => c.numbers.some((n) => n.status === 'ungrounded')).length,
    ungroundedNumbers: nums.filter((n) => n.status === 'ungrounded').length,
    unitConversionErrors: nums.filter((n) => n.unitSlip).length,
    hallucinatedSources: hallucinated(a.sources, results),
    waccSemanticErrors: a.proposedActions.filter((p) => { const c = validateProposal(p as Proposal, index); return !c.ok || !!c.retyped; }).length,
    unsupportedClaims: a.claims.filter((c) => c.status === 'unsupported').length,
    coverage: a.claims.length ? a.claims.filter((c) => c.status === 'supported').length / a.claims.length : null,
    claims: a.claims.length,
  };
}

/** Quick Answer(AiAnalystAnswer): claim 구조가 없으므로 summary · 근거 항목의 숫자와 출처만 검증한다 (Tool Guardrails 수준). */
export function checkQuickAnswer(a: AiAnalystAnswer, results: ToolResult<unknown>[]): FinalCheck {
  const index = extractEvidence(results);
  // 요약과 근거 항목을 따로 검사한다 (이어 붙이면 앞 문장의 지표 문맥이 다음 항목의 숫자로 넘어가 오탐이 난다)
  const nums = [a.summary, ...a.evidence.map((e) => `${e.label}: ${e.value}`)].flatMap((text) => groundAnalysis({ summary: text, claims: [], proposedActions: [], index }).report.summaryNumbers);
  return { ...ZERO, ungroundedNumbers: nums.filter((n) => n.status === 'ungrounded').length, unitConversionErrors: nums.filter((n) => n.unitSlip).length, hallucinatedSources: hallucinated(a.sources, results) };
}

/** 사용자에게 전달되는 모든 문장 (답변 · 한계 · 근거 · 제안). */
export const answerText = (a: AiAnalystAnswer & Partial<WorkflowAnswer>): string =>
  [a.summary, ...(a.claims ?? []).map((c) => c.text), ...(a.limitations ?? []), ...(a.judgmentItems ?? []), ...a.warnings, ...a.suggestedNextActions, ...a.evidence.map((e) => `${e.label} ${e.value}`), ...(a.proposedActions ?? []).map((p) => `${p.target} ${p.proposedValue ?? ''} ${p.rationale}`)].join('\n');

// ---- prompt injection · system prompt 유출 (production 가드와 같은 검출기를 독립 검증에도 쓴다) ----
export { leaksSystemPrompt } from '../guard.ts';
