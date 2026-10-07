// Grounding 적용 + 교정 재생성(1회) + safe fallback.
//   1) enforceGrounding(출처 · 경고 · 실패한 Tool 근거 보정) → 2) groundAnalysis(claim ↔ evidence 검증)
//   3) 막아야 할 위반(blocking)이 있으면 위반 목록 + 사용 가능한 근거만 backend 에 보내 1회 재생성 (Tool 결과 원문 전체는 보내지 않는다)
//   4) 그래도 위반이면: 근거 없는 claim · 숫자를 제거하고 검증된 claim 만으로 fallback answer 를 만든다.
import { enforceGrounding, toAnswerSource, type AnswerViolation } from '../answer.ts';
import type { AiAnalystAnswer } from '../answer.ts';
import type { AiGatewayClient } from '../client.ts';
import type { ToolResult } from '../tools/result.ts';
import type { CheckpointKind, WorkflowAnswer } from '../agent/types.ts';
import { extractEvidence, groundAnalysis, type EvidenceIndex, type GroundOutput } from './verify.ts';
import { matchesValue, parseNumbers } from './numbers.ts';
import { formatFinancialValue, formatPercent, isAmountUnit, normalizeDisplayUnit } from '../tools/display.ts';
import type { Evidence, GroundedClaim, GroundingAuditEvent, GroundingIssue, GroundingPassMetrics, GroundingReport } from './types.ts';
import type { Proposal } from './wacc.ts';

const MAX_REGEN_EVIDENCE = 120;

/** 모델이 만든 workflow 답변(검증 전). claims 의 모양은 RawClaim 이거나 예전 {claim, tools} 다. */
export type RawWorkflowAnswer = AiAnalystAnswer & Partial<Omit<WorkflowAnswer, keyof AiAnalystAnswer | 'claims'>> & { claims?: unknown[] };

export interface RepairOutcome {
  answer: AiAnalystAnswer;
  claims: GroundedClaim[];
  proposals: Proposal[];
  report: GroundingReport;
  violations: AnswerViolation[];
  corrections: string[];
  regenerated: boolean;
  fallbackUsed: boolean;
  extraLimitations: string[];
  audit: GroundingAuditEvent;
}

interface Pass { g: ReturnType<typeof enforceGrounding>; out: GroundOutput; raw: RawWorkflowAnswer; hallucinated: number }

function runPass(raw: RawWorkflowAnswer, results: ToolResult<unknown>[], index: EvidenceIndex, unsupported: boolean): Pass {
  const g = enforceGrounding(raw, results, { unsupported });
  const toolSources = results.flatMap((r) => r.sources).map(toAnswerSource);

  // 모델이 지어낸 출처: Tool 출처 중 같은 종류(type · origin)가 없거나, 문서 · 제목 · 보고서명이 어느 Tool 출처와도 맞지 않는 것 (표기만 다른 출처는 enforceGrounding 이 Tool 출처로 바꾼다)
  const hallucinated = (raw.sources ?? []).filter((s) => !toolSources.some((t) => t.type === s.type && t.origin === s.origin
    && [['documentId'], ['title'], ['reportName'], ['url']].every(([k]) => { const v = (s as unknown as Record<string, unknown>)[k]; return v == null || (t as unknown as Record<string, unknown>)[k] === v; }))).length;
  const out = groundAnalysis({ summary: g.answer.summary, claims: raw.claims ?? [], proposedActions: (raw.proposedActions ?? []) as Proposal[], index });
  return { g, out, raw, hallucinated };
}

const blockingOf = (p: Pass): GroundingIssue[] => p.out.issues.filter((i) => i.blocking);

