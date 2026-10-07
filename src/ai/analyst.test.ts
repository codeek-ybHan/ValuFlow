// STEP 08-7: AI Analyst UI 의 view-model · 실행 · history · Knowledge client. (React 렌더링은 browser QA 로 확인하고, 화면이 그리는 모든 값은 여기서 검증한다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAiContext, AiClientError, type AiGatewayClient, type AiQueryRequest, type AiToolResultRequest, type GatewayResponse, type ToolResult, type WorkflowAnswer } from './index.ts';
import { askAnalyst, resolveMode, type Progress } from './analyst/ask.ts';
import { addTurn, decideCheckpoint, emptySession, isStale, selectTurn } from './analyst/session.ts';
import { KnowledgeClient, knowledgeErrorText } from '../data/repository/knowledgeRepository.ts';
import {
  CONFIDENCE_INFO, MODE_INFO, STATUS_INFO, badgeOf, effectiveStatus, errorView, evidenceView, humanField, progressText, readiness, reliabilityOf, sourceViews, timeBasisOf, valueText, waccPanel,
  type AnalystTurn,
} from './analyst/view.ts';
import type { Evidence } from './grounding/types.ts';
import { extractEvidence } from './grounding/verify.ts';
import { emptyProjectState, withHistoricalLoaded, withPracticeAssumptions, withSelectedCompany, type ProjectState } from '../store/projectModel.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const AT = '2026-10-07T01:02:03+00:00';

function liveBase(): ProjectState {
  const s = withSelectedCompany(emptyProjectState, { corpCode: '00126380', corpName: '삼성전자', corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT });
  return withHistoricalLoaded(s, { data: golden.data, quality: golden.quality, provenance: { source: 'database', persisted: true, fetchedAt: AT, fetchId: '7', corpCode: '00126380', fiscalYears: [2023, 2024, 2025] } });
}
const full = () => withPracticeAssumptions(liveBase());

type Step = (req: AiQueryRequest | AiToolResultRequest) => GatewayResponse;
class Gateway implements AiGatewayClient {
  queries: AiQueryRequest[] = [];
  private i = 0;
  private readonly steps: Step[];
  constructor(steps: Step[]) { this.steps = steps; }
  private next(r: AiQueryRequest | AiToolResultRequest): Promise<GatewayResponse> {
    const s = this.steps[this.i++];
    if (!s) throw new AiClientError('provider-error', 'no more scripted steps');
    return Promise.resolve(s(r));
  }
  query(r: AiQueryRequest) { this.queries.push(r); return this.next(r); }
  sendToolResult(r: AiToolResultRequest) { return this.next(r); }
}
const fail = (tool: string, status: 'unavailable' | 'rate-limit' | 'no-data' = 'unavailable'): ToolResult<unknown> => ({ status, tool, reason: 'provider down', sources: [], warnings: [] });
const call = (tool: string, n = 1, backend: ToolResult<unknown>[] = []): GatewayResponse => ({ status: 'tool-call', conversationId: 'c1', state: `s${n}`, callId: `k${n}`, tool, input: {}, toolCalls: n, backendToolResults: backend });
const done = (answer: Partial<WorkflowAnswer> = {}, backend: ToolResult<unknown>[] = []): GatewayResponse => ({
  status: 'final', conversationId: 'c1', toolCalls: 1, toolTrace: [], backendToolResults: backend,
  answer: { mode: 'explain', summary: '요약', evidence: [], warnings: [], sources: [], suggestedNextActions: [], reviewedAreas: [], limitations: [], judgmentItems: [], claims: [], proposedActions: [], ...answer } as never,
});
const MARGIN_CLAIM = { claimId: 'c1', text: '2025년 영업이익률은 13.07%이다.', type: 'fact', evidenceRefs: [{ tool: 'getHistoricalAnalysis', fieldPath: 'metrics.operatingMargin.values[2]' }] };
const JUDGMENT_CLAIM = { claimId: 'c2', text: '영업이익률 개선 추세는 수익성 회복을 시사한다.', type: 'interpretation', evidenceRefs: [{ tool: 'getHistoricalAnalysis', fieldPath: 'metrics.operatingMargin.values' }] };
const historicalRun = (answer: Partial<WorkflowAnswer> = {}) => new Gateway([() => call('getHistoricalAnalysis'), () => done({ summary: '2025년 영업이익률은 13.07%이다.', claims: [MARGIN_CLAIM, JUDGMENT_CLAIM] as never, ...answer })]);
const ask = (question: string, project: ProjectState, client: AiGatewayClient, extra: object = {}) => askAnalyst({ question, project, client, newId: () => 't1', ...extra });

