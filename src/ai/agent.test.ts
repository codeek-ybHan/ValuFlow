// STEP 08-5: Agent Workflow — 분류 · 계획 · 순차 실행 · 관찰 · 한도 · 부분 실패 · 사람 확인 지점 · 가정 불변 · audit. (mock gateway, 실제 LLM / backend 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TOOL_CATALOG, UNSUPPORTED_DISCLOSURE, buildAiContext, classifyWorkflow, executeTool, observe, operationOf, planWorkflow, resolveCheckpoint, runWorkflow, snapshotId, MAX_WORKFLOW_STEPS, AGENT_MAX_TOOL_CALLS,
  AiClientError, type AiGatewayClient, type AiQueryRequest, type AiRegenerateRequest, type AiToolResultRequest, type GatewayResponse, type ToolResult, type WorkflowAnswer,
} from './index.ts';
import { emptyProjectState, withHistoricalLoaded, withPracticeAssumptions, withRelativeInputs, withSelectedCompany, type ProjectState } from '../store/projectModel.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const AT = '2026-10-07T01:02:03+00:00';
const RELATIVE = { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 };

function liveBase(): ProjectState {
  const s = withSelectedCompany(emptyProjectState, { corpCode: '00126380', corpName: '삼성전자', corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT });
  return withHistoricalLoaded(s, { data: golden.data, quality: golden.quality, provenance: { source: 'database', persisted: true, fetchedAt: AT, fetchId: '7', corpCode: '00126380', fiscalYears: [2023, 2024, 2025] } });
}
const full = () => withRelativeInputs(withPracticeAssumptions(liveBase()), RELATIVE);

type Step = (req: AiQueryRequest | AiToolResultRequest) => GatewayResponse;
class Gateway implements AiGatewayClient {
  queries: AiQueryRequest[] = [];
  toolResults: AiToolResultRequest[] = [];
  private i = 0;
  private readonly steps: Step[];
  private readonly onRound?: () => void;
  constructor(steps: Step[], onRound?: () => void) { this.steps = steps; this.onRound = onRound; }
  private next(r: AiQueryRequest | AiToolResultRequest): Promise<GatewayResponse> {
    this.onRound?.();
    const s = this.steps[this.i++];
    if (!s) throw new AiClientError('provider-error', 'no more scripted steps');
    return Promise.resolve(s(r));
  }
  query(r: AiQueryRequest) { this.queries.push(r); return this.next(r); }
  sendToolResult(r: AiToolResultRequest) { this.toolResults.push(r); return this.next(r); }
}
const ok = (tool: string, data: unknown, sources: ToolResult<unknown>['sources'] = [], warnings: ToolResult<unknown>['warnings'] = []): ToolResult<unknown> => ({ status: 'ok', tool, data, sources, warnings });
const fail = (tool: string, status: 'unavailable' | 'rate-limit' | 'no-data' = 'unavailable', reason = 'provider down'): ToolResult<unknown> => ({ status, tool, reason, sources: [], warnings: [] });
const call = (tool: string, input: Record<string, unknown> = {}, n = 1, backend?: ToolResult<unknown>[]): GatewayResponse => ({ status: 'tool-call', conversationId: 'c1', state: `s${n}`, callId: `k${n}`, tool, input, toolCalls: n, backendToolResults: backend ?? [] });
const done = (answer: Partial<WorkflowAnswer> = {}, backend: ToolResult<unknown>[] = [], trace: { tool: string; runtime: 'frontend' | 'backend' | 'gateway'; status: string }[] = []): GatewayResponse => ({
  status: 'final', conversationId: 'c1', toolCalls: trace.length, toolTrace: trace, backendToolResults: backend,
  answer: { mode: 'explain', summary: '요약', evidence: [], warnings: [], sources: [], suggestedNextActions: [], reviewedAreas: [], limitations: [], judgmentItems: [], claims: [], proposedActions: [], ...answer } as never,
});
const ids = () => { let n = 0; return () => `wf_test${++n}`; };
const clock = () => { let t = Date.parse('2026-10-07T00:00:00Z'); return () => new Date((t += 250)); };
const run = (question: string, project: ProjectState, client: AiGatewayClient, extra: object = {}) => runWorkflow({ question, project, client, now: clock(), newId: ids(), ...extra });
const tools = (p: { steps: { tool: string }[] }) => p.steps.map((s) => s.tool);