function metricsOf(p: Pass): GroundingPassMetrics {
  const r = p.out.report;
  const nums = [...r.claims.flatMap((c) => c.numbers), ...r.summaryNumbers];
  return { claims: r.stats.claims, supported: r.stats.supported, unsupported: r.stats.unsupported, coverage: r.coverage, unsupportedNumbers: r.stats.numbersUngrounded, unitSlips: nums.filter((n) => n.unitSlip).length, blocking: blockingOf(p).map((i) => i.code), issueCounts: r.claims.flatMap((c) => c.issues).reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}) };
}

/** 재생성 요청에 붙이는 표시용 문자열: display.ts 의 deterministic 환산을 쓴다 (모델이 단위를 직접 환산하다 틀리지 않게: KRW million 37,792,969 = 377,930억원 = 37.79조원). */
function displayHints(e: Evidence): Record<string, string> | undefined {
  if (typeof e.value !== 'number') return undefined;
  const du = normalizeDisplayUnit(e.unit);
  if (isAmountUnit(du)) return { 억원: formatFinancialValue(e.value, e.unit, 'eok')!, 조원: formatFinancialValue(e.value, e.unit, 'jo')! };
  if (du === 'ratio') return { percent: formatPercent(e.value) };
  return undefined;
}

function evidenceForRegeneration(p: Pass, index: EvidenceIndex): Record<string, unknown>[] {
  const ids = new Set([...p.out.report.evidenceMap.map((e) => e.evidenceId)]);
  const rest = index.list.filter((e) => !ids.has(e.evidenceId) && !e.missing && typeof e.value === 'number' && !e.fieldPath?.includes('fcff'));
  const chosen = [...index.list.filter((e) => ids.has(e.evidenceId)), ...rest].slice(0, MAX_REGEN_EVIDENCE);
  return chosen.map((e: Evidence) => ({ evidenceId: e.evidenceId, tool: e.tool, fieldPath: e.fieldPath, value: e.missing ? null : (typeof e.value === 'number' || typeof e.value === 'string' ? e.value : null), unit: e.unit, period: e.period, asOf: e.asOf, sourceLabel: e.sourceLabel, sourceType: e.sourceType, display: displayHints(e), excerpt: e.excerpt === undefined ? undefined : (index.texts.get(e.evidenceId) ?? e.excerpt).slice(0, 600) }));
}

/** 검증된 claim 만으로 만드는 fallback 요약. */
function fallbackSummary(claims: GroundedClaim[]): string {
  const keep = claims.filter((c) => c.status !== 'unsupported');
  const facts = keep.filter((c) => c.basis === 'objective').map((c) => c.text);
  const judg = keep.filter((c) => c.basis === 'judgment').map((c) => `${c.text} (해석)`);
  const body = [...facts, ...judg].slice(0, 6).map((t) => t.trim().replace(/[.。]?$/, '.')).join(' ');
  return body ? `근거가 확인된 내용만 정리합니다. ${body}` : '근거가 확인된 내용이 없어 분석 결과를 제공하지 못했습니다.';
}

