// STEP 08-6 Grounding acceptance: 대표 live 질문 4개를 실제 LLM 으로 실행하고 first-pass / 재생성 / fallback 과 최종 답변의 grounding 지표를 기록한다.
//   backend 를 띄운 뒤:  node scripts/agent-acceptance.ts [baseUrl] [repeat]
// 완료 기준(최종 답변): unsupported 숫자 claim 0 · hallucinated source 0 · 잘못된 단위 환산 0 · unsupported company 이전 맥락 누출 0 · WACC 구성요소 의미 오류 0.
// coverage 는 모든 문장이 아니라 핵심 claim 기준이다. 실제 LLM 호출이라 결과는 매번 조금 다르다 (repeat 로 여러 번 돌려 본다).
import { readFileSync } from 'node:fs';
import { BackendAiClient, extractEvidence, groundAnalysis, runWorkflow, sourceKey, toAnswerSource, validateProposal, type WorkflowOutcome } from '../src/ai/index.ts';
import { emptyProjectState, withHistoricalLoaded, withPracticeAssumptions, withRelativeInputs, withSelectedCompany } from '../src/store/projectModel.ts';
import type { Proposal } from '../src/ai/grounding/wacc.ts';

const root = new URL('..', import.meta.url).pathname;
const g = JSON.parse(readFileSync(`${root}backend/tests/golden/samsung.json`, 'utf8')).expected;
const base = withSelectedCompany(emptyProjectState, { corpCode: '00126380', corpName: '삼성전자', corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: 'live' });
const project = withRelativeInputs(withPracticeAssumptions(withHistoricalLoaded(base, { data: g.data, quality: g.quality, provenance: { source: 'database', persisted: true, fetchedAt: 'live', fetchId: '1', corpCode: '00126380', fiscalYears: [2023, 2024, 2025] } })), { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 });
const client = new BackendAiClient({ baseUrl: process.argv[2] ?? 'http://127.0.0.1:8000' });
const repeat = Number(process.argv[3] ?? 1);

const QUESTIONS = ['삼성전자 최근 영업이익률을 분석해줘.', '현재 삼성전자 WACC 가정을 검토해줘.', '삼성전자가 설비투자 확대 이유를 뭐라고 설명했어?', '최근 실적과 시장 상황을 같이 고려해서 valuation risk를 정리해줘.'];
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '-' : x.toFixed(2));

/** 최종 답변을 독립적으로 다시 검증한다 (audit 의 값이 아니라 실제 전달되는 답변 기준). */
function finalCheck(out: WorkflowOutcome) {
  const a = out.answer!;
  const index = extractEvidence(out.results);
  const re = groundAnalysis({ summary: a.summary, claims: a.claims.map((c) => ({ claimId: c.claimId, text: c.text, type: c.type, evidenceRefs: c.evidenceIds.map((id) => ({ tool: index.byId.get(id)?.tool ?? '', fieldPath: index.byId.get(id)?.fieldPath ?? null })) })), proposedActions: [], index });
  const nums = [...re.claims.flatMap((c) => c.numbers), ...re.report.summaryNumbers];
  const toolSources = new Set(out.results.flatMap((r) => r.sources).map((s) => sourceKey(toAnswerSource(s))));
  const proposalErrors = a.proposedActions.filter((p) => { const c = validateProposal(p as Proposal, index); return !c.ok || !!c.retyped; }).length;
  return {
    unsupportedNumericalClaims: re.claims.filter((c) => c.numbers.some((n) => n.status === 'ungrounded')).length,
    ungroundedNumbers: nums.filter((n) => n.status === 'ungrounded').length,
    unitConversionErrors: nums.filter((n) => n.unitSlip).length,
    hallucinatedSources: a.sources.filter((s) => !toolSources.has(sourceKey(s))).length,
    waccSemanticErrors: proposalErrors,
    unsupportedClaims: a.claims.filter((c) => c.status === 'unsupported').length,
    coverage: a.claims.length ? a.claims.filter((c) => c.status === 'supported').length / a.claims.length : null,
    claims: a.claims.length,
  };
}