test('workflow 분류: 8개 업무를 구분하고 일반 질문 · 민감도 계산 질문은 workflow 가 아니다', () => {
  const cls = (q: string) => classifyWorkflow(q)?.type ?? null;
  assert.equal(cls('삼성전자 최근 실적을 분석해줘.'), 'historical-review');
  assert.equal(cls('삼성전자 최근 영업이익률을 분석해줘.'), 'historical-review');
  assert.equal(cls('삼성전자가 설비투자 확대 이유를 뭐라고 설명했어?'), 'disclosure-review');
  assert.equal(cls('최근 실적과 시장 상황을 같이 고려해서 valuation risk를 정리해줘.'), 'event-review');
  assert.equal(cls('현재 Forecast가 과도한지 봐줘.'), 'forecast-review');
  assert.equal(cls('현재 WACC 8.1% 적절해?'), 'wacc-review');
  assert.equal(cls('현재 삼성전자 WACC 가정을 검토해줘.'), 'wacc-review');
  assert.equal(cls('현재 DCF가 어떤 가정에 가장 민감해?'), 'dcf-review');
  assert.equal(cls('Bull / Bear 시나리오 차이를 검토해줘.'), 'sensitivity-scenario-review');
  assert.equal(cls('DCF와 Peer valuation이 왜 차이나?'), 'comparable-review');
  assert.equal(cls('최근 valuation에 영향을 줄 이벤트가 있어?'), 'event-review');
  assert.equal(cls('최근 이벤트까지 고려해서 주요 valuation risk를 검토해줘.'), 'event-review');
  assert.equal(cls('삼성전자 Valuation 전체 검토해줘.'), 'full-valuation-review');
  for (const q of ['최근 매출 성장률은?', 'WACC가 올라가면 얼마나 영향 있어?', '현재 EV 얼마야?', '안녕']) assert.equal(cls(q), null, q);
});

test('계획: workflow 별 단계 · 순서 · optional · 예산 (Tool 이름과 목적뿐이며 값을 만들지 않는다)', () => {
  const ctx = buildAiContext(full());
  const plan = (q: string) => planWorkflow(q, ctx)!;
  assert.deepEqual(tools(plan('삼성전자 최근 실적을 분석해줘.')), ['getHistoricalAnalysis', 'getHistoricalQuality', 'searchDisclosures']);
  assert.equal(plan('삼성전자 최근 실적을 분석해줘.').steps[2].optional, true);
  assert.deepEqual(tools(plan('현재 Forecast가 과도한지 봐줘.')), ['getForecastAssumptions', 'getHistoricalAnalysis', 'searchKnowledge']);
  assert.deepEqual(tools(plan('현재 WACC 8.1% 적절해?')), ['getForecastAssumptions', 'getValuationResult', 'getMarketAssumptions', 'getComparableCompanies']);
  assert.deepEqual(tools(plan('현재 DCF가 어떤 가정에 가장 민감해?')), ['getValuationResult', 'getForecastAssumptions', 'getSensitivityAnalysis', 'getScenarioAnalysis']);
  assert.deepEqual(tools(plan('DCF와 Peer valuation이 왜 차이나?')), ['getValuationResult', 'getComparableCompanies', 'getRelativeValuation', 'getHistoricalAnalysis']);
  assert.deepEqual(tools(plan('최근 valuation에 영향을 줄 이벤트가 있어?')), ['searchCompanyNews', 'searchDisclosures', 'getValuationResult', 'getForecastAssumptions', 'getHistoricalAnalysis', 'getMarketData']);
  assert.deepEqual(tools(plan('삼성전자가 설비투자 확대 이유를 뭐라고 설명했어?')), ['searchDisclosures', 'getHistoricalAnalysis', 'searchKnowledge']);
  const f = plan('삼성전자 Valuation 전체 검토해줘.');
  assert.ok(f.steps.length >= 10 && f.steps[0].tool === 'getCompanyOverview' && f.steps.some((s) => s.optional) && f.steps.some((s) => !s.optional));
  assert.deepEqual([f.maxToolCalls, f.blocked, f.workflowType], [AGENT_MAX_TOOL_CALLS, null, 'full-valuation-review']);
  assert.equal(planWorkflow('삼성전자 Valuation 전체 검토해줘.', ctx, { maxToolCalls: 7 })!.maxToolCalls, 7, '한도는 설정 가능하다');
  assert.ok(AGENT_MAX_TOOL_CALLS > 5, '일반 질문(5회)보다 크다');
  // 데이터가 없는 단계는 계획에서 skipped + 사유
  const partial = planWorkflow('현재 DCF가 어떤 가정에 가장 민감해?', buildAiContext(liveBase()))!;
  assert.equal(partial.steps.find((s) => s.tool === 'getValuationResult')!.status, 'skipped');
  assert.match(partial.steps.find((s) => s.tool === 'getValuationResult')!.reason!, /Valuation/);
  assert.equal(partial.blocked?.code, 'no-data');
  assert.deepEqual(plan('현재 WACC 8.1% 적절해?').steps.every((s) => s.capability && s.purpose), true);
});