export async function groundWithRepair(args: { question: string; raw: RawWorkflowAnswer; results: ToolResult<unknown>[]; unsupported: boolean; client?: AiGatewayClient }): Promise<RepairOutcome> {
  const index = extractEvidence(args.results);
  const violations: AnswerViolation[] = [];
  const corrections: string[] = [];
  let pass = runPass(args.raw, args.results, index, args.unsupported);
  const firstPass = metricsOf(pass);
  let afterRegeneration: GroundingPassMetrics | null = null;
  violations.push(...pass.g.violations);
  corrections.push(...pass.g.corrections);
  for (const i of pass.out.issues) violations.push({ code: i.code as AnswerViolation['code'], detail: `${i.target}: ${i.detail}` });
  for (let i = 0; i < pass.hallucinated; i++) violations.push({ code: 'hallucinated-source', detail: 'answer cites a source that no tool result provided' });
  const firstHallucinated = pass.hallucinated;

  let regenerated = false;
  let fallbackUsed = false;
  if (blockingOf(pass).length > 0 && args.client?.regenerate) {
    try {
      const res = await args.client.regenerate({
        question: args.question, answer: pass.raw as unknown as Record<string, unknown>,
        issues: blockingOf(pass).slice(0, 30).map((i) => ({ target: i.target, code: i.code, detail: i.detail })), evidence: evidenceForRegeneration(pass, index),
      });
      const next = runPass(res.answer as RawWorkflowAnswer, args.results, index, args.unsupported);
      regenerated = true;
      afterRegeneration = metricsOf(next);
      corrections.push('regenerated');
      if (blockingOf(next).length < blockingOf(pass).length || blockingOf(next).length === 0) pass = next;   // 나아지지 않은 재생성은 쓰지 않는다
    } catch { /* 재생성 실패는 fallback 으로 이어진다 */ }
  }

  let answer: AiAnalystAnswer = pass.g.answer;
  let claims = pass.out.claims;
  let proposals: Proposal[] = pass.out.proposals.filter((c) => c.ok).map((c) => c.proposal);
  const retyped = pass.out.proposals.filter((c) => c.retyped).length;
  if (retyped > 0) corrections.push('proposal-retyped');
  const dropped = pass.out.proposals.filter((c) => !c.ok).length;
  if (dropped > 0) corrections.push('proposals-removed');

  const stillBlocking = blockingOf(pass).filter((i) => !i.target.startsWith('proposal:'));
  if (stillBlocking.length > 0) {
    // safe fallback: 근거 없는 claim · 숫자를 제거하고 검증된 사실만 남긴다
    fallbackUsed = true;
    claims = pass.out.claims.filter((c) => c.status !== 'unsupported');
    const numbersOk = (s: string) => parseNumbers(s).every((n) => index.list.some((e) => !e.missing && typeof e.value === 'number' && matchesValue(n, e.value, e.unit)));
    // 요약 자체에 근거 없는 숫자 · 충돌이 있을 때만 요약을 검증된 claim 으로 다시 쓴다 (claim 하나가 빠진 것만으로 모델의 요약을 버리지 않는다)
    const summaryBlocked = stillBlocking.some((i) => i.target === 'summary');
    answer = { ...answer, summary: summaryBlocked ? fallbackSummary(pass.out.claims) : answer.summary, evidence: answer.evidence.filter((e) => numbersOk(e.value)) };
    corrections.push('fallback-used');
    if (pass.out.claims.some((c) => c.status === 'unsupported')) corrections.push('unsupported-claims-removed');
    if (pass.out.report.stats.numbersUngrounded > 0) corrections.push('ungrounded-numbers-removed');
  } else {
    claims = claims.filter((c) => c.status !== 'unsupported');
  }

  // 충돌(provider vs OpenDART)은 숨기지 않는다: 답변 한계에 남긴다
  const extraLimitations = pass.out.report.contradictions.map((c) => c.note);
  if (fallbackUsed) extraLimitations.push('일부 주장은 Tool 결과에서 근거를 확인하지 못해 제거했습니다.');
  const report: GroundingReport = { ...pass.out.report, claims, hallucinatedSources: firstHallucinated };
  const grounded = claims.filter((c) => c.status === 'supported').length;
  const audit: GroundingAuditEvent = {
    firstPass, afterRegeneration, totalClaims: pass.out.report.stats.claims, groundedClaims: grounded, violations: [...new Set(violations.map((v) => v.code))],
    unsupportedNumbers: pass.out.report.stats.numbersUngrounded, hallucinatedSources: firstHallucinated, contradictions: pass.out.report.contradictions.length,
    corrections: [...new Set(corrections)], fallbackUsed, regenerated, coverage: pass.out.report.stats.claims > 0 ? grounded / pass.out.report.stats.claims : null, evidenceCount: index.list.length,
  };
  return { answer, claims, proposals, report, violations, corrections, regenerated, fallbackUsed, extraLimitations, audit };
}

export type { CheckpointKind };
