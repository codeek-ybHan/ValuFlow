// STEP 09-1: Report Architecture & Data Contract — 입력 snapshot · 모델 · Actual/Estimate · 단위 · 출처 · 검증 · 재계산 금지 · AI narrative.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildReport, buildReportInput, parseReport, serializeReport, validateReportInput, REPORT_SCHEMA_VERSION, type AiAnalysisInput, type Cell, type ReportInput, type ReportModel } from './index.ts';
import { buildScenario } from '../ai/eval/scenarios.ts';
import { withValuationReset, type ProjectState } from '../store/projectModel.ts';
import type { Evidence, GroundedClaim } from '../ai/grounding/types.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const NOW = () => new Date('2026-10-08T01:02:03Z');
const full = () => buildScenario('full', golden).project;
const inputOf = (p = full(), ai: AiAnalysisInput | null = null) => buildReportInput(p, { now: NOW, aiAnalysis: ai });
const modelOf = (input: ReportInput): ReportModel => { const r = buildReport(input); assert.equal(r.status, 'ok', JSON.stringify(r.validation.errors)); return r.model!; };

/** 모델 안의 모든 Cell 을 모은다. */
function cellsOf(o: unknown, out: Cell[] = []): Cell[] {
  if (Array.isArray(o)) o.forEach((x) => cellsOf(x, out));
  else if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    if (typeof r.state === 'string' && typeof r.unit === 'string' && typeof r.kind === 'string' && 'sourceId' in r) out.push(r as unknown as Cell);
    else Object.values(r).forEach((v) => cellsOf(v, out));
  }
  return out;
}

const claim = (claimId: string, text: string, type: GroundedClaim['type'], status: GroundedClaim['status'], evidenceIds: string[], basis: GroundedClaim['basis'] = 'objective'): GroundedClaim =>
  ({ claimId, text, type, basis, evidenceIds, status, confidence: 'high', numbers: [], issues: [], confidenceNotes: [] });
const ev = (evidenceId: string, extra: Partial<Evidence> = {}): Evidence => ({ evidenceId, tool: 'getHistoricalAnalysis', sourceType: 'financial-data', sourceKind: 'actual', ...extra });
const aiFor = (input: ReportInput, over: Partial<AiAnalysisInput> = {}): AiAnalysisInput => ({
  analysisId: 'wf_1', question: 'q', workflowType: 'event-review', contextSnapshotId: input.snapshot.contextSnapshotId, createdAt: '2026-10-08T00:00:00Z', groundingLevel: 'claim-evidence',
  claims: [
    claim('c1', '2025년 영업이익률은 13.07%이다.', 'fact', 'supported', ['e1']),
    claim('c2', '수익성 개선이 이어지고 있다.', 'interpretation', 'supported', ['e1'], 'judgment'),
    claim('c3', '주가는 268,500원이다.', 'fact', 'partially-supported', ['e2']),
    claim('c4', '근거 없는 주장이다.', 'fact', 'unsupported', []),
    claim('c5', 'DCF 가치가 TV 에 크게 의존한다.', 'risk', 'supported', ['e1'], 'judgment'),
    claim('c6', '추적할 수 없는 근거를 가진 claim.', 'fact', 'supported', ['e-missing']),
    claim('c7', 'WACC 입력을 검토하라.', 'recommendation', 'supported', ['e1'], 'judgment'),
    claim('c8', '시장 데이터 기반 사실.', 'fact', 'supported', ['e2']),
  ],
  evidence: [ev('e1', { fieldPath: 'metrics.operatingMargin.values[2]' }), ev('e2', { tool: 'getMarketData', sourceType: 'market-data', sourceKind: 'external', origin: 'yahoo-finance', sourceLabel: '005930.KS market data', asOf: '2026-10-07T03:00:00+00:00', provider: { name: 'Yahoo Finance', reliability: 'unofficial', tier: 'development' } })],
  sources: [], limitations: ['D&A 데이터는 제공되지 않는다.'], ...over,
});