test('순차 실행: 계획 단계가 순서대로 completed 되고 observation 이 backend 로 전달되며 한 workflow 요청에 계획 · 예산이 담긴다', async () => {
  const market = ok('getMarketAssumptions', { applied: false, riskFreeRate: { rate: 0.04286, maturity: '10Y', asOf: '2026-08-01' }, beta: { value: 1.5 } },
    [{ kind: 'external', type: 'market-data', origin: 'fred', basis: null, fetchedAt: AT, persisted: false, note: null, asOf: '2026-08-01' }]);
  const client = new Gateway([
    () => call('getForecastAssumptions', {}, 1), () => call('getValuationResult', {}, 2),
    // backend Tool(getMarketAssumptions)은 gateway 가 실행하고 다음 응답에 결과가 실려 온다
    () => call('getSensitivityAnalysis', {}, 3, [market]),
    () => done({ summary: '현재 가정과 시장 관찰값을 비교했습니다.' }, [market],
      [{ tool: 'getForecastAssumptions', runtime: 'frontend', status: 'ok' }, { tool: 'getValuationResult', runtime: 'frontend', status: 'ok' }, { tool: 'getMarketAssumptions', runtime: 'backend', status: 'ok' }, { tool: 'getSensitivityAnalysis', runtime: 'frontend', status: 'ok' }]),
  ]);
  const out = (await run('현재 삼성전자 WACC 가정을 검토해줘.', full(), client))!;
  const q = client.queries[0];
  assert.equal(q.workflow!.type, 'wacc-review');
  assert.deepEqual(q.workflow!.steps.map((s) => s.tool), ['getForecastAssumptions', 'getValuationResult', 'getMarketAssumptions', 'getComparableCompanies']);
  assert.equal(q.workflow!.maxToolCalls, AGENT_MAX_TOOL_CALLS);
  assert.deepEqual(out.state.toolsExecuted.map((t) => t.tool), ['getForecastAssumptions', 'getValuationResult', 'getMarketAssumptions', 'getSensitivityAnalysis']);
  assert.deepEqual(out.state.steps.map((s) => [s.tool, s.status]), [['getForecastAssumptions', 'completed'], ['getValuationResult', 'completed'], ['getMarketAssumptions', 'completed'], ['getComparableCompanies', 'skipped'], ['getSensitivityAnalysis', 'completed']]);
  assert.equal(out.state.steps[4].dynamic, true);
  assert.equal(out.state.status, 'completed');
  const obs = client.toolResults[1].workflowObservation!;   // getValuationResult 의 observation
  assert.equal(obs.tool, 'getValuationResult');
  assert.ok(obs.findings.some((f) => f.startsWith('wacc:')) && obs.findings.some((f) => f.startsWith('enterpriseValue')));
  assert.ok(!JSON.stringify(obs).includes('fcff'), 'observation 은 결과 전체가 아니다');
  assert.ok(out.state.sources.includes('market-data:fred') && out.state.sources.some((s) => s.startsWith('financial-data:')), out.state.sources.join());
});

test('관찰 기반 다음 단계: 품질 경고 → getMappingTrace, 뉴스의 CAPEX 발표 → searchDisclosures 힌트가 다음 Tool 결과와 함께 전달된다', async () => {
  const qualityBad = observe(ok('getHistoricalQuality', { reviewRequired: [{ field: 'capex' }], dataNotes: [], fields: [] }));
  assert.deepEqual(qualityBad.nextHints.map((h) => h.tool), ['getMappingTrace']);
  assert.deepEqual(observe(ok('getHistoricalQuality', { reviewRequired: [], dataNotes: [] })).nextHints, []);
  const news = ok('searchCompanyNews', { results: [{ title: '삼성전자 평택 라인 CAPEX 확대 발표', publisher: 'X', publishedAt: '2026-10-06T00:00:00+00:00', url: 'https://n/1', snippet: null }] });
  const o = observe(news);
  assert.deepEqual(o.nextHints.map((h) => h.tool), ['searchDisclosures']);
  assert.ok(!JSON.stringify(o).includes('평택'), 'observation 에 기사 제목 · 본문이 없다');
  assert.deepEqual(observe(ok('searchCompanyNews', { results: [{ title: '평범한 소식', publishedAt: '2026-10-06T00:00:00+00:00' }] })).nextHints, []);
  // 뉴스(backend)가 먼저 실행되고, 그 힌트가 다음 frontend Tool 결과의 observation 으로 gateway 에 전달된다
  const client = new Gateway([() => call('getValuationResult', {}, 1, [news]), () => done()]);
  const out = (await run('최근 valuation에 영향을 줄 이벤트가 있어?', full(), client))!;
  assert.deepEqual(client.toolResults[0].workflowObservation!.nextHints.map((h) => h.tool), ['searchDisclosures']);
  assert.ok(out.state.observations.some((x) => x.tool === 'searchCompanyNews'));
  // 계획에 없던 Tool 은 동적 단계로 기록된다
  const dyn = (await run('현재 WACC 8.1% 적절해?', full(), new Gateway([() => call('getMappingTrace', { field: 'revenue' }, 1), () => done()])))!;
  assert.deepEqual(dyn.state.steps.filter((s) => s.dynamic).map((s) => [s.tool, s.status]), [['getMappingTrace', 'completed']]);
});