test('Quick / Deep 선택: 자동은 workflow 질문일 때만 Deep Analysis 이고, 사용자 문구로 모드를 구분한다', () => {
  const ctx = buildAiContext(full());
  assert.equal(resolveMode('현재 삼성전자 WACC 가정을 검토해줘.', ctx), 'workflow');
  assert.equal(resolveMode('최근 매출 성장률은?', ctx), 'quick');
  assert.equal(resolveMode('현재 삼성전자 WACC 가정을 검토해줘.', ctx, 'quick'), 'quick', '사용자가 Quick 을 고르면 Quick');
  assert.equal(resolveMode('안녕', ctx, 'workflow'), 'quick', 'workflow 로 계획할 수 없는 질문은 Quick');
  assert.equal(resolveMode('설비투자 확대 이유를 설명해줘.', ctx), 'workflow', '공시 근거가 필요한 "이유" 질문은 claim 검증을 받는다');
  for (const q of ['최근 매출 성장률은?', 'WACC가 올라가면 얼마나 영향 있어?', '현재 EV 얼마야?']) assert.equal(resolveMode(q, ctx), 'quick', q);
  assert.deepEqual([MODE_INFO.quick.name, MODE_INFO.workflow.name], ['Quick Answer', 'Deep Analysis']);
  assert.deepEqual([MODE_INFO.quick.grounding, MODE_INFO.workflow.grounding], ['Tool Guardrails', 'Claim-Evidence']);
});

test('Deep Analysis turn: 기업 context · 진행 단계 · 답변 구조 · Fact / Judgment · Claim 상태 · 신뢰도', async () => {
  const project = liveBase();
  const client = historicalRun();
  const progress: Progress[] = [];
  const turn = await ask('최근 영업이익률을 분석해줘.', project, client, { onProgress: (p: Progress) => progress.push(p) });
  const c = buildAiContext(project).company!;
  assert.deepEqual(turn.company, { name: c.name, stockCode: c.stockCode, corpCode: '00126380' }, '현재 Project 의 기업');
  assert.equal(turn.mode, 'workflow');
  assert.equal(turn.workflowLabel, 'Historical Performance Review');
  assert.ok(['completed', 'completed-with-limitations'].includes(turn.status), turn.status);
  // 진행: 실행 중인 단계의 문장이 나오고, 가짜 진행률 숫자는 없다
  assert.ok(progress.length >= 2 && progress.some((p) => p.steps.some((s) => s.status === 'running') && /과거 실적/.test(p.text)));
  assert.ok(progress.every((p) => !/\d+\s*%/.test(p.text)));
  assert.ok(turn.steps.some((s) => s.tool === 'getHistoricalAnalysis' && s.status === 'completed'));
  assert.ok(turn.usedSources.includes('Historical Analysis'));
  // 답변 구조 + Fact / Judgment 구분
  const a = turn.answer!;
  assert.match(a.summary, /13\.07%/);
  assert.deepEqual(a.keyFindings.map((c) => [c.id, c.kind, c.typeLabel]), [['c1', 'fact', 'Fact']]);
  assert.deepEqual(a.interpretation.map((c) => [c.id, c.kind, c.typeLabel]), [['c2', 'judgment', 'Interpretation']]);
  const fact = a.keyFindings[0]!;
  assert.equal(fact.status, 'supported');
  assert.equal(fact.statusLabel, 'Supported');
  assert.ok(fact.confidence && fact.evidenceCount >= 1);
  assert.equal(turn.grounding, 'grounded');
  // Evidence: 출처 · 필드(경로가 아닌 이름) · 단위가 붙은 값
  const ev = turn.evidence.find((e) => fact.evidenceIds.includes(e.id))!;
  assert.equal(ev.field, 'Operating Margin');
  assert.equal(ev.valueText, '13.07%');
  assert.equal(ev.period, '2025A');
  assert.equal(ev.badge, 'opendart');
  assert.ok(!/^[a-z-]+:/.test(ev.sourceLabel), `내부 표기가 아니라 사용자 라벨: ${ev.sourceLabel}`);
  assert.equal(ev.kindLabel, 'Actual');
  assert.ok(turn.sources.some((s) => s.badge === 'opendart'));
  assert.equal(turn.debug?.groundingLevel, 'claim-evidence');
  // 질문마다 새 대화: 다른 turn 의 내용이 gateway 로 가지 않는다
  assert.equal(client.queries.length, 1);
  assert.equal(client.queries[0]!.question, '최근 영업이익률을 분석해줘.');
});

