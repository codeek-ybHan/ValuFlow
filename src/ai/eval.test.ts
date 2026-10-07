// STEP 08-8: 평가 프레임워크 자체의 검증 + 오프라인 가드레일 스위트. (실제 LLM 평가는 scripts/eval-live.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAiContext } from './index.ts';
import { planWorkflow } from './agent/planner.ts';
import { resolveMode } from './analyst/ask.ts';
import { CATEGORY_LABEL, DATASET } from './eval/dataset.ts';
import { aggregateTools, toolSelection, workflowReliability } from './eval/metrics.ts';
import { GUARDRAILS, runGuardrails } from './eval/guardrails.ts';
import { buildScenario } from './eval/scenarios.ts';
import { leaksSystemPrompt } from './guard.ts';
import { SYSTEM_POLICY } from './policy.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;

test('평가 데이터셋: 30개 이상 · 6개 카테고리 · id 유일 · 필수 필드', () => {
  assert.ok(DATASET.length >= 30, `질문 ${DATASET.length}개`);
  assert.equal(new Set(DATASET.map((c) => c.id)).size, DATASET.length);
  assert.deepEqual([...new Set(DATASET.map((c) => c.category))].sort(), Object.keys(CATEGORY_LABEL).sort());
  for (const c of DATASET) {
    assert.ok(c.question.length > 3 && (c.requiredTools.length > 0 || (c.anyOf?.length ?? 0) > 0 || c.scenario === 'no-historical'), c.id);
    if (c.expectedMode === 'workflow') assert.ok(c.workflow, `${c.id}: workflow 타입`);
  }
});