test('반복 호출 차단 · Tool 호출 한도 · 단계 수 한도', async () => {
  // gateway 가 차단한 반복 호출은 audit 에 남는다 (실행되지 않는다)
  const rep = (await run('현재 WACC 8.1% 적절해?', full(), new Gateway([() => call('getValuationResult', {}, 1), () => done({}, [], [{ tool: 'getValuationResult', runtime: 'frontend', status: 'ok' }, { tool: 'getValuationResult', runtime: 'gateway', status: 'repeat-blocked' }])])))!;
  assert.deepEqual(rep.audit.toolsExecuted, [{ tool: 'getValuationResult', status: 'ok' }, { tool: 'getValuationResult', status: 'repeat-blocked' }]);
  // tool-limit: 부분 결과 + 한도 안내 (사용하지 못한 단계는 한계로 남는다)
  const lim = (await run('현재 WACC 8.1% 적절해?', full(), new Gateway([() => call('getForecastAssumptions', {}, 1), () => ({ status: 'tool-limit', conversationId: 'c1', toolCalls: 2, message: '한도', toolTrace: [], backendToolResults: [] })]), { maxToolCalls: 2 }))!;
  assert.equal(lim.state.status, 'tool-limit');
  assert.equal(lim.audit.status, 'tool-limit');
  assert.ok(lim.answer && lim.answer.limitations.length > 1 && /한도/.test(lim.answer.summary) && lim.answer.reviewedAreas.length === 1);
  assert.equal(lim.state.steps.filter((s) => s.status === 'completed').length, 1);
  // 단계 수 한도: 동적 단계가 MAX_WORKFLOW_STEPS 를 넘으면 안전하게 멈춘다
  const many = Array.from({ length: 6 }, (_, i) => () => call('getMappingTrace', { field: 'revenue', fiscalYear: 2020 + i }, i + 1));
  const stepLimited = (await run('삼성전자 Valuation 전체 검토해줘.', full(), new Gateway([...many, () => done()])))!;
  assert.equal(stepLimited.state.status, 'tool-limit');
  assert.ok(stepLimited.state.steps.length <= MAX_WORKFLOW_STEPS && /단계 수 한도/.test(stepLimited.answer!.summary));
});

test('부분 실패 · no-data: 한 Tool 이 실패해도 제한된 분석을 하고 한계를 남긴다', async () => {
  const newsDown = fail('searchCompanyNews', 'unavailable', 'news provider down');
  const client = new Gateway([() => call('getValuationResult', {}, 1), () => done({ summary: '뉴스를 제외하고 Valuation 맥락을 정리했습니다.', limitations: [] }, [newsDown], [{ tool: 'getValuationResult', runtime: 'frontend', status: 'ok' }, { tool: 'searchCompanyNews', runtime: 'backend', status: 'unavailable' }])]);
  const out = (await run('최근 valuation에 영향을 줄 이벤트가 있어?', full(), client))!;
  assert.equal(out.state.status, 'completed');
  assert.equal(out.state.steps.find((s) => s.tool === 'searchCompanyNews')!.status, 'failed');
  assert.ok(out.answer!.limitations.some((l) => l.includes('뉴스 데이터는 현재 확인하지 못했습니다')), '모델이 빠뜨려도 한계가 복원된다');
  assert.ok(out.corrections.includes('limitations-restored'));
  assert.ok(out.state.observations.find((o) => o.tool === 'searchCompanyNews')!.findings[0].includes('not available'));
  // rate-limit · no-data 도 같은 방식으로 한계가 된다
  for (const status of ['rate-limit', 'no-data'] as const) {
    const o = (await run('최근 valuation에 영향을 줄 이벤트가 있어?', full(), new Gateway([() => done({}, [fail('searchCompanyNews', status)], [{ tool: 'searchCompanyNews', runtime: 'backend', status }])])))!;
    assert.equal(o.state.status, 'completed', status);
    assert.ok(o.answer!.limitations.length >= 1, status);
  }
  // 필요한 데이터가 전혀 없으면 gateway 를 호출하지 않고 failed (값을 만들지 않는다)
  const empty = new Gateway([]);
  const none = (await run('삼성전자 최근 실적을 분석해줘.', emptyProjectState, empty))!;
  assert.equal(none.state.status, 'failed');
  assert.match(none.state.message!, /Historical/);
  assert.equal(empty.queries.length, 0);
  assert.equal(none.answer, null);
});