test('Quick Answer turn: claim 구조가 없고 Tool Guardrails 수준임을 구분한다', async () => {
  const client = new Gateway([() => ({ status: 'final', conversationId: 'c1', toolCalls: 0, answer: { mode: 'explain', summary: '최근 매출 성장률은 10.88%입니다.', evidence: [{ label: '매출 성장률', value: '10.88%', period: '2025A', tool: 'getHistoricalAnalysis' }], warnings: [], sources: [], suggestedNextActions: ['Forecast 와 비교'] } })]);
  const turn = await ask('최근 매출 성장률은?', liveBase(), client);
  assert.equal(turn.mode, 'quick');
  assert.equal(turn.grounding, null);
  assert.deepEqual([turn.answer!.keyFindings, turn.answer!.interpretation], [[], []]);
  assert.deepEqual(turn.answer!.plainEvidence.map((e) => [e.label, e.value, e.tool]), [['매출 성장률', '10.88%', 'Historical Analysis']]);
  assert.equal(turn.debug?.groundingLevel, 'tool-guardrails');
});

test('Human checkpoint: 검토 대기 → 결정 기록. 어떤 결정도 Project 상태를 바꾸지 않고, WACC 구성요소와 WACC 직접 변경을 구분한다', async () => {
  const project = full();
  const before = JSON.stringify(project);
  const client = new Gateway([() => call('getForecastAssumptions'), () => done({
    summary: '무위험수익률 가정 3.0% 을 검토하세요.',
    proposedActions: [
      { type: 'change-risk-free-rate', target: 'Risk-free Rate', currentValue: '3.0%', proposedValue: '4.29%', rationale: '시장 관찰값이 가정보다 높다.' },
      { type: 'change-beta', target: 'Beta', currentValue: '1.1', proposedValue: '1.5', rationale: '관찰 베타가 가정보다 높다.' },
    ] as never,
  })]);
  const turn = await ask('현재 삼성전자 WACC 가정을 검토해줘.', project, client);
  assert.equal(turn.status, 'waiting-for-review');
  assert.equal(effectiveStatus(turn), 'waiting-for-review');
  assert.deepEqual(turn.checkpoints.map((c) => [c.kind, c.decision]), [['change-risk-free-rate', 'pending'], ['change-beta', 'pending']]);
  assert.match(turn.checkpoints[0]!.note!, /구성요소/);
  assert.match(turn.checkpoints[1]!.note!, /구성요소/, 'Beta 도 WACC 직접 변경이 아니다');
  assert.equal(turn.checkpoints[0]!.title, 'Review risk-free rate assumption');
  // WACC 와 구성요소가 분리되어 표시된다
  assert.ok(turn.wacc && turn.wacc.wacc && /%$/.test(turn.wacc.wacc));
  assert.deepEqual(turn.wacc!.components.map((c) => c.label), ['Risk-free Rate', 'Beta', 'Market Risk Premium', 'Cost of Debt (pre-tax)']);
  // 결정 기록
  let s = addTurn(emptySession, turn);
  s = decideCheckpoint(s, turn.id, turn.checkpoints[0]!.id, 'keep');
  s = decideCheckpoint(s, turn.id, turn.checkpoints[1]!.id, 'continue');
  const t2 = s.turns[0]!;
  assert.equal(effectiveStatus(t2), 'completed');
  assert.deepEqual(t2.checkpoints.map((c) => c.decision), ['keep', 'continue']);
  assert.equal(effectiveStatus({ ...t2, checkpoints: t2.checkpoints.map((c) => ({ ...c, decision: 'later' as const })) }), 'waiting-for-review', 'Review Later 는 아직 대기');
  assert.equal(JSON.stringify(project), before, 'checkpoint 와 질문은 ProjectState 를 바꾸지 않는다');
});