test('1. ReportInput 생성: 회사 · Historical · 분석 · 품질 · 가정 · 결과 · 민감도 · 시나리오 · 상대가치 · snapshot', () => {
  const p = full();
  const i = inputOf(p);
  assert.equal(i.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(i.company?.name, p.historicalData!.company.name);
  assert.ok(i.historical && i.historicalAnalysis && i.dataQuality && i.provenance);
  assert.equal(i.historicalKind, 'actual');
  assert.equal(i.assumptionKind, 'learning');
  assert.ok(i.valuationResult && i.sensitivity && i.scenario && i.relativeValuation && i.valuationRange && i.reviewMetrics);
  assert.equal(i.scenario!.columns.length, 3);
  assert.deepEqual([i.snapshot.historicalPeriods.at(-1), i.snapshot.createdAt, i.aiAnalysis], ['2025A', '2026-10-08T01:02:03.000Z', null]);
  assert.match(i.snapshot.contextSnapshotId, /^ctx-/);
  assert.match(i.snapshot.valuationSnapshotId!, /^val-/);
  // Valuation 이 없는 상태에서는 결과 · view 가 비어 있다 (runValuation 으로 만들지 않는다)
  const none = inputOf(withValuationReset(p));
  assert.deepEqual([none.valuationResult, none.sensitivity, none.scenario, none.valuationRange, none.snapshot.valuationSnapshotId], [null, null, null, null, null]);
});

test('2. snapshot isolation: Project 가 바뀌어도 이미 만든 입력 · Report 는 바뀌지 않는다', () => {
  const p = structuredClone(full());   // golden 을 공유하지 않도록 복제한 뒤 흔든다
  const input = inputOf(p);
  const model = modelOf(input);
  const frozen = JSON.stringify([input, model]);
  // 원본 Project 를 직접 흔들어 본다 (입력은 deep copy 이다)
  p.valuationResult!.enterpriseValue = 1;
  p.historicalData!.incomeStatement.revenue[0] = 1;
  (p.valuationAssumptions as { terminalGrowth: number }).terminalGrowth = 0.5;
  assert.equal(JSON.stringify([input, model]), frozen);
  // 같은 입력 → 같은 해시, 바뀐 Project → 다른 snapshot
  assert.equal(inputOf(full()).snapshot.inputHash, input.snapshot.inputHash);
  assert.notEqual(inputOf(p).snapshot.contextSnapshotId, input.snapshot.contextSnapshotId);
  assert.notEqual(inputOf(p).snapshot.inputHash, input.snapshot.inputHash);
  assert.equal(model.metadata.snapshot.contextSnapshotId, input.snapshot.contextSnapshotId);
});

test('3. Historical 출처: 모든 Historical 값은 원본 출처(OpenDART / Database)를 가리키고 fixture 는 fixture 로 표시한다', () => {
  const m = modelOf(inputOf());
  const src = (id: string) => m.sources.find((s) => s.id === id)!;
  const hist = m.historicalPerformance.rows.flatMap((r) => r.cells);
  assert.ok(hist.length > 20 && hist.every((c) => c.sourceId === 'src-historical'));
  assert.deepEqual([src('src-historical').kind, src('src-historical').origin], ['historical', 'database']);
  assert.match(src('src-historical').label, /OpenDART/);
  assert.equal(m.companyOverview.historicalKind, 'actual');
  // fixture
  const fx = buildScenario('full', golden).project;
  const fixtureProject: ProjectState = { ...fx, historicalProvenance: { source: 'fixture', persisted: false } };
  const fm = modelOf(inputOf(fixtureProject));
  assert.equal(fm.sources.find((s) => s.id === 'src-historical')!.origin, 'fixture');
  assert.equal(fm.metadata.dataBasis.historical, 'fixture');
  assert.ok(fm.executiveSummary.notices.some((n) => n.includes('fixture')));
});

test('4. Valuation 출처: 엔진 결과는 ValuFlow Engine, 가정은 가정 출처(학습용 표시)', () => {
  const m = modelOf(inputOf());
  const calc = cellsOf([m.dcf.rows, m.dcf.terminal.filter((t) => t.key !== 'terminalGrowth'), m.wacc.wacc]).filter((c) => c.kind === 'calculated');
  assert.ok(calc.length > 10 && calc.every((c) => c.sourceId === 'src-engine'));
  const eng = m.sources.find((s) => s.id === 'src-engine')!;
  assert.deepEqual([eng.kind, eng.origin], ['engine', 'valuation-engine']);
  const est = cellsOf(m.forecast.assumptions);
  assert.ok(est.every((c) => c.kind === 'estimate' && c.sourceId === 'src-assumptions'));
  const asm = m.sources.find((s) => s.id === 'src-assumptions')!;
  assert.deepEqual([asm.origin, asm.label], ['learning-fixture', 'STEP 04 학습용 가정']);
  assert.ok(m.executiveSummary.notices.some((n) => n.includes('학습용')));
  assert.equal(m.metadata.dataBasis.assumptions, 'learning');
});

test('5. Actual / Estimate / Calculated: 2025A 와 2026E 를 섞지 않는다', () => {
  const m = modelOf(inputOf());
  assert.deepEqual(m.historicalPerformance.periods.map((p) => [p.label, p.kind]), [['2023A', 'actual'], ['2024A', 'actual'], ['2025A', 'actual']]);
  assert.deepEqual(m.forecast.periods.map((p) => p.label), ['2026E', '2027E', '2028E', '2029E', '2030E'].slice(0, m.forecast.periods.length));
  assert.ok(m.forecast.periods.every((p) => p.kind === 'estimate') && m.dcf.periods.every((p) => p.kind === 'estimate'));
  const rows = (id: string) => m.historicalPerformance.rows.find((r) => r.key === id)!;
  assert.ok(rows('revenue').cells.every((c) => c.kind === 'actual') && rows('operatingMargin').cells.every((c) => c.kind === 'calculated'));
  // Forecast · DCF 에는 Actual 이 없다
  assert.equal(cellsOf([m.forecast, m.wacc, m.dcf]).filter((c) => c.kind === 'actual').length, 0);
  assert.ok(m.forecast.projections.every((r) => r.cells.every((c) => c.kind === 'estimate')));
  assert.ok(m.dcf.rows.find((r) => r.key === 'fcff')!.cells.every((c) => c.kind === 'calculated'));
  assert.match(m.forecast.basisNote, /Actual/);
});

test('6. 단위 정책: 재무 억원 · 대형 조원 보조 · 주당 원 · 비율 % · 주식 수 주 (display helper 재사용)', () => {
  const p = full();
  const m = modelOf(inputOf(p));
  const rev = m.historicalPerformance.rows.find((r) => r.key === 'revenue')!.cells[2]!;
  assert.equal(rev.unit, 'eok');
  assert.ok(Math.abs(rev.value! - p.historicalData!.incomeStatement.revenue[2]! / 100) < 1e-6, 'KRW million ÷ 100 = 억원');
  assert.match(rev.text!, /억원$/);
  assert.match(rev.largeText!, /조원$/, '1조원 이상은 조원 보조 표기');
  const h = m.executiveSummary.headline;
  assert.match(h.perShareValue.text!, /^[\d,]+원$/);
  assert.match(h.wacc.text!, /%$/);
  assert.equal(h.enterpriseValue.value, p.valuationResult!.enterpriseValue, '원본 값은 반올림하지 않는다');
  const shares = m.dcf.bridge.find((b) => b.key === 'sharesOutstanding')!.cell;
  assert.match(shares.text!, /주$/);
  assert.deepEqual([m.metadata.currency, m.metadata.monetaryUnit, m.metadata.perShareUnit], ['KRW', '억원', '원']);
  assert.ok(cellsOf(m).every((c) => ['eok', 'won', 'ratio', 'shares', 'multiple', 'factor'].includes(c.unit)));
  assert.ok(cellsOf(m).filter((c) => c.state === 'ok').every((c) => c.text !== null), '모든 숫자는 표시 문자열을 가진다');
});

test('7. Missing data: missing / unavailable / not-applicable 을 구분하고 0 으로 채우지 않는다', () => {
  const m = modelOf(inputOf());
  const row = (k: string) => m.historicalPerformance.rows.find((r) => r.key === k)!;
  assert.deepEqual([row('revenueGrowth').cells[0]!.state, row('revenueGrowth').cells[0]!.reason], ['not-applicable', '첫 기간은 비교할 직전 연도가 없습니다.']);
  const da = row('depreciation').cells[0]!;
  assert.deepEqual([da.state, da.value, da.text], ['unavailable', null, null], 'D&A 는 값을 만들지 않고 이유를 남긴다');
  assert.match(da.reason!, /공시 데이터에 없어/);
  assert.ok(cellsOf(m).filter((c) => c.state !== 'ok').every((c) => c.value === null && c.reason));
  // 상대가치 입력이 없으면 만들지 않는다
  const noRel = buildScenario('full', golden).project;
  const m2 = modelOf(inputOf({ ...noRel, relativeInputs: {} }));
  assert.equal(m2.relativeValuation.status, 'not-applicable');
  // Valuation 은 있으나 Sensitivity 가 없는 경우: 선택 section 은 unavailable
  const noSens = inputOf({ ...noRel, sensitivityResult: null });
  assert.equal(modelOf(noSens).sensitivity.status, 'unavailable');
  assert.ok(validateReportInput(noSens).warnings.some((w) => w.code === 'sensitivity-unavailable'));
});

test('8. 검증: Historical · Valuation · 가정 · 단위 · WACC > g · 핵심 결과가 없으면 Report 를 만들지 않는다', () => {
  const base = inputOf();
  const codes = (i: ReportInput) => validateReportInput(i).errors.map((e) => e.code);
  assert.deepEqual(codes(base), []);
  assert.deepEqual(codes({ ...base, historical: null }), ['no-historical']);
  assert.ok(codes({ ...base, valuationResult: null }).includes('no-valuation-result'));
  assert.ok(codes({ ...base, assumptions: null }).includes('no-assumptions'));
  assert.ok(codes({ ...base, assumptions: { ...base.assumptions!, beta: undefined } }).includes('assumptions-incomplete'));
  assert.ok(codes({ ...base, company: null }).includes('no-company'));
  assert.ok(codes({ ...base, support: { status: 'unsupported', reason: '금융업' } }).includes('unsupported-company'));
  const unit = structuredClone(base); (unit.historical!.company as { unit: string }).unit = 'billion';
  assert.ok(codes(unit).includes('unit-missing'));
  assert.ok(codes({ ...base, schemaVersion: '0.9' as never }).includes('schema-mismatch'));
  assert.ok(codes({ ...base, valuationResult: { ...base.valuationResult!, enterpriseValue: NaN } }).includes('missing-critical-result'));
  const bad = structuredClone(base); (bad.assumptions as { terminalGrowth: number }).terminalGrowth = bad.valuationResult!.wacc + 0.01;
  assert.deepEqual(codes(bad), ['invalid-wacc-g']);
  const blocked = buildReport(bad);
  assert.deepEqual([blocked.status, blocked.model], ['blocked', null]);
  assert.match(blocked.validation.errors[0]!.message, /WACC\(\d+\.\d+%\)가 영구성장률/);
  // 학습용 가정 · fixture 는 error 가 아니라 경고
  assert.ok(validateReportInput(base).warnings.some((w) => w.code === 'learning-assumptions'));
});

test('9. 재계산 금지: 입력의 결과 값을 그대로 옮기고, Report 코드는 엔진 계산 함수를 호출하지 않는다', () => {
  const input = structuredClone(inputOf());
  // 가정과 모순되는 sentinel 값: 다시 계산하면 사라진다
  input.valuationResult!.enterpriseValue = 123456.789;
  input.valuationResult!.wacc = 0.0777;
  input.valuationResult!.perShareValue = 4321.5;
  input.historicalAnalysis!.metrics.operatingMargin.values[2] = 0.4242;
  input.reviewMetrics!.terminalValueContribution = 0.5151;
  const m = modelOf(input);
  assert.equal(m.executiveSummary.headline.enterpriseValue.value, 123456.789);
  assert.equal(m.executiveSummary.headline.wacc.value, 0.0777);
  assert.equal(m.wacc.wacc.value, 0.0777);
  assert.equal(m.dcf.bridge.find((b) => b.key === 'perShareValue')!.cell.value, 4321.5);
  assert.equal(m.historicalPerformance.rows.find((r) => r.key === 'operatingMargin')!.cells[2]!.value, 0.4242);
  assert.equal(m.dcf.tvContribution.value, 0.5151);
  // 정적 검사: 계산 함수 호출은 input.ts(엔진 산출물 수집) 한 곳뿐이다
  const FORBIDDEN = /\b(runValuation|runSensitivity|runScenarios?|calculateWacc|calculateCostOfEquity|calculateRelativeValuation|analyzeHistorical|buildValidationView|buildSensitivityView|buildScenarioView|buildDcfView|terminalValueContribution)\s*\(/;
  const dir = new URL('.', import.meta.url).pathname;
  const files = ['buildReport.ts', 'units.ts', 'sources.ts', 'model.ts', 'types.ts', ...readdirSync(`${dir}sections`).map((f) => `sections/${f}`), 'validation/validate.ts', 'export/snapshot.ts'];
  for (const f of files) assert.ok(!FORBIDDEN.test(readFileSync(`${dir}${f}`, 'utf8').replace(/\/\/.*$/gm, '')), `${f} 가 엔진 계산 함수를 호출한다`);
  const inputSrc = readFileSync(`${dir}input.ts`, 'utf8');
  assert.ok(!/\brunValuation\s*\(/.test(inputSrc) && /buildValidationView\(/.test(inputSrc), 'input.ts 는 Validation view 만 수집하고 runValuation 을 호출하지 않는다');
  // buildReportInput 은 Valuation 결과를 새로 만들지 않는다
  assert.equal(inputOf(withValuationReset(full())).valuationResult, null);
});

test('10. AI narrative: 검증을 통과한 claim 문장만 쓰고 새 문장 · 새 숫자를 만들지 않는다', () => {
  const base = inputOf();
  const input = inputOf(full(), aiFor(base));
  const m = modelOf(input);
  const claimTexts = new Set(input.aiAnalysis!.claims.map((c) => c.text));
  const all = [m.executiveSummary.narrative, m.historicalPerformance.narrative, m.keyRisks.narrative, m.conclusion.narrative];
  for (const n of all) if (n.status === 'ok') for (const it of n.data.items) assert.ok(claimTexts.has(it.text), `AI 가 쓴 claim 문장만: ${it.text}`);
  const ok = (n: (typeof all)[number]) => (n.status === 'ok' ? n.data : null)!;
  const summary = ok(m.executiveSummary.narrative);
  assert.deepEqual(summary.items.map((i) => i.claimId), ['c1', 'c2', 'c6'].filter((id) => id !== 'c6').concat(['c8']), 'supported + 추적 가능한 fact · interpretation 만 (c3 partial · c4 unsupported · c6 근거 없음 제외)');
  assert.equal(summary.excludedClaims, 3);
  assert.equal(summary.groundingLevel, 'claim-evidence');
  assert.deepEqual(summary.items.map((i) => i.basis), ['objective', 'judgment', 'objective'], 'Fact / Judgment 구분이 보존된다');
  assert.deepEqual(ok(m.keyRisks.narrative).items.map((i) => i.claimId), ['c5']);
  assert.deepEqual(ok(m.conclusion.narrative).items.map((i) => i.claimId), ['c7']);
  assert.deepEqual(m.appendix.aiLimitations, ['D&A 데이터는 제공되지 않는다.']);
  // 이전 Project 상태 기준의 AI 분석은 쓰지 않는다
  const stale = modelOf(inputOf(full(), aiFor(base, { contextSnapshotId: 'ctx-old' })));
  assert.equal(stale.executiveSummary.narrative.status, 'unavailable');
  assert.match((stale.executiveSummary.narrative as { reason: string }).reason, /다른 Project 상태/);
  assert.ok(validateReportInput(inputOf(full(), aiFor(base, { contextSnapshotId: 'ctx-old' }))).warnings.some((w) => w.code === 'ai-analysis-stale'));
  // AI 가 없어도 deterministic Report 는 만들어진다
  const none = modelOf(base);
  assert.equal(none.executiveSummary.narrative.status, 'unavailable');
  assert.ok(none.executiveSummary.headline.enterpriseValue.state === 'ok');
});

test('11. 출처 전파: 모든 Cell · narrative 의 출처 id 가 sources 에 있고, 외부 근거는 provider 등급 · 기준 시점을 유지한다', () => {
  const base = inputOf();
  const m = modelOf(inputOf(full(), aiFor(base)));
  const ids = new Set(m.sources.map((s) => s.id));
  for (const c of cellsOf(m)) assert.ok(c.sourceId === null || ids.has(c.sourceId), `알 수 없는 출처 ${c.sourceId}`);
  const narr = [m.executiveSummary.narrative, m.keyRisks.narrative].flatMap((n) => (n.status === 'ok' ? n.data.items : []));
  for (const it of narr) assert.ok(it.sourceIds.length > 0 && it.sourceIds.every((s) => ids.has(s)));
  const market = m.sources.find((s) => s.kind === 'market')!;
  assert.deepEqual([market.origin, market.reliability, market.asOf], ['yahoo-finance', 'unofficial · development', '2026-10-07T03:00:00+00:00']);
  assert.equal(m.metadata.snapshot.marketAsOf, '2026-10-07T03:00:00+00:00');
  assert.ok(m.metadata.sourceSummary.length === m.sources.length);
  // Report 가 만든 출처는 입력에 근거가 있는 것뿐이다: AI 근거가 없으면 외부 출처가 없다
  assert.equal(modelOf(base).sources.filter((s) => s.kind === 'market' || s.kind === 'news' || s.kind === 'document').length, 0);
});

test('12. Project state mutation 없음: 입력 · Report 생성이 Project 와 AI 입력을 바꾸지 않는다', () => {
  const p = full();
  const before = JSON.stringify(p);
  const ai = aiFor(inputOf(p));
  const aiBefore = JSON.stringify(ai);
  const input = buildReportInput(p, { now: NOW, aiAnalysis: ai });
  buildReport(input);
  validateReportInput(input);
  assert.equal(JSON.stringify(p), before);
  assert.equal(JSON.stringify(ai), aiBefore);
  // 입력 객체를 바꿔도 AI 입력 · Project 에 영향이 없다
  input.aiAnalysis!.claims[0]!.text = '변조';
  input.historical!.incomeStatement.revenue[0] = 1;
  assert.equal(JSON.stringify(ai), aiBefore);
  assert.equal(JSON.stringify(p), before);
});

test('13. 버전: schemaVersion 1.0 snapshot 을 직렬화 · 복원하고 알 수 없는 버전은 해석하지 않는다', () => {
  const m = modelOf(inputOf());
  assert.equal(m.schemaVersion, '1.0');
  assert.equal(m.metadata.schemaVersion, '1.0');
  const back = parseReport(serializeReport(m));
  assert.ok(back.ok && JSON.stringify(back.model) === JSON.stringify(m));
  const future = parseReport(JSON.stringify({ ...m, schemaVersion: '2.0' }));
  assert.deepEqual(future, { ok: false, reason: 'unsupported-schema', schemaVersion: '2.0' });
  assert.deepEqual(parseReport('{not json'), { ok: false, reason: 'invalid-json' });
  assert.match(m.metadata.reportId, /^rpt-[0-9a-f]{8}$/);
  assert.equal(m.metadata.valuationDate, '2026-10-08');
  assert.equal(m.metadata.reportTitle, `${m.metadata.company.name} Valuation Report`);
});

test('14. 평균 가치를 만들지 않는다: Valuation Range 는 low / base / high 와 방법별 범위만 담는다', () => {
  const m = modelOf(inputOf());
  assert.equal(m.executiveSummary.range.status, 'ok');
  const r = (m.conclusion.range as { status: 'ok'; data: NonNullable<ReturnType<typeof Object>> }).data as unknown as { low: unknown; base: unknown; high: unknown; spans: { source: string }[]; disclaimer: string };
  assert.deepEqual(Object.keys(r).sort(), ['base', 'disclaimer', 'high', 'low', 'spans']);
  assert.ok(r.spans.map((s) => s.source).every((s) => ['Sensitivity', 'Scenario', 'Relative'].includes(s)));
  assert.match(r.disclaimer, /범위와 차이/);
});