test('unsupported 기업: workflow 를 실행하지 않고 지원 불가만 알린다 (다른 회사의 값이 섞이지 않는다)', async () => {
  const project = withSelectedCompany(full(), { corpCode: '00266961', corpName: 'NAVER', corpNameEng: null, stockCode: '035420', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT });
  const client = new Gateway([]);
  const out = (await run('삼성전자 Valuation 전체 검토해줘.', project, client, { historicalStatus: { kind: 'failed', refresh: false, failure: { kind: 'unsupported', code: 'unsupported-structure', message: '성격별 비용 손익계산서', quality: null } } }))!;
  assert.equal(client.queries.length, 0, 'LLM · backend 를 호출하지 않는다');
  assert.equal(out.state.status, 'completed');
  assert.equal(out.answer!.summary, UNSUPPORTED_DISCLOSURE);
  assert.deepEqual([out.answer!.evidence, out.answer!.sources, out.answer!.claims], [[], [], []]);
  assert.ok(out.state.steps.every((s) => s.status === 'skipped'));
  assert.deepEqual(out.state.toolsExecuted.map((t) => t.tool), ['getCompanyOverview']);
  assert.ok(!JSON.stringify(out.results).includes('333605938') && out.state.company!.name === 'NAVER');
});

test('immutable context snapshot: workflow 도중 Project State 가 바뀌어도 이 workflow 에는 섞이지 않고 다음 workflow 는 새 snapshot 이다', async () => {
  const project = full();
  const baseline = executeTool('getValuationResult', buildAiContext(project)) as { data: { wacc: number } };
  const before = snapshotId(buildAiContext(project));
  const client = new Gateway([() => call('getForecastAssumptions', {}, 1), () => call('getValuationResult', {}, 2), () => done()], () => {
    (project.valuationAssumptions as { beta: number }).beta = 9.99;   // 진행 중 사용자가 가정을 바꾼 것처럼 원본을 변경한다
  });
  const out = (await run('현재 WACC 8.1% 적절해?', project, client))!;
  const seen = client.toolResults[1].toolResult as { data: { wacc: number } };
  assert.equal(seen.data.wacc, baseline.data.wacc, '시작 시점의 snapshot 값');
  assert.equal(out.state.contextSnapshotId, before);
  const next = (await run('현재 WACC 8.1% 적절해?', project, new Gateway([() => done()])))!;
  assert.notEqual(next.state.contextSnapshotId, before, '다음 workflow 는 새 snapshot');
});

test('출처 · 경고 전파와 claim → Evidence 연결 (실행되지 않은 Tool 을 근거로 든 claim 은 걸러진다)', async () => {
  const marketSource = { kind: 'external' as const, type: 'market-data' as const, origin: 'yahoo-finance', basis: null, fetchedAt: AT, persisted: false, note: null, asOf: AT };
  const market = ok('getMarketData', { asOf: AT, marketCap: { value: 1e15, unit: 'KRW', valueTrillion: 1000, asOf: AT, source: 'Yahoo Finance' } }, [marketSource], [{ code: 'provider-reliability', text: 'unofficial provider', level: 'review' }]);
  const ref = (tool: string, fieldPath: string | null) => ({ tool, fieldPath });
  const client = new Gateway([() => call('getHistoricalAnalysis', {}, 1), () => done({
    summary: '시가총액과 영업이익률을 함께 보았습니다.',
    claims: [
      { claimId: 'c1', text: '영업이익률이 개선되었다', type: 'interpretation', evidenceRefs: [ref('getHistoricalAnalysis', 'metrics.operatingMargin.values[2]')] },
      { claimId: 'c2', text: '2026-10-07 기준 시총은 약 1,000조원이다', type: 'fact', evidenceRefs: [ref('getMarketData', 'marketCap.value')] },
      { claimId: 'c3', text: '회사가 HBM 투자를 언급했다', type: 'fact', evidenceRefs: [ref('searchDisclosures', 'results[0]')] },
    ] as never,
  }, [market], [{ tool: 'getHistoricalAnalysis', runtime: 'frontend', status: 'ok' }, { tool: 'getMarketData', runtime: 'backend', status: 'ok' }])]);
  const out = (await run('삼성전자 최근 실적을 분석해줘.', full(), client))!;
  assert.deepEqual(out.answer!.claims.map((c) => [c.claimId, c.status]), [['c1', 'supported'], ['c2', 'supported']], '실행되지 않은 Tool(searchDisclosures)을 근거로 든 claim 은 제거');
  assert.deepEqual(out.answer!.claims.map((c) => c.basis), ['judgment', 'objective']);
  assert.ok(out.violations.some((v) => v.code === 'ungrounded-claim' && v.detail.includes('c3')) && out.corrections.includes('fallback-used') && out.corrections.includes('unsupported-claims-removed'));
  assert.equal(out.answer!.summary, '시가총액과 영업이익률을 함께 보았습니다.', '요약에 문제가 없으면 모델의 요약은 유지한다');
  assert.ok(out.answer!.claims[0].evidenceIds.some((id) => id.startsWith('getHistoricalAnalysis:metrics.operatingMargin')) && out.answer!.claims[1].evidenceIds.includes('getMarketData:marketCap.value'));
  assert.ok(out.answer!.evidenceMap.length >= 2 && out.answer!.grounding!.graph.length >= 2);
  assert.deepEqual(out.answer!.sources.map((s) => `${s.type}`).sort(), ['financial-data', 'market-data']);
  assert.ok(out.state.sources.includes('market-data:yahoo-finance') && out.state.sources.some((s) => s.startsWith('financial-data')));
  assert.ok(out.state.warnings.includes('unofficial provider') && out.answer!.warnings.includes('unofficial provider'), '경고 전파');
  assert.equal(out.audit.grounding!.totalClaims, 3);
  assert.equal(out.audit.grounding!.fallbackUsed, true);
});