test('오류 UX: backend · LLM · rate limit · 취소를 사용자 문구로 구분하고 기술 오류를 그대로 보이지 않는다', async () => {
  const run = (code: string) => ask('최근 영업이익률을 분석해줘.', liveBase(), new Gateway([() => { throw new AiClientError(code, 'RAW {"detail":"stack"} sk-secret'); }]));
  for (const [code, kind] of [['backend-unreachable', 'backend-unavailable'], ['ai-not-configured', 'llm-unavailable'], ['provider-error', 'llm-unavailable'], ['provider-rate-limit', 'rate-limit']] as const) {
    const t = await run(code);
    assert.equal(t.status, 'failed');
    assert.equal(t.error!.kind, kind);
    assert.ok(!/RAW|stack|sk-secret|\{/.test(`${t.error!.title} ${t.error!.detail}`), '내부 오류 원문이 노출되지 않는다');
  }
  assert.equal(errorView('whatever').kind, 'unknown');
  const cancelled = await ask('최근 영업이익률을 분석해줘.', liveBase(), historicalRun(), { signal: { aborted: true } });
  assert.equal(cancelled.status, 'cancelled');
});

test('부분 실패: 뉴스 Tool 이 실패해도 답변은 남기고 한계를 알린다', async () => {
  const client = new Gateway([() => call('getHistoricalAnalysis', 1, [fail('searchCompanyNews')]), () => done({ summary: '2025년 영업이익률은 13.07%이다.', claims: [MARGIN_CLAIM] as never })]);
  const turn = await ask('최근 영업이익률을 분석해줘.', liveBase(), client);
  assert.equal(turn.status, 'completed-with-limitations');
  const w = turn.warnings.find((x) => x.kind === 'partial-failure')!;
  assert.match(w.text, /News/);
  assert.match(w.text, /가져오지 못했습니다/);
  assert.match(w.text, /Historical Analysis/);
  assert.ok(turn.answer, '답변은 그대로 보인다');
  const limited = await ask('최근 영업이익률을 분석해줘.', liveBase(), new Gateway([() => call('getHistoricalAnalysis', 1, [fail('searchDisclosures', 'no-data')]), () => done({ claims: [MARGIN_CLAIM] as never })]));
  assert.ok(limited.warnings.some((x) => x.kind === 'retrieval' && /검색 결과가 없습니다/.test(x.text)));
});

test('지원하지 않는 기업 · 기업 없음: LLM 을 호출하지 않고 샘플 데이터를 자동으로 채우지 않는다', async () => {
  const unsupported = new Gateway([]);
  const status = { kind: 'failed' as const, refresh: false, failure: { kind: 'unsupported' as const, code: 'unsupported-industry' as const, message: '금융업', quality: null } };
  const selected = withSelectedCompany(emptyProjectState, { corpCode: '00104730', corpName: '다른은행', corpNameEng: null, stockCode: '000000', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT });
  const t = await ask('삼성전자 Valuation 전체 검토해줘.', selected, unsupported, { historicalStatus: status });
  assert.equal(t.status, 'unsupported');
  assert.equal(unsupported.queries.length, 0);
  assert.ok(t.warnings.some((w) => w.kind === 'unsupported'));
  assert.equal(t.company?.name, '다른은행', '이전 기업이 아니라 현재 선택한 기업');

  const none = new Gateway([]);
  const empty = JSON.stringify(emptyProjectState);
  const e = await ask('최근 영업이익률을 분석해줘.', emptyProjectState, none);
  assert.equal(e.status, 'failed');
  assert.equal(e.error!.kind, 'no-company');
  assert.equal(none.queries.length, 0);
  assert.equal(JSON.stringify(emptyProjectState), empty, 'fixture 로 자동 대체하지 않는다');
});

test('Empty state: 재무데이터 · Valuation · PDF 가 없을 때의 안내 (자동 채움 없음)', () => {
  const base = { hasCompany: true, hasHistorical: true, hasValuation: true, unsupportedMessage: null, documentCount: 3 };
  assert.deepEqual(readiness(base), { canAsk: true, notices: [] });
  assert.equal(readiness({ ...base, hasHistorical: false }).notices[0]!.id, 'no-historical');
  assert.match(readiness({ ...base, hasHistorical: false }).notices[0]!.text, /Workspace/);
  assert.equal(readiness({ ...base, hasValuation: false }).notices[0]!.id, 'no-valuation');
  assert.match(readiness({ ...base, hasValuation: false }).notices[0]!.text, /Valuation/);
  assert.match(readiness({ ...base, documentCount: 0 }).notices[0]!.text, /업로드/);
  assert.equal(readiness({ ...base, documentCount: null }).notices.length, 0, '목록을 못 불러온 것은 문서 0건이 아니다');
  const none = readiness({ ...base, hasCompany: false, hasHistorical: false, hasValuation: false });
  assert.equal(none.canAsk, false);
  assert.equal(none.notices[0]!.to, '/workspace');
  assert.equal(readiness({ ...base, unsupportedMessage: '지원하지 않습니다' }).notices[0]!.id, 'unsupported');
});

const ev = (e: Partial<Evidence>): Evidence => ({ evidenceId: 'x', tool: 'getHistoricalAnalysis', sourceType: 'financial-data', sourceKind: 'actual', ...e });

test('출처 · Evidence 표시: OpenDART · 공시 · PDF(page) · 시장(asOf) · 개발용 provider 구분', () => {
  assert.equal(badgeOf('financial-data', 'actual', 'opendart'), 'opendart');
  assert.equal(badgeOf('financial-data', 'actual', 'database'), 'opendart');
  assert.equal(badgeOf('financial-data', 'actual', 'fixture'), 'fixture');
  assert.equal(badgeOf('financial-data', 'calculated', 'valuation-engine'), 'valuflow');
  assert.deepEqual(['disclosure-document', 'uploaded-document', 'market-data', 'peer-data', 'news'].map((t) => badgeOf(t, 'document')), ['disclosure', 'upload', 'market', 'peer', 'news']);

  const disclosure = evidenceView(ev({ tool: 'searchDisclosures', sourceType: 'disclosure-document', sourceKind: 'document', fieldPath: 'results[0]', section: 'II. 사업의 내용', sourceLabel: '사업보고서 (2025.12)', documentId: '20260310000123', excerpt: '평택 P5 라인 투자를 확대한다.' }));
  assert.deepEqual([disclosure.badgeLabel, disclosure.section, disclosure.sourceLabel, disclosure.excerpt], ['Disclosure', 'II. 사업의 내용', '사업보고서 (2025.12)', '평택 P5 라인 투자를 확대한다.']);
  const pdf = evidenceView(ev({ tool: 'searchUploadedDocuments', sourceType: 'uploaded-document', sourceKind: 'document', fieldPath: 'results[0]', page: 18, sourceLabel: '2026 Semiconductor Outlook' }));
  assert.deepEqual([pdf.badgeLabel, pdf.page, pdf.sourceLabel], ['Uploaded PDF', 18, '2026 Semiconductor Outlook']);
  const market = evidenceView(ev({ tool: 'getMarketData', sourceType: 'market-data', sourceKind: 'external', fieldPath: 'price.value', value: 268500, unit: 'KRW', asOf: '2026-10-07T03:00:00+00:00', provider: { name: 'yahoo-finance', reliability: 'unofficial', tier: 'development' } }));
  assert.deepEqual([market.badgeLabel, market.asOf, market.valueText, market.reliability?.label], ['Market Data', '2026-10-07', '268,500원', 'Development Source']);
  assert.equal(reliabilityOf({ reliability: 'official', tier: 'production' }, 'market-data'), null, '공식 provider 는 경고하지 않는다');
  assert.equal(reliabilityOf(null, 'market-data')?.label, 'Reference Data');
  assert.equal(reliabilityOf(null, 'financial-data'), null);
  assert.equal(evidenceView(ev({ fieldPath: 'metrics.x.values[0]', missing: true })).missing, true);

  const views = sourceViews([
    { kind: 'document', type: 'uploaded-document', origin: 'user-upload', basis: null, fetchedAt: null, title: '2026 Semiconductor Outlook', page: 18, section: 'Memory', sourceName: 'Broker A', uploadedAt: '2026-10-01T00:00:00Z', documentId: '5' },
    { kind: 'document', type: 'disclosure-document', origin: 'opendart', basis: null, fetchedAt: null, reportName: '사업보고서', corpName: '삼성전자', section: 'II. 사업의 내용', filingDate: '2026-03-10', receiptNo: '20260310000123', documentId: '20260310000123' },
    { kind: 'document', type: 'uploaded-document', origin: 'user-upload', basis: null, fetchedAt: null, title: '2026 Semiconductor Outlook', page: 18, section: 'Memory', sourceName: 'Broker A', uploadedAt: '2026-10-01T00:00:00Z', documentId: '5' },
  ], []);
  assert.equal(views.length, 2, '같은 출처는 한 번만');
  assert.deepEqual(views[0]!.lines, ['p.18', 'Memory', 'Broker A', '업로드 2026-10-01']);
  assert.deepEqual(views[1]!.lines, ['삼성전자', 'II. 사업의 내용', '공시일 2026-03-10', '접수번호 20260310000123']);
});

test('단위 표시: 숫자에는 항상 단위를 붙이고 경로가 아닌 이름으로 필드를 보여 준다', () => {
  assert.equal(valueText(0.1307, 'ratio'), '13.07%');
  assert.equal(valueText(13.07, 'percent'), '13.07%');
  assert.equal(valueText(377930, '억원'), '37.79조원');
  assert.equal(valueText(268500, '원'), '268,500원');
  assert.equal(valueText(1.1, 'x'), '1.1배');
  assert.match(valueText(5, undefined)!, /단위 미상/);
  assert.equal(valueText(1.545, undefined, 'beta.value'), '1.545배', '베타는 무차원이라 단위 미상으로 표시하지 않는다');
  assert.equal(valueText(null), null);
  assert.equal(humanField('metrics.operatingMargin.values[2]'), 'Operating Margin');
  assert.equal(humanField('wacc.riskFreeRate'), 'Wacc · Risk Free Rate'.replace('Wacc', 'WACC'));
  assert.equal(humanField('data.tvContribution'), 'Terminal Value Contribution');
  assert.equal(humanField(undefined), '—');
  assert.deepEqual(waccPanel({ riskFreeRate: 0.03, beta: 1.1, marketRiskPremium: 0.06, preTaxCostOfDebt: 0.05 }, { wacc: 0.0814 }), {
    wacc: '8.14%', components: [{ label: 'Risk-free Rate', value: '3.00%' }, { label: 'Beta', value: '1.1배' }, { label: 'Market Risk Premium', value: '6.00%' }, { label: 'Cost of Debt (pre-tax)', value: '5.00%' }],
  });
  assert.equal(waccPanel(null, null), null);
});

test('기준 시점 · 신뢰도 표시', () => {
  const t = timeBasisOf([
    ev({ period: '2023A' }), ev({ period: '2025A' }),
    ev({ sourceType: 'market-data', asOf: '2026-10-07T03:00:00+00:00' }), ev({ sourceType: 'news', asOf: '2026-10-06T01:00:00+00:00' }),
  ])!;
  assert.deepEqual([t.historical, t.market, t.news, t.mismatch], ['FY2023 – FY2025', '2026-10-07', '2026-10-06', true]);
  assert.match(t.notice!, /기준 시점/);
  const only = timeBasisOf([ev({ period: '2025A' })])!;
  assert.deepEqual([only.historical, only.mismatch, only.notice], ['FY2025', false, null]);
  assert.equal(timeBasisOf([]), null);
  for (const level of ['high', 'medium', 'low'] as const) assert.match(CONFIDENCE_INFO[level].tip, new RegExp(`^${CONFIDENCE_INFO[level].label}:`), '색이 아니라 글자 · 기호 · 설명이 있다');
  assert.equal(new Set(Object.values(CONFIDENCE_INFO).map((c) => c.glyph)).size, 3);
});

test('시장 근거가 있는 답변: 개발용 provider 경고와 기준 시점 notice 가 Warnings 에 표시된다', async () => {
  const market: ToolResult<unknown> = {
    status: 'ok', tool: 'getMarketData',
    data: { company: { name: '삼성전자' }, timeBasis: 'current-market', asOf: '2026-10-07T03:00:00+00:00', currency: 'KRW', price: { value: 268500, unit: 'KRW', asOf: '2026-10-07T03:00:00+00:00', source: 'Yahoo Finance' },
      providers: [{ name: 'yahoo-finance', reliability: 'unofficial', tier: 'development' }] },
    sources: [{ kind: 'external', type: 'market-data', origin: 'yahoo-finance', basis: null, fetchedAt: AT, persisted: false, note: null, asOf: '2026-10-07T03:00:00+00:00', title: '005930.KS market data' } as never], warnings: [],
  };
  const client = new Gateway([() => call('getHistoricalAnalysis', 1, [market]), () => done({
    summary: '주가는 268,500원이고 2025년 영업이익률은 13.07%이다.',
    claims: [MARGIN_CLAIM, { claimId: 'c3', text: '주가는 2026-10-07 기준 268,500원이다.', type: 'fact', evidenceRefs: [{ tool: 'getMarketData', fieldPath: 'price.value' }] }] as never,
  })]);
  const turn = await ask('최근 영업이익률을 분석해줘.', liveBase(), client);
  const priceClaim = turn.answer!.keyFindings.find((c) => c.id === 'c3')!;
  assert.ok(priceClaim, '시장 claim 이 남아 있다');
  const e = turn.evidence.find((x) => priceClaim.evidenceIds.includes(x.id))!;
  assert.deepEqual([e.badgeLabel, e.asOf, e.reliability?.label], ['Market Data', '2026-10-07', 'Development Source']);
  assert.ok(turn.warnings.some((w) => w.kind === 'provider' && /Development Source/.test(w.text)));
  assert.equal(turn.timeBasis?.mismatch, true);
  assert.ok(turn.warnings.some((w) => w.kind === 'time'));
  assert.ok(turn.sources.some((s) => s.badge === 'market' && s.reliability?.label === 'Development Source'));
});

test('History: 과거 답변은 그 당시의 Evidence snapshot 을 보여 주고 현재 상태로 다시 계산하지 않는다', async () => {
  const p1 = liveBase();
  const t1 = await ask('최근 영업이익률을 분석해줘.', p1, historicalRun());
  let s = addTurn(emptySession, t1);
  const t2: AnalystTurn = { ...t1, id: 't2', question: '다시 질문' };
  s = addTurn(s, t2);
  assert.equal(s.activeId, 't2');
  assert.equal(selectTurn(s, 't1').activeId, 't1');
  assert.equal(selectTurn(s, 'nope').activeId, 't2', '없는 turn 은 선택하지 않는다');
  const frozen = JSON.stringify(s.turns[0]);
  // Project 가 바뀐 뒤에도 과거 turn 은 그대로이고 "이전 상태" 표시만 켜진다
  const p2 = full();
  const nowId = buildAiContext(p2);
  const t3 = await ask('최근 영업이익률을 분석해줘.', p2, historicalRun());
  assert.ok(isStale(t1, t3.contextSnapshotId));
  assert.ok(!isStale(t3, t3.contextSnapshotId));
  assert.ok(nowId.valuationAssumptions !== null);
  assert.equal(JSON.stringify(s.turns[0]), frozen, 'history 의 turn 은 바뀌지 않는다');
});

test('Project state 분리: 질문 · 결과 · 모든 view 생성은 ProjectState 를 바꾸지 않는다', async () => {
  const project = full();
  const before = JSON.stringify(project);
  await ask('현재 삼성전자 WACC 가정을 검토해줘.', project, new Gateway([() => call('getForecastAssumptions'), () => done({ summary: '검토', proposedActions: [{ type: 'change-beta', target: 'Beta', currentValue: '1.1', proposedValue: '1.5', rationale: '관찰 베타가 높다' }] as never })]));
  await ask('최근 영업이익률을 분석해줘.', project, historicalRun());
  assert.equal(JSON.stringify(project), before);
});

test('상태 문구 · 진행 문구: 모든 상태에 사용자용 설명이 있고 내부 용어를 쓰지 않는다', () => {
  for (const [k, v] of Object.entries(STATUS_INFO)) assert.ok(v.label && v.detail, k);
  assert.deepEqual(['completed', 'completed-with-limitations', 'waiting-for-review', 'failed', 'tool-limit'].map((k) => STATUS_INFO[k as keyof typeof STATUS_INFO].label), ['Completed', 'Completed with limitations', 'Waiting for review', 'Failed', 'Tool limit reached']);
  assert.equal(progressText([{ tool: 'getMarketAssumptions', status: 'running' }]), '시장 가정을 확인하는 중…');
  assert.equal(progressText([{ tool: 'getHistoricalAnalysis', status: 'completed' }, { tool: 'searchDisclosures', status: 'pending' }]), '공시를 검색하는 중…');
  assert.equal(progressText([{ tool: 'getHistoricalAnalysis', status: 'completed' }]), '근거를 검증하는 중…');
});

// ---- Knowledge Documents ----
const res = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const DOC = { documentId: 5, sourceType: 'user-upload', title: '2026 Semiconductor Outlook', documentType: 'research', corpName: null, businessYear: 2026, uploadedAt: '2026-10-07T00:00:00Z', chunkCount: 42, sectionCount: 6, embeddingModel: 'text-embedding-3-small', originalFilename: 'outlook.pdf', status: 'ready' };

test('PDF 관리: 업로드 · 목록 · 삭제 · 재인덱싱 · already-exists · 오류 문구', async () => {
  const seen: { url: string; method?: string }[] = [];
  let mode: 'ingested' | 'already-exists' = 'ingested';
  const client = new KnowledgeClient({
    fetch: (url, init) => {
      seen.push({ url, method: init?.method });
      if (url.startsWith('/api/knowledge/documents?')) return res(200, { items: [DOC, { ...DOC, documentId: 6, title: 'Broken', status: 'failed' }, { ...DOC, documentId: 7, status: 'processing' }] });
      if (url.endsWith('/reindex')) return res(200, { document: { ...DOC, chunkCount: 43 } });
      if (init?.method === 'DELETE') return res(200, { deleted: 5 });
      return res(mode === 'ingested' ? 201 : 200, { status: mode, document: DOC });
    },
  });
  const file = new File(['%PDF-1.4'], 'outlook.pdf', { type: 'application/pdf' });
  const docs = await client.list();
  assert.deepEqual(docs.map((d) => [d.documentId, d.state]), [[5, 'ready'], [6, 'failed'], [7, 'indexing']]);
  assert.ok(seen[0]!.url.includes('sourceType=user-upload'), 'OpenDART 공시가 아니라 사용자 문서만 나열한다');
  assert.equal((await client.upload(file)).state, 'ready');
  mode = 'already-exists';
  assert.equal((await client.upload(file)).state, 'already-exists');
  assert.equal((await client.reindex(5)).chunkCount, 43);
  await client.remove(5);
  assert.deepEqual(seen.slice(-2).map((s) => [s.url, s.method]), [['/api/knowledge/documents/5/reindex', 'POST'], ['/api/knowledge/documents/5', 'DELETE']]);

  const bad = (code: string, status = 400) => new KnowledgeClient({ fetch: () => res(status, { error: { code, message: 'RAW internal detail' } }) });
  await assert.rejects(bad('unsupported-file-type').upload(file), (e: Error) => e.message === 'PDF 파일만 올릴 수 있습니다.');
  await assert.rejects(bad('encrypted-pdf').upload(file), (e: Error) => /암호/.test(e.message));
  await assert.rejects(bad('ai-not-configured', 503).list(), (e: Error) => /서버의 데이터베이스/.test(e.message) && !/RAW/.test(e.message));
  await assert.rejects(new KnowledgeClient({ fetch: () => Promise.reject(new Error('down')) }).list(), (e: Error) => /연결할 수 없습니다/.test(e.message));
  assert.match(knowledgeErrorText('???'), /문서를 처리하지 못했습니다/);
});

test('Evidence 출처: 값마다 출처가 다른 Tool(시장 가정)은 값의 own source 를 쓰고, Tool 의 첫 출처로 모든 값을 설명하지 않는다', () => {
  const r: ToolResult<unknown> = {
    status: 'ok', tool: 'getMarketAssumptions',
    data: { riskFreeRate: { rate: 0.0429, unit: 'ratio', asOf: '2026-08-01', source: 'FRED' }, beta: { value: 1.545, asOf: '2026-10-07', source: 'Yahoo Finance' } },
    sources: [{ kind: 'external', type: 'market-data', origin: 'fred', basis: null, fetchedAt: AT, persisted: false, note: null, title: 'KR 10Y bond yield' } as never], warnings: [],
  };
  const list = extractEvidence([r]).list;
  assert.equal(list.find((e) => e.fieldPath === 'riskFreeRate.rate')!.sourceLabel, 'FRED');
  assert.equal(list.find((e) => e.fieldPath === 'beta.value')!.sourceLabel, 'Yahoo Finance');
});