const rows: Record<string, unknown>[] = [];
const only = (process.env.ONLY ?? '').split(',').filter(Boolean).map(Number);
for (const [qi, q] of QUESTIONS.entries()) for (let i = 0; i < (only.length === 0 || only.includes(qi) ? repeat : 0); i++) {
  const t = Date.now();
  const out = await runWorkflow({ question: q, project, client });
  if (!out || !out.answer || !out.audit.grounding) { rows.push({ q, error: out?.error?.code ?? 'no-answer', status: out?.state.status }); console.log(`\nQ: ${q}\n  FAILED ${out?.error?.code ?? out?.state.status}`); continue; }
  const gr = out.audit.grounding;
  const fin = finalCheck(out);
  const row = {
    q, run: i + 1, workflow: out.plan.workflowType, status: out.state.status, sec: Math.round((Date.now() - t) / 1000), tools: out.state.toolsExecuted.map((x) => x.tool).join('>'),
    first: { issues: gr.firstPass.issueCounts, claims: gr.firstPass.claims, coverage: pct(gr.firstPass.coverage), unsupported: gr.firstPass.unsupported, ungroundedNumbers: gr.firstPass.unsupportedNumbers, unitSlips: gr.firstPass.unitSlips, blocking: gr.firstPass.blocking.join(',') || '-' },
    regenerated: gr.regenerated, after: gr.afterRegeneration ? { issues: gr.afterRegeneration.issueCounts, claims: gr.afterRegeneration.claims, coverage: pct(gr.afterRegeneration.coverage), unsupported: gr.afterRegeneration.unsupported, ungroundedNumbers: gr.afterRegeneration.unsupportedNumbers, blocking: gr.afterRegeneration.blocking.join(',') || '-' } : null,
    invalidRefs: out.answer.claims.flatMap((c) => c.invalidRefs ?? []), finalIssues: out.answer.claims.flatMap((c) => c.issues).reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}), fallback: gr.fallbackUsed, hallucinatedFirstPass: gr.hallucinatedSources, final: fin,
    proposals: out.answer.proposedActions.map((p) => p.type).join(',') || '-', proposalFiltered: out.corrections.includes('proposals-filtered'), checkpoints: out.state.checkpoints.length,
  };
  rows.push(row);
  console.log(`\nQ: ${q} (run ${i + 1})\n  ${JSON.stringify(row)}`);
}

// unsupported company: 이전 회사(삼성전자)의 맥락 · 숫자가 섞이지 않는지 (LLM 없음)
const naver = withSelectedCompany(project, { corpCode: '00266961', corpName: 'NAVER', corpNameEng: null, stockCode: '035420', corpClass: 'Y', source: 'OpenDART', fetchedAt: 'live' });
const un = await runWorkflow({ question: '삼성전자 Valuation 전체 검토해줘.', project: naver, client: { query: () => { throw new Error('LLM must not be called'); }, sendToolResult: () => { throw new Error('unused'); } }, historicalStatus: { kind: 'failed', refresh: false, failure: { kind: 'unsupported', code: 'unsupported-structure', message: '성격별 비용 손익계산서', quality: null } } });
const leak = JSON.stringify([un?.answer, un?.results]).match(/333605938|2\\.54|13\\.07|8\\.14|삼성전자 학습/g) ?? [];
console.log(`\nunsupported-company leak: ${leak.length} (status ${un?.state.status}, tools ${un?.state.toolsExecuted.map((t) => t.tool).join(',')})`);

const done = rows.filter((r) => r.final) as { final: ReturnType<typeof finalCheck> }[];
const sum = (k: keyof ReturnType<typeof finalCheck>) => done.reduce((s, r) => s + (Number(r.final[k]) || 0), 0);
console.log(`\nACCEPTANCE (최종 답변, ${done.length}/${rows.length} runs): unsupported 숫자 claim=${sum('unsupportedNumericalClaims')} · ungrounded 숫자=${sum('ungroundedNumbers')} · hallucinated source=${sum('hallucinatedSources')} · 단위 환산 오류=${sum('unitConversionErrors')} · WACC 의미 오류=${sum('waccSemanticErrors')} · 이전 맥락 누출=${leak.length}`);
console.log(`first-pass blocking runs: ${rows.filter((r) => (r.first as { blocking: string } | undefined)?.blocking !== '-' && r.first).length} · regenerated: ${rows.filter((r) => r.regenerated).length} · fallback: ${rows.filter((r) => r.fallback).length}`);