test('Workflow 통합: claim → Evidence → Tool → Source, Rf 변경을 WACC 직접 변경으로 잘못 분류한 제안은 바로잡고, 교정 재생성 결과를 채택한다', async () => {
  const ref = (tool: string, fieldPath: string | null) => ({ tool, fieldPath });
  const rf = ok('getMarketAssumptions', { asOf: AT, riskFreeRate: { rate: 0.04286, unit: 'ratio (decimal)', maturity: '10Y', asOf: '2026-08-01', source: 'FRED' }, beta: { value: 1.545, asOf: AT } }, [{ kind: 'external', type: 'market-data', origin: 'fred', basis: null, fetchedAt: AT, persisted: false, note: null, asOf: '2026-08-01' }]);
  const bad = { summary: '현재 WACC 는 8.1%이고 시장 무위험수익률은 9.9%입니다.', claims: [
    { claimId: 'c1', text: '현재 ValuFlow WACC 는 8.1%다.', type: 'fact', evidenceRefs: [ref('getValuationResult', 'wacc')] },
    { claimId: 'c2', text: '시장 무위험수익률은 9.9%다.', type: 'fact', evidenceRefs: [ref('getMarketAssumptions', 'riskFreeRate.rate')] },
  ], proposedActions: [{ type: 'change-wacc-directly', target: 'WACC', currentValue: '3.0%', proposedValue: '4.286%', rationale: '시장 무위험수익률이 더 높다' }] };
  const good = { ...bad, summary: '현재 WACC 는 8.1%이고 시장 무위험수익률은 4.29%입니다.', claims: [bad.claims[0], { ...bad.claims[1], text: '시장 무위험수익률은 4.29%다.' }] };
  const regen: AiRegenerateRequest[] = [];
  const client = new Gateway([() => call('getValuationResult', {}, 1), () => call('getForecastAssumptions', {}, 2, [rf]), () => done(bad as never, [rf], [{ tool: 'getValuationResult', runtime: 'frontend', status: 'ok' }, { tool: 'getMarketAssumptions', runtime: 'backend', status: 'ok' }, { tool: 'getForecastAssumptions', runtime: 'frontend', status: 'ok' }])]);
  (client as unknown as { regenerate: unknown }).regenerate = async (req: AiRegenerateRequest) => { regen.push(req); return { status: 'final', answer: { mode: 'explain', evidence: [], warnings: [], sources: [], suggestedNextActions: [], reviewedAreas: ['WACC'], limitations: [], judgmentItems: ['최종 WACC'], ...good } }; };
  const out = (await run('현재 삼성전자 WACC 가정을 검토해줘.', full(), client))!;
  assert.equal(regen.length, 1);
  assert.ok(regen[0].issues.some((i) => i.target === 'c2') && !JSON.stringify(regen[0]).includes('"data"'));
  assert.deepEqual(out.answer!.claims.map((c) => [c.claimId, c.status, c.basis]), [['c1', 'supported', 'objective'], ['c2', 'supported', 'objective']]);
  assert.equal(out.answer!.summary, good.summary);
  assert.deepEqual(out.answer!.claims[0].evidenceIds, ['getValuationResult:wacc']);
  assert.ok(out.corrections.includes('regenerated') && out.corrections.includes('proposal-retyped') && !out.corrections.includes('fallback-used'));
  assert.deepEqual(out.answer!.proposedActions.map((a) => [a.type, a.target]), [['change-risk-free-rate', '무위험수익률']], 'Rf 변경은 WACC 직접 변경이 아니다');
  assert.deepEqual(out.state.checkpoints.map((c) => [c.kind, c.status, c.applied]), [['change-risk-free-rate', 'pending', false]]);
  assert.equal(out.state.status, 'waiting-for-user');
  assert.deepEqual([out.audit.grounding!.regenerated, out.audit.grounding!.fallbackUsed, out.audit.grounding!.unsupportedNumbers], [true, false, 0]);
  assert.ok(out.violations.some((v) => v.code === 'proposal-semantic-mismatch') && out.audit.grounding!.violations.includes('ungrounded-number'));
});