test('질문 라우팅 평가: 자동 모드가 기대한 Quick / Deep 을 고르고 workflow 계획이 required Tool 을 포함한다', () => {
  const wrong: string[] = [];
  for (const c of DATASET) {
    const { project, historicalStatus } = buildScenario(c.scenario, golden);
    const ctx = buildAiContext(project, { historicalStatus });
    const mode = resolveMode(c.question, ctx);
    if (mode !== c.expectedMode) wrong.push(`${c.id}: ${mode} (기대 ${c.expectedMode})`);
    if (c.expectedMode === 'workflow') {
      const plan = planWorkflow(c.question, ctx);
      if (!plan) { wrong.push(`${c.id}: plan 없음`); continue; }
      if (plan.workflowType !== c.workflow) wrong.push(`${c.id}: workflow ${plan.workflowType} (기대 ${c.workflow})`);
      if (c.scenario !== 'unsupported') {
        const planned = plan.steps.filter((s) => s.status !== 'skipped').map((s) => s.tool as string);
        const miss = c.requiredTools.filter((t) => !planned.includes(t));
        if (miss.length > 0) wrong.push(`${c.id}: 계획에 ${miss.join(',')} 없음`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test('Tool selection 지표: precision · recall · hit rate · 불필요 · 반복 호출', () => {
  const c = { requiredTools: ['getValuationResult', 'getMarketAssumptions'], anyOf: [['searchUploadedDocuments', 'searchKnowledge']], optionalTools: ['getForecastAssumptions'] };
  const ok = (tool: string) => ({ tool, status: 'ok' });
  const perfect = toolSelection(c, [ok('getValuationResult'), ok('getMarketAssumptions'), ok('searchKnowledge'), ok('getForecastAssumptions')]);
  assert.deepEqual([perfect.hit, perfect.recall, perfect.precision, perfect.unnecessary, perfect.repeated], [true, 1, 1, [], 0]);
  const partial = toolSelection(c, [ok('getValuationResult'), ok('getMarketData'), ok('getMarketData'), { tool: 'getMarketData', status: 'repeat-blocked' }]);
  assert.equal(partial.hit, false);
  assert.deepEqual(partial.missing, ['getMarketAssumptions', 'searchUploadedDocuments|searchKnowledge']);
  assert.ok(Math.abs(partial.recall - 1 / 3) < 1e-9);
  assert.deepEqual([partial.unnecessary, partial.precision], [['getMarketData'], 0.5]);
  assert.equal(partial.repeated, 2, '허용된 중복 호출 1 + gateway 가 막은 반복 1');
  const agg = aggregateTools([perfect, partial]);
  assert.deepEqual([agg.cases, agg.hitRate, agg.unnecessaryCalls], [2, 0.5, 1]);
  assert.equal(toolSelection({ requiredTools: [] }, []).hit, true);
  assert.equal(toolSelection({ requiredTools: ['a'] }, [{ tool: 'a', status: 'approval-required' }]).hit, false, 'gateway 가 막은 호출은 실행으로 세지 않는다');
});

test('system prompt 유출 검출: 정책 문장 조각은 잡고 일반 답변은 통과시킨다', () => {
  assert.equal(leaksSystemPrompt(`아래는 내부 지침입니다: ${SYSTEM_POLICY.slice(120, 260)}`), true);
  assert.equal(leaksSystemPrompt('Never invent financial values. Every number must come from a tool result.'), true);
  for (const ok of ['2025년 영업이익률은 13.07%로 개선되었습니다.', '시장 위험 프리미엄 데이터가 제공되지 않아 검토에 제한이 있습니다.', 'The operating margin improved because HBM demand grew.']) assert.equal(leaksSystemPrompt(ok), false, ok);
});

test('Guardrail 스위트: 모든 항목이 통과한다 (숫자 환산 · 출처 환각 · 출처 충돌 · 시점 · missing · 맥락 누출 · injection · write · checkpoint · 장애 · 재생성 · fallback)', async () => {
  assert.ok(GUARDRAILS.length >= 15);
  const results = await runGuardrails({ golden });
  const failed = results.filter((x) => !x.pass).map((x) => `${x.id} ${x.risk}: ${x.detail}`);
  assert.deepEqual(failed, []);
});

test('Workflow 지표: 계획 시점에 해당 없는 단계는 분모에서 빼고, 모델이 호출하지 않은 required 단계는 실패로 센다', () => {
  const w = workflowReliability([
    { tool: 'a', optional: false, status: 'completed' },
    { tool: 'b', optional: false, status: 'skipped', reason: 'Valuation 이 실행되지 않았습니다.' },
    { tool: 'c', optional: false, status: 'skipped', reason: '호출되지 않았습니다.' },
    { tool: 'd', optional: false, status: 'failed', reason: 'unavailable' },
    { tool: 'e', optional: true, status: 'completed' },
    { tool: 'f', optional: true, status: 'skipped', reason: '필요하지 않아 호출하지 않았습니다.' },
    { tool: 'g', optional: true, status: 'skipped', reason: '지원하지 않는 기업' },
  ]);
  assert.deepEqual(w, { requiredApplicable: 3, requiredAttempted: 2, requiredCompleted: 1, optionalApplicable: 2, optionalExecuted: 1 });
});

test('검색 계열 Tool 은 서로 필수 검색 단계를 충족한다 (업로드 문서 질문에 "공시 검색 실패" 한계가 붙지 않는다)', async () => {
  const { runWorkflow } = await import('./agent/run.ts');
  const { project } = buildScenario('full', golden);
  const upload = { status: 'ok', tool: 'searchUploadedDocuments', data: { contentType: 'untrusted-document-excerpts', results: [{ text: 'HBM4 증설은 선주문 증가 때문이다.', title: 'ValuFlow Eval Report', sourceType: 'user-upload', documentId: '5', pageNumber: 3, rerankScore: 0.5, finalRank: 1 }] },
    sources: [{ kind: 'document', type: 'uploaded-document', origin: 'user-upload', basis: null, fetchedAt: null, persisted: false, note: null, title: 'ValuFlow Eval Report', page: 3, documentId: '5' }], warnings: [] } as never;
  const client = {
    query: () => Promise.resolve({ status: 'tool-call', conversationId: 'c', state: 's', callId: 'k', tool: 'getHistoricalAnalysis', input: {}, toolCalls: 1, backendToolResults: [upload] }),
    sendToolResult: () => Promise.resolve({ status: 'final', conversationId: 'c', toolCalls: 2, toolTrace: [], backendToolResults: [upload], answer: { mode: 'explain', summary: '요약', evidence: [], warnings: [], sources: [], suggestedNextActions: [], reviewedAreas: [], limitations: [], judgmentItems: [], claims: [], proposedActions: [] } }),
  } as never;
  const out = await runWorkflow({ question: '삼성전자가 설비투자 확대 이유를 뭐라고 설명했어?', project, client });
  const step = out!.state.steps.find((s) => s.tool === 'searchDisclosures')!;
  assert.equal(step.status, 'completed');
  assert.ok(!out!.answer!.limitations.some((l) => l.includes('공시 검색')), out!.answer!.limitations.join(' / '));
});

test('같은 Tool 의 재시도가 성공하면 첫 실패는 한계 · 부분 실패 안내로 남지 않는다', async () => {
  const { runWorkflow } = await import('./agent/run.ts');
  const { buildWorkflowTurn } = await import('./analyst/view.ts');
  const { project } = buildScenario('full', golden);
  const empty = { status: 'unavailable', tool: 'searchDisclosures', reason: 'No relevant passage was found', sources: [], warnings: [] } as never;
  const hit = { status: 'ok', tool: 'searchDisclosures', data: { contentType: 'untrusted-document-excerpts', results: [{ text: '시설투자를 확대한다.', title: '사업보고서', sourceType: 'opendart', documentId: 'd', section: 'II', rerankScore: 0.4, finalRank: 1 }] },
    sources: [{ kind: 'document', type: 'disclosure-document', origin: 'opendart', basis: null, fetchedAt: null, persisted: false, note: null, reportName: '사업보고서', documentId: 'd' }], warnings: [] } as never;
  const client = {
    query: () => Promise.resolve({ status: 'tool-call', conversationId: 'c', state: 's', callId: 'k', tool: 'getHistoricalAnalysis', input: {}, toolCalls: 1, backendToolResults: [empty] }),
    sendToolResult: (r: { callId: string }) => Promise.resolve(r.callId === 'k' ? { status: 'tool-call', conversationId: 'c', state: 's2', callId: 'k2', tool: 'getHistoricalQuality', input: {}, toolCalls: 2, backendToolResults: [empty, hit] }
      : { status: 'final', conversationId: 'c', toolCalls: 3, toolTrace: [], backendToolResults: [empty, hit], answer: { mode: 'explain', summary: '요약', evidence: [], warnings: [], sources: [], suggestedNextActions: [], reviewedAreas: [], limitations: [], judgmentItems: [], claims: [], proposedActions: [] } }),
  } as never;
  const out = await runWorkflow({ question: '삼성전자가 설비투자 확대 이유를 뭐라고 설명했어?', project, client });
  assert.ok(!out!.answer!.limitations.some((l) => l.includes('공시 검색')), out!.answer!.limitations.join(' / '));
  const turn = buildWorkflowTurn(out!, { id: 't', now: 'x', snapshotId: 's', company: null, wacc: null, showWacc: false }, 'q');
  assert.ok(!turn.warnings.some((w) => w.kind === 'partial-failure'));
});