test('human checkpoint: 변경 제안은 waiting-for-user 로 멈추고, 승인 · 거절 어느 쪽도 값을 적용하지 않는다', async () => {
  const project = full();
  const before = JSON.stringify(project);
  const proposal = { type: 'change-wacc-directly' as const, target: 'WACC', currentValue: '8.1%', proposedValue: '7.8%', rationale: '관찰된 무위험수익률과 베타 기준으로 더 낮은 WACC 를 검토할 수 있습니다.' };
  const client = new Gateway([() => call('getValuationResult', {}, 1), () => done({ summary: '7.8% 로 변경해서 다시 계산할까요?', proposedActions: [proposal] }, [], [{ tool: 'getValuationResult', runtime: 'frontend', status: 'ok' }])]);
  const out = (await run('현재 WACC 8.1% 적절해?', project, client))!;
  assert.equal(out.state.status, 'waiting-for-user');
  assert.deepEqual(out.state.checkpoints.map((c) => [c.kind, c.target, c.currentValue, c.proposedValue, c.status, c.applied]), [['change-wacc-directly', 'WACC', '8.1%', '7.8%', 'pending', false]]);
  assert.match(out.state.message!, /사용자 승인/);
  assert.deepEqual(out.audit.humanCheckpoint, { count: 1, kinds: ['change-wacc-directly'], pending: 1 });
  assert.equal(JSON.stringify(project), before, '승인 전에는 아무것도 바뀌지 않는다');
  const approved = resolveCheckpoint(out.state, out.state.checkpoints[0].id, 'approved');
  assert.equal(approved.status, 'completed');
  assert.equal(approved.checkpoints[0].status, 'approved');
  assert.equal(approved.checkpoints[0].applied, false, '승인되어도 Agent 는 적용하지 않는다');
  assert.match(approved.message!, /직접 입력/);
  assert.equal(resolveCheckpoint(out.state, out.state.checkpoints[0].id, 'rejected').checkpoints[0].status, 'rejected');
  assert.equal(out.state.checkpoints[0].status, 'pending', 'resolveCheckpoint 는 원본 state 를 바꾸지 않는다');
  assert.equal(JSON.stringify(project), before);
  // 변경을 이미 했다고 말하면 위반으로 기록한다
  const liar = (await run('현재 WACC 8.1% 적절해?', full(), new Gateway([() => done({ summary: 'WACC 를 7.8% 로 변경했습니다.' })])))!;
  assert.ok(liar.violations.some((v) => v.code === 'applied-change-claimed'));
});

test('write 없음: 모든 Tool 은 read / search 이고 write 는 이름 규칙으로 구분된다 · Agent 실행은 가정과 Valuation 결과를 바꾸지 않는다', async () => {
  assert.ok(TOOL_CATALOG.every((t) => t.operation === 'read' || t.operation === 'search') && TOOL_CATALOG.length === 16);
  assert.deepEqual([operationOf('getValuationResult'), operationOf('searchKnowledge'), operationOf('updateWacc'), operationOf('applyPeerMultiple'), operationOf('saveScenario')], ['read', 'search', 'write', 'write', 'write']);
  assert.ok(TOOL_CATALOG.filter((t) => t.name.startsWith('get')).every((t) => t.operation === 'read') && TOOL_CATALOG.filter((t) => t.name.startsWith('search')).every((t) => t.operation === 'search'));
  const project = full();
  const beforeProject = JSON.stringify(project);
  const beforeResult = JSON.stringify(executeTool('getValuationResult', buildAiContext(project)));
  const client = new Gateway([() => call('getForecastAssumptions', {}, 1), () => call('getValuationResult', {}, 2), () => call('getSensitivityAnalysis', {}, 3), () => call('getScenarioAnalysis', {}, 4), () => done()]);
  await run('현재 DCF가 어떤 가정에 가장 민감해?', project, client);
  assert.equal(JSON.stringify(project), beforeProject, '프로젝트 가정 불변');
  assert.equal(JSON.stringify(executeTool('getValuationResult', buildAiContext(project))), beforeResult, 'Valuation 결과 불변');
});

test('audit: workflow 단위 이벤트에는 이름 · 상태 · 개수만 있고 Tool 결과 본문 · 문서 · 기사 · Raw 재무 · Key 가 없다', async () => {
  const secret = '공시본문-비밀문장-XYZ';
  const news = ok('searchCompanyNews', { results: [{ title: '기사제목-비밀-ABC', publisher: 'P', publishedAt: '2026-10-06T00:00:00+00:00', url: 'https://n/1', snippet: '기사본문-비밀' }] });
  const doc = ok('searchDisclosures', { results: [{ text: secret, documentId: '1', section: 's' }] });
  const client = new Gateway([() => call('getHistoricalAnalysis', {}, 1), () => done({ summary: '요약' }, [news, doc], [{ tool: 'getHistoricalAnalysis', runtime: 'frontend', status: 'ok' }, { tool: 'searchCompanyNews', runtime: 'backend', status: 'ok' }, { tool: 'searchDisclosures', runtime: 'backend', status: 'ok' }])]);
  const out = (await run('최근 이벤트까지 고려해서 주요 valuation risk를 검토해줘.', full(), client, { newId: () => 'wf_audit' }))!;
  const a = out.audit;
  assert.deepEqual(Object.keys(a).sort(), ['contextSnapshotId', 'conversationId', 'corrections', 'durationMs', 'grounding', 'humanCheckpoint', 'question', 'sourcesUsed', 'status', 'stepsExecuted', 'stepsPlanned', 'timestamp', 'toolsExecuted', 'violations', 'warnings', 'workflowId', 'workflowType'].sort());
  assert.deepEqual([a.workflowId, a.workflowType, a.status, a.conversationId], ['wf_audit', 'event-review', 'completed', 'c1']);
  assert.deepEqual(a.stepsPlanned, ['news', 'disclosure', 'valuation', 'forecast', 'historical', 'market']);
  assert.ok(a.stepsExecuted.includes('news') && a.stepsExecuted.includes('disclosure'));
  assert.ok(a.durationMs > 0 && a.timestamp.startsWith('2026-10-07'));
  const json = JSON.stringify(a);
  for (const leak of [secret, '기사제목-비밀', '기사본문-비밀', '333605938', 'ifrs-full_Revenue', 'sk-proj', 'API_KEY']) assert.ok(!json.includes(leak), `audit 에 ${leak} 가 없다`);
  // observation(state)에도 문서 · 기사 본문은 없다
  const stateJson = JSON.stringify(out.state);
  for (const leak of [secret, '기사제목-비밀', '기사본문-비밀']) assert.ok(!stateJson.includes(leak), `state 에 ${leak} 가 없다`);
});

test('backend 오류는 failed 상태로 끝나고 오류 코드만 남는다', async () => {
  const out = (await run('현재 WACC 8.1% 적절해?', full(), new Gateway([() => { throw new AiClientError('provider-rate-limit', '요청 한도'); }])))!;
  assert.equal(out.state.status, 'failed');
  assert.deepEqual(out.error, { code: 'provider-rate-limit', message: '요청 한도' });
  assert.equal(out.audit.status, 'failed');
});

test('값을 바꾸는 제안은 현재 값 · 제안 값이 숫자여야 한다 (서술형 "재검토 권고"는 제안이 아니다)', async () => {
  const vague = { type: 'change-wacc-directly' as const, target: 'WACC', currentValue: '0.0814', proposedValue: '시장 상황 반영 재검토 권고', rationale: '시장 변화' };
  const good = { type: 'change-wacc-directly' as const, target: 'WACC', currentValue: '8.1%', proposedValue: '7.8%', rationale: '시장 관찰값' };
  const out = (await run('현재 WACC 8.1% 적절해?', full(), new Gateway([() => call('getValuationResult', {}, 1), () => done({ summary: '검토했습니다.', proposedActions: [vague, good] }, [], [{ tool: 'getValuationResult', runtime: 'frontend', status: 'ok' }])])))!;
  assert.deepEqual(out.state.checkpoints.map((c) => c.proposedValue), ['7.8%']);
  assert.ok(out.violations.some((v) => v.code === 'proposal-incomplete') && out.corrections.includes('proposals-filtered'));
});
