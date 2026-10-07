// STEP 08-1: AI Valuation Analyst 아키텍처 — context · tool catalog · tool adapter · answer contract · guardrails. (LLM 호출 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_POLICY_RULES, CAPABILITIES, SYSTEM_POLICY, TOOL_CATALOG, TOOL_NAMES, UNSUPPORTED_DISCLOSURE, auditAnswer, buildAiContext, classifyQuestion, createAuditEvent,
  executeTool, getToolDefinition, validateToolInput, type AiAnalystAnswer, type AiValuationContext, type ToolResult,
} from './index.ts';
import {
  emptyProjectState, withAssumptions, withHistoricalLoaded, withPracticeAssumptions, withRelativeInputs, withSamsungHistorical, withSelectedCompany, withSensitivityRun, withValuationRun, type ProjectState,
} from '../store/projectModel.ts';
import type { HistoricalLoadStatus } from '../store/historicalLoad.ts';
import { step04PracticeAssumptions } from '../data/step04PracticeAssumptions.ts';
import type { SelectedCompany } from '../data/types.ts';

const golden = (n: string) => JSON.parse(readFileSync(new URL(`../../backend/tests/golden/${n}.json`, import.meta.url), 'utf8')).expected;
const AT = '2026-10-07T01:02:03+00:00';
const company = (name: string, corpCode: string): SelectedCompany => ({ corpCode, corpName: name, corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT });
const RELATIVE = { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 };

/** 실제 삼성전자 / 현대차 정규화 결과(golden)를 DB 에서 불러온 것처럼 Historical 로 설정 */
function live(name: 'samsung' | 'hyundai' | 'syn-weak-ap-ar' = 'samsung'): ProjectState {
  const g = golden(name);
  return withHistoricalLoaded(withSelectedCompany(emptyProjectState, company('삼성전자', '00126380')), {
    data: g.data, quality: g.quality,
    provenance: { source: 'database', persisted: true, fetchedAt: AT, fetchId: '7', corpCode: '00126380', fiscalYears: [2023, 2024, 2025] },
  });
}
const withValuation = (s: ProjectState) => withRelativeInputs(withPracticeAssumptions(s), RELATIVE);
const ctxOf = (s: ProjectState, status?: HistoricalLoadStatus): AiValuationContext => buildAiContext(s, { historicalStatus: status });
const failedUnsupported = (code: 'unsupported-industry' | 'unsupported-structure'): HistoricalLoadStatus => ({
  kind: 'failed', refresh: false, failure: { kind: 'unsupported', code, message: '금융업(은행 · 보험 · 증권) 재무제표 구조는 아직 지원하지 않습니다.', quality: null },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (r: ToolResult<unknown>): any => { assert.equal(r.status, 'ok', JSON.stringify(r).slice(0, 300)); return (r as { data: unknown }).data; };

function walkNumbers(o: unknown, path: string, bad: string[]): void {
  if (typeof o === 'number' && !Number.isFinite(o)) bad.push(`${path}=${o}`);
  else if (Array.isArray(o)) o.forEach((v, i) => walkNumbers(v, `${path}[${i}]`, bad));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walkNumbers(v, `${path}.${k}`, bad);
}

// 1. AI Context 생성
test('AI context: 현재 Project State 에서 만들어지고 Raw 행 전체를 담지 않는다', () => {
  const ctx = ctxOf(withValuation(live()));
  assert.deepEqual(ctx.company, { name: 't', corpCode: '00126380', stockCode: '000001', basis: 'Consolidated' });
  assert.deepEqual(ctx.support, { status: 'supported' });
  assert.equal(ctx.historicalAnalysis?.periods.length, 3);
  assert.equal(ctx.historicalProvenance?.source, 'database');
  assert.ok(ctx.valuationResult && ctx.sensitivityResult);
  assert.deepEqual(ctx.relativeInputs, RELATIVE);
  for (const key of ['accounts', 'rawAccounts', 'rows']) assert.ok(!(key in ctx), `context 에 ${key} 가 없다`);
  assert.ok(!JSON.stringify(ctx).includes('thstrm_amount'), 'OpenDART 원본 행이 prompt 로 들어가지 않는다');
  const empty = ctxOf(emptyProjectState);
  assert.deepEqual([empty.company, empty.support, empty.historicalAnalysis, empty.dataKinds.historical], [null, { status: 'no-data' }, null, 'none']);
  assert.equal(ctxOf(withSelectedCompany(emptyProjectState, company('삼성전자', '00126380'))).company?.name, '삼성전자');
});

// 2. Actual / Assumption 구분
test('Actual / Assumption / Calculated 가 context 와 Tool 출처에서 구분된다', () => {
  const lv = ctxOf(withValuation(live()));
  assert.deepEqual(lv.dataKinds, { historical: 'actual', assumptions: 'learning', results: 'calculated' });
  assert.equal(ctxOf(withSamsungHistorical(emptyProjectState)).dataKinds.historical, 'fixture');
  const g = golden('samsung');
  const user = ctxOf(withSensitivityRun(withValuationRun(withAssumptions(withHistoricalLoaded(emptyProjectState, { data: g.data, quality: g.quality, provenance: { source: 'database', persisted: true } }), { ...step04PracticeAssumptions, cash: 99 }))));
  assert.equal(user.dataKinds.assumptions, 'user');
  const kinds = (r: ToolResult<unknown>) => r.sources.map((s) => s.kind);
  assert.deepEqual(kinds(executeTool('getHistoricalAnalysis', lv)), ['actual']);
  assert.deepEqual(kinds(executeTool('getForecastAssumptions', lv)).sort(), ['actual', 'assumption']);
  assert.deepEqual(kinds(executeTool('getValuationResult', lv)).sort(), ['assumption', 'calculated']);
  assert.equal(executeTool('getValuationResult', lv).sources.find((s) => s.kind === 'assumption')!.origin, 'learning-fixture');
  assert.equal(executeTool('getValuationResult', user).sources.find((s) => s.kind === 'assumption')!.origin, 'user-input');
});

// 3. Historical tool
test('getHistoricalAnalysis: 지표 · 추세 · 품질을 구조화해서 돌려준다 (다시 계산하지 않는다)', () => {
  const ctx = ctxOf(live());
  const d = data(executeTool('getHistoricalAnalysis', ctx));
  assert.deepEqual(d.periods, ['2023A', '2024A', '2025A']);
  assert.deepEqual(d.metrics.revenueGrowth.values.map((v: number | null) => (v === null ? null : (v * 100).toFixed(1))), [null, '16.2', '10.9']);
  assert.deepEqual(d.metrics.operatingMargin.values.map((v: number) => (v * 100).toFixed(1)), ['2.5', '10.9', '13.1']);
  assert.equal(d.metrics.operatingMargin.status, 'available');
  assert.deepEqual([d.trends.revenueGrowth.direction, d.trends.operatingMargin.direction, d.trends.nwc.direction], ['decelerating', 'improving', 'increasing']);
  assert.match(d.metrics.capex.basis, /PPE only/);
  assert.match(d.capexBasis, /PPE only/);
  assert.ok(d.revenueCagr > 0.13 && d.revenueCagr < 0.14);
  assert.match(d.trendThresholds.note, /heuristic/);
  const only = data(executeTool('getHistoricalAnalysis', ctx, { metrics: ['nwc', 'capex'] }));
  assert.deepEqual(Object.keys(only.metrics), ['nwc', 'capex']);
  assert.equal(executeTool('getHistoricalAnalysis', ctx, { metrics: ['bogus'] }).status, 'invalid-input');
  assert.equal(executeTool('getHistoricalAnalysis', ctxOf(emptyProjectState)).status, 'unavailable');
});

// 4. Quality tool
test('getHistoricalQuality: 필드 상태 · 검토 필요 · 데이터 노트 · provenance', () => {
  const d = data(executeTool('getHistoricalQuality', ctxOf(live('hyundai'))));
  assert.equal(d.fields.find((f: { field: string }) => f.field === 'depreciationAmortization').status, 'missing');
  assert.equal(d.fields.find((f: { field: string }) => f.field === 'revenue').status, 'available');
  assert.ok(d.reviewRequired.some((t: string) => t.includes('financial-business')));
  assert.ok(d.dataNotes.some((t: string) => t.startsWith('D&A not available')));
  assert.deepEqual([d.provenance.source, d.provenance.persisted, d.provenance.fetchedAt, d.provenance.basis], ['database', true, AT, 'Consolidated']);
  const fx = executeTool('getHistoricalQuality', ctxOf(withSamsungHistorical(emptyProjectState)));
  assert.equal(fx.status, 'unavailable');
  assert.match((fx as { reason: string }).reason, /No DataQuality/);
});

// 5. MappingTrace tool
test('getMappingTrace: 대표 계정의 출처를 추적하고, weak / 누락 계정을 구분한다', () => {
  const ctx = ctxOf(live());
  const rev = data(executeTool('getMappingTrace', ctx, { field: 'revenue', fiscalYear: 2025 }));
  assert.equal(rev.entries.length, 1);
  assert.deepEqual([rev.entries[0].sourceAccountName, rev.entries[0].sourceAccountId, rev.entries[0].matchType, rev.entries[0].basis, rev.entries[0].value], ['매출액', 'ifrs-full_Revenue', 'account-id', 'CFS', 333605938]);
  assert.equal(rev.missing, null);
  assert.equal(data(executeTool('getMappingTrace', ctx, { field: 'revenue' })).entries.length, 3);
  const debt = data(executeTool('getMappingTrace', ctx, { field: 'interestBearingDebt', fiscalYear: 2025 }));
  assert.equal(debt.entries[0].matchType, 'sum');
  assert.ok(debt.entries[0].components.length >= 3);
  const da = data(executeTool('getMappingTrace', ctx, { field: 'depreciationAmortization' }));
  assert.deepEqual([da.status, da.entries.length, da.missing.status, da.missing.value], ['missing', 0, 'missing', null]);
  assert.match(da.missing.reason, /Not available from current OpenDART financial statement source/);
  const weak = data(executeTool('getMappingTrace', ctxOf(live('syn-weak-ap-ar')), { field: 'accountsPayable', fiscalYear: 2025 }));
  assert.deepEqual([weak.entries[0].sourceAccountName, weak.entries[0].matchType, weak.status], ['매입채무및기타채무', 'weak', 'ambiguous']);
  assert.equal(executeTool('getMappingTrace', ctx, { field: 'nonsense' }).status, 'invalid-input');
  assert.equal(executeTool('getMappingTrace', ctx, {}).status, 'invalid-input');
  assert.equal(executeTool('getMappingTrace', ctxOf(withSamsungHistorical(emptyProjectState)), { field: 'revenue' }).status, 'unavailable');
});

// 6. Forecast tool
test('getForecastAssumptions: 가정과 출처, 과거 대비 비교(차이는 Tool 이 계산)', () => {
  const s = withValuation(live());
  const d = data(executeTool('getForecastAssumptions', ctxOf(s)));
  assert.equal(d.basis, 'learning');
  assert.equal(d.complete, true);
  assert.deepEqual(d.forecast.revenueGrowth, [0.08, 0.06, 0.04]);
  const hist = golden('samsung').data.incomeStatement.revenue;
  const latest = hist[2] / hist[1] - 1;
  assert.ok(Math.abs(d.historicalComparison.revenueGrowth.historicalLatest - latest) < 1e-12);
  d.historicalComparison.revenueGrowth.forecastMinusLatest.forEach((x: number, i: number) => assert.ok(Math.abs(x - ([0.08, 0.06, 0.04][i] - latest)) < 1e-12));
  assert.equal(d.historicalComparison.depreciationHistory.status, 'missing');
  assert.deepEqual(d.units, { amounts: '억원', ratios: '소수 (8% = 0.08)', sharesOutstanding: '주' });
  const partial = ctxOf(withAssumptions(live(), { beta: 1.1 }));
  const p = data(executeTool('getForecastAssumptions', partial));
  assert.equal(p.complete, false);
  assert.deepEqual(p.wacc.riskFreeRate, { status: 'missing', value: null, reason: 'Not entered.' });
  assert.equal(p.wacc.beta, 1.1);
  assert.ok(p.missingInputs.forecast.length > 0);
  assert.equal(executeTool('getForecastAssumptions', ctxOf(live())).status, 'unavailable');
  d.forecast.revenueGrowth[0] = 9; // Tool 결과를 바꿔도 context / 가정은 그대로
  assert.deepEqual(data(executeTool('getForecastAssumptions', ctxOf(s))).forecast.revenueGrowth, [0.08, 0.06, 0.04]);
});

// 7. Valuation tool
test('getValuationResult: 엔진 결과를 그대로 구조화해서 돌려주고 경고를 함께 전달한다', () => {
  const s = withValuation(live());
  const r = s.valuationResult!;
  const d = data(executeTool('getValuationResult', ctxOf(s)));
  assert.deepEqual([d.enterpriseValue, d.equityValue, d.perShareValue, d.wacc, d.netDebt], [r.enterpriseValue, r.equityValue, r.perShareValue, r.wacc, r.netDebt]);
  assert.equal(d.terminalGrowth, 0.02);
  assert.ok(d.tvContribution > 0 && d.tvContribution < 1);
  assert.ok(Math.abs(d.spread - (r.wacc - 0.02)) < 1e-12);
  assert.deepEqual(d.fcff, r.fcff);
  assert.deepEqual(d.units, { amounts: '억원', perShareValue: '원', ratios: '소수' });
  assert.match(d.disclaimer, /보장된 적정가치가 아닙니다/);
  assert.ok(Math.abs(d.enterpriseValue - 2345.56) < 0.01, '학습용 가정 기준 EV');
  assert.equal(executeTool('getValuationResult', ctxOf(live())).status, 'unavailable');
  const failed = ctxOf({ ...withAssumptions(live(), { ...step04PracticeAssumptions, terminalGrowth: 0.2 }), valuationError: 'WACC 가 영구성장률 이하입니다.' });
  const f = executeTool('getValuationResult', failed);
  assert.equal(f.status, 'unavailable');
  assert.match((f as { reason: string }).reason, /Valuation failed/);
});

// 8. Sensitivity tool
const valuationOnly = () => withValuationRun(withAssumptions(live(), { ...step04PracticeAssumptions }));
test('getSensitivityAnalysis: Base 와 분석 범위를 구분해서 전달한다', () => {
  const d = data(executeTool('getSensitivityAnalysis', ctxOf(withValuation(live()))));
  assert.deepEqual([d.base.wacc.toFixed(6), d.base.terminalGrowth, d.base.inGrid], ['0.081375', 0.02, true]);
  assert.deepEqual([d.range.waccMin, d.range.waccMax, d.range.terminalGrowthMin, d.range.terminalGrowthMax], [0.075, 0.09, 0.01, 0.03]);
  assert.equal(d.rows.length, 5);
  assert.equal(d.rows[0].cells.length, 5);
  assert.equal(d.rows.flatMap((r: { cells: { isBaseCase: boolean }[] }) => r.cells).filter((c: { isBaseCase: boolean }) => c.isBaseCase).length, 1);
  assert.ok(d.enterpriseValueRange.max > d.enterpriseValueRange.min);
  assert.deepEqual(d.directionNotes, ['WACC ↑ → Value ↓', 'Terminal Growth ↑ → Value ↑']);
  assert.equal(executeTool('getSensitivityAnalysis', ctxOf(valuationOnly())).status, 'unavailable');
});

// 9. Scenario tool
test('getScenarioAnalysis: Bear / Base / Bull 가정과 결과, Equity 범위', () => {
  const d = data(executeTool('getScenarioAnalysis', ctxOf(withValuation(live()))));
  assert.deepEqual(d.columns.map((c: { id: string }) => c.id), ['bear', 'base', 'bull']);
  const eq = Object.fromEntries(d.columns.map((c: { id: string; equityValue: number }) => [c.id, c.equityValue]));
  assert.ok(eq.bear < eq.base && eq.base < eq.bull);
  assert.equal(d.columns.find((c: { id: string }) => c.id === 'base').assumptions.terminalGrowth, 0.02);
  assert.ok(d.columns.every((c: { ok: boolean; error: unknown }) => c.ok && c.error === null));
  assert.deepEqual([d.equityRange.min, d.equityRange.max], [eq.bear, eq.bull]);
  assert.match(d.note, /예측이 아닙니다/);
  assert.equal(executeTool('getScenarioAnalysis', ctxOf(live())).status, 'unavailable');
});

// 10. Relative tool
test('getRelativeValuation: 상대가치 결과 · DCF 와의 차이, 입력이 없으면 incomplete', () => {
  const d = data(executeTool('getRelativeValuation', ctxOf(withValuation(live()))));
  assert.deepEqual(d.rows.map((r: { method: string }) => r.method), ['DCF', 'PER', 'PBR', 'EV/EBITDA']);
  assert.ok(d.rows.every((r: { status: string }) => r.status === 'ok'));
  assert.equal(d.rows.find((r: { method: string }) => r.method === 'PER').equityValue, 150 * 12);
  assert.equal(d.rows.find((r: { method: string }) => r.method === 'EV/EBITDA').enterpriseValue, 220 * 10);
  assert.ok(d.maxDivergence > 0);
  assert.match(d.inputsSource, /user-input/);
  assert.match(d.disclaimer, /범위와 차이/);
  const none = data(executeTool('getRelativeValuation', ctxOf(withPracticeAssumptions(live()))));
  assert.deepEqual(none.rows.filter((r: { method: string }) => r.method !== 'DCF').map((r: { status: string }) => r.status), ['incomplete', 'incomplete', 'incomplete']);
  assert.equal(none.equityRange, null);
  assert.equal(none.maxDivergence, null);
});

// 11. missing 유지
test('Missing: D&A 와 누락 지표는 null / missing 으로 유지되고 채워지지 않는다', () => {
  const ctx = ctxOf(live());
  const d = data(executeTool('getHistoricalAnalysis', ctx));
  assert.deepEqual(d.depreciation, { status: 'missing', value: null, reason: 'Not available from current OpenDART financial statement source.' });
  assert.ok(d.metrics.depreciation.values.every((v: unknown) => v === null));
  assert.equal(d.metrics.depreciation.status, 'missing');
  assert.equal(d.trends.depreciation.direction, 'unavailable');
  const g = golden('samsung');
  const q = structuredClone(g.quality);
  q.fields.inventory.status = 'missing';
  const missingInv = ctxOf(withHistoricalLoaded(emptyProjectState, { data: g.data, quality: q, provenance: { source: 'database', persisted: true } }));
  const m = data(executeTool('getHistoricalAnalysis', missingInv)).metrics;
  for (const k of ['nwc', 'deltaNwc', 'nwcToRevenue']) {
    assert.equal(m[k].status, 'missing', k);
    assert.deepEqual(m[k].missing, { status: 'missing', value: null, reason: 'Required input accounts are missing, so this metric is not computed.' });
    assert.ok(m[k].values.every((v: unknown) => v === null));
  }
  assert.equal(m.operatingMargin.status, 'available');
});

// 12. unsupported
test('Unsupported 기업: 분석 가능한 척하지 않고 Tool 호출을 제한한다 (개요만 허용)', () => {
  const s = withSelectedCompany(withValuation(live()), company('NAVER', '00266961'));
  const ctx = ctxOf(s, failedUnsupported('unsupported-structure'));
  assert.deepEqual([ctx.support.status, (ctx.support as { code: string }).code], ['unsupported', 'unsupported-structure']);
  assert.equal((ctx.support as { message: string }).message, 'This company is not supported by the current generic analysis model.');
  assert.deepEqual([ctx.company?.name, ctx.historicalData, ctx.historicalAnalysis, ctx.valuationResult, ctx.sensitivityResult, ctx.valuationAssumptions], ['NAVER', null, null, null, null, null]);
  assert.equal(ctx.dataKinds.results, 'none');
  const overview = executeTool('getCompanyOverview', ctx);
  assert.equal(overview.status, 'ok');
  assert.equal(data(overview).support.status, 'unsupported');
  assert.ok(overview.warnings.some((w) => w.level === 'review' && w.text.includes('not supported')));
  // frontend 에서 실행되는 Tool 은 모두 제한된다 (backend Tool 은 gateway 가 같은 규칙으로 막는다: backend 테스트)
  for (const def of TOOL_CATALOG.filter((t) => t.name !== 'getCompanyOverview' && t.execution === 'frontend')) {
    const r = executeTool(def.name, ctx, def.name === 'getMappingTrace' ? { field: 'revenue' } : {});
    assert.equal(r.status, 'unsupported', def.name);
    assert.equal(r.status === 'unsupported' && r.message, 'This company is not supported by the current generic analysis model.');
    assert.ok(r.warnings.some((w) => w.code === 'unsupported-company'));
    assert.deepEqual(r.sources, []);
  }
  for (const code of ['unsupported-industry', 'unsupported-structure'] as const) assert.equal((ctxOf(s, failedUnsupported(code)).support as { code: string }).code, code);
  assert.equal(ctxOf(live(), { kind: 'failed', refresh: false, failure: { kind: 'unavailable', message: 'x', quality: null } }).support.status, 'supported');
  const results = [executeTool('getHistoricalAnalysis', ctx)];
  const bad: AiAnalystAnswer = { mode: 'explain', summary: '성장률이 둔화되었습니다.', evidence: [], warnings: [], sources: [], suggestedNextActions: [] };
  assert.ok(auditAnswer(bad, results).some((v) => v.code === 'unsupported-not-disclosed'));
  const good = { ...bad, summary: `${UNSUPPORTED_DISCLOSURE} 분석을 진행하지 않습니다.`, warnings: results[0].warnings.map((w) => w.text) };
  assert.deepEqual(auditAnswer(good, results), []);
});

// 13·14. warning · source / basis 전파
test('경고와 출처 · 기준이 Tool 결과로 전파된다', () => {
  const hy = ctxOf(withValuation(live('hyundai')));
  const warnText = (r: ToolResult<unknown>) => r.warnings.map((w) => w.text);
  for (const name of ['getHistoricalAnalysis', 'getHistoricalQuality', 'getForecastAssumptions']) {
    assert.ok(executeTool(name, hy).warnings.some((w) => w.level === 'review' && w.text.includes('financial-business')), `${name}: 금융 자회사 경고`);
  }
  assert.ok(warnText(executeTool('getHistoricalAnalysis', hy)).some((t) => t.startsWith('D&A not available')));
  assert.equal(executeTool('getHistoricalAnalysis', hy).warnings.find((w) => w.text.startsWith('D&A not available'))!.level, 'note');
  for (const name of ['getValuationResult', 'getSensitivityAnalysis', 'getScenarioAnalysis', 'getRelativeValuation', 'getForecastAssumptions']) {
    assert.ok(executeTool(name, hy).warnings.some((w) => w.code === 'learning-assumptions' && w.level === 'review'), `${name}: 학습용 가정 경고`);
  }
  assert.ok(warnText(executeTool('getHistoricalAnalysis', ctxOf(withSamsungHistorical(emptyProjectState)))).some((t) => t.includes('학습용 fixture')));
  const src = executeTool('getHistoricalAnalysis', ctxOf(live())).sources[0];
  assert.deepEqual([src.kind, src.origin, src.basis, src.fetchedAt, src.persisted, src.note], ['actual', 'database', 'Consolidated', AT, true, null]);
  const fxSrc = executeTool('getHistoricalAnalysis', ctxOf(withSamsungHistorical(emptyProjectState))).sources[0];
  assert.deepEqual([fxSrc.origin, fxSrc.fetchedAt], ['fixture', null]);
  assert.match(fxSrc.note!, /학습용 fixture/);
  assert.equal(executeTool('getValuationResult', ctxOf(withValuation(live()))).sources.find((s) => s.kind === 'calculated')!.origin, 'valuation-engine');
  const sepBasis = golden('syn-separate-only');
  const sep = ctxOf(withHistoricalLoaded(emptyProjectState, { data: sepBasis.data, quality: sepBasis.quality, provenance: { source: 'opendart', persisted: false, fetchedAt: AT } }));
  const sepSrc = executeTool('getHistoricalAnalysis', sep).sources[0];
  assert.deepEqual([sepSrc.origin, sepSrc.basis, sepSrc.persisted], ['opendart', 'Separate', false]);
  assert.ok(warnText(executeTool('getHistoricalQuality', sep)).some((t) => t.startsWith('Separate statements used')));
  // 답변 가드레일
  const results = [executeTool('getHistoricalAnalysis', hy), executeTool('getHistoricalQuality', hy)];
  const answer: AiAnalystAnswer = {
    mode: 'quality', summary: '현대자동차 Historical 의 품질을 요약합니다.',
    evidence: [{ label: 'Operating Margin 2025', value: '6.2%', period: '2025A', tool: 'getHistoricalAnalysis' }], warnings: [], sources: [], suggestedNextActions: [],
  };
  const codes = auditAnswer(answer, results).map((v) => v.code);
  assert.ok(codes.includes('missing-warning') && codes.includes('missing-sources'));
  const fixed = { ...answer, warnings: [...new Set(results.flatMap((r) => r.warnings).filter((w) => w.level === 'review').map((w) => w.text))], sources: results[0].sources };
  assert.deepEqual(auditAnswer(fixed, results), []);
  assert.ok(auditAnswer({ ...fixed, evidence: [{ ...answer.evidence[0], tool: 'getValuationResult' }] }, results).some((v) => v.code === 'unknown-tool'));
  assert.ok(auditAnswer({ ...fixed, summary: ' ' }, results).some((v) => v.code === 'empty-summary'));
});

// 15. private module import 금지
test('AI 코드는 valuation 내부 파일을 직접 import 하지 않는다 (공개 API / engine / store 만 사용)', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const root = new URL('.', import.meta.url).pathname;
  const files = walk(root).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const target = m[1];
      // 폴더 밖의 valuation 은 공개 API(valuation/index.ts)만 허용한다 (ai/tools/valuation.ts 같은 자기 폴더 파일은 해당 없음)
      if (target.startsWith('../') && /valuation/.test(target)) assert.match(target, /(^|\/)valuation\/index\.ts$/, `${f}: ${target}`);
      assert.ok(!/engine\/(dcf|analysis)\.ts$/.test(target), `${f}: LEARN 계산기를 직접 쓰지 않는다 (${target})`);
      assert.ok(!/opendart|fnltt|sqlalchemy|DATABASE_URL/i.test(target), `${f}: ${target}`);
    }
    // 네트워크는 backend AI Gateway 를 부르는 client.ts 에만 있다. LLM provider 는 어디에도 직접 호출하지 않는다 (API Key 는 backend 에만).
    const code = src.replace(/\/\/.*$/gm, '');
    assert.ok(!/api\.openai|anthropic|OPENAI|sk-[A-Za-z0-9]/i.test(code), `${f}: LLM provider 를 직접 부르지 않는다`);
    if (!f.endsWith('/client.ts')) assert.ok(!/fetch\(|XMLHttpRequest/.test(code), `${f}: 네트워크 호출은 client.ts 에만 있다`);
  }
});

// 16. NaN / Infinity 없음, JSON 안전
test('모든 Tool 출력에 NaN / Infinity 가 없고 JSON 으로 그대로 직렬화된다', () => {
  const states: [string, ProjectState][] = [
    ['samsung+valuation', withValuation(live())], ['hyundai+valuation', withValuation(live('hyundai'))], ['fixture', withValuation(withSamsungHistorical(emptyProjectState))],
    ['historical only', live()], ['empty', emptyProjectState],
  ];
  for (const [label, s] of states) {
    const ctx = ctxOf(s);
    for (const def of TOOL_CATALOG.filter((x) => x.execution === 'frontend')) {
      const r = executeTool(def.name, ctx, def.name === 'getMappingTrace' ? { field: 'revenue', fiscalYear: 2025 } : {});
      const bad: string[] = [];
      walkNumbers(r, `${label}.${def.name}`, bad);
      assert.deepEqual(bad, []);
      assert.deepEqual(JSON.parse(JSON.stringify(r)), r, `${label}.${def.name}: undefined / 비직렬화 값 없음`);
    }
  }
});

// 17. 불변
test('context 생성과 Tool 실행은 원본 Project State 를 변경하지 않고, context 는 읽기 전용이다', () => {
  const s = withValuation(live());
  const snapshot = JSON.stringify(s);
  const ctx = ctxOf(s);
  for (const def of TOOL_CATALOG.filter((x) => x.execution === 'frontend')) executeTool(def.name, ctx, def.name === 'getMappingTrace' ? { field: 'revenue' } : {});
  assert.equal(JSON.stringify(s), snapshot);
  assert.notEqual(ctx.historicalData, s.historicalData, 'context 는 복사본이다');
  assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.historicalData) && Object.isFrozen(ctx.valuationResult));
  assert.throws(() => { (ctx.valuationResult as { enterpriseValue: number }).enterpriseValue = 1; }, TypeError);
  assert.throws(() => { (ctx.historicalData as { company: { name: string } }).company.name = 'x'; }, TypeError);
  const frozenState = structuredClone(s);
  Object.freeze(frozenState);
  assert.doesNotThrow(() => buildAiContext(frozenState));
});

// Tool catalog / 실행기
test('Tool catalog: 12개 Tool(frontend 9 + backend 3)이 이름 · 설명 · 입력/출력 schema 를 갖고, frontend Tool 은 모두 실행된다', () => {
  assert.deepEqual([...TOOL_NAMES], ['getCompanyOverview', 'getHistoricalAnalysis', 'getHistoricalQuality', 'getMappingTrace', 'getForecastAssumptions', 'getValuationResult', 'getSensitivityAnalysis', 'getScenarioAnalysis', 'getRelativeValuation', 'searchDisclosures', 'searchUploadedDocuments', 'searchKnowledge']);
  assert.equal(new Set(TOOL_NAMES).size, 12);
  assert.deepEqual(TOOL_CATALOG.filter((t) => t.execution === 'backend').map((t) => t.name), ['searchDisclosures', 'searchUploadedDocuments', 'searchKnowledge']);
  const ctx = ctxOf(withValuation(live()));
  for (const t of TOOL_CATALOG) {
    assert.ok(t.description.length > 20 && t.inputSchema.type === 'object' && t.outputSchema.type === 'object', t.name);
    assert.ok(Object.keys(t.outputSchema.properties ?? {}).length > 0, `${t.name} outputSchema`);
    const r = executeTool(t.name, ctx, t.name === 'getMappingTrace' ? { field: 'revenue' } : t.execution === 'backend' ? { query: '설비투자' } : undefined);
    // backend Tool 은 frontend 에서 실행하지 않는다 (값을 만들지 않고 안내)
    assert.equal(r.status, t.execution === 'backend' ? 'unavailable' : 'ok', t.name);
    assert.equal(r.tool, t.name);
  }
  assert.deepEqual(TOOL_CATALOG.filter((t) => t.allowedWhenUnsupported).map((t) => t.name), ['getCompanyOverview']);
  for (const name of ['getCompanyOverview', 'getValuationResult', 'getSensitivityAnalysis', 'getRelativeValuation']) {
    const def = getToolDefinition(name)!;
    const out = data(executeTool(name, ctx));
    for (const k of Object.keys(def.outputSchema.properties!)) assert.ok(k in out, `${name}.${k}`);
  }
  assert.equal(executeTool('doesNotExist', ctx).status, 'invalid-input');
  assert.equal(executeTool('getValuationResult', ctx, { x: 1 }).status, 'invalid-input');
  assert.equal(executeTool('getMappingTrace', ctx, { field: 'revenue', fiscalYear: 2025.5 }).status, 'invalid-input');
  assert.equal(validateToolInput(getToolDefinition('getMappingTrace')!.inputSchema, { field: 'revenue' }), null);
  assert.match(validateToolInput(getToolDefinition('getMappingTrace')!.inputSchema, {})!, /missing required/);
  assert.match(validateToolInput(getToolDefinition('getHistoricalAnalysis')!.inputSchema, { metrics: 'nwc' })!, /array/);
});

test('Capability 정의와 규칙 기반 질문 분류', () => {
  assert.deepEqual(CAPABILITIES.map((c) => c.id), ['historical', 'data-quality', 'forecast', 'valuation', 'sensitivity', 'scenario', 'relative', 'disclosure', 'knowledge']);
  for (const c of CAPABILITIES) { assert.ok(c.exampleQuestions.length > 0 && c.never.length > 0); for (const t of c.tools) assert.ok(TOOL_NAMES.includes(t), t); }
  const cls = (q: string) => classifyQuestion(q);
  assert.deepEqual([cls('최근 매출 성장률은?').capabilities, cls('최근 매출 성장률은?').mode], [['historical'], 'explain']);
  assert.equal(cls('영업이익률이 개선됐어?').capabilities[0], 'historical');
  assert.equal(cls('운전자본이 어떻게 변했어?').capabilities[0], 'historical');
  assert.deepEqual([cls('이 숫자는 믿을 만해?').mode, cls('이 숫자는 믿을 만해?').capabilities[0]], ['quality', 'data-quality']);
  assert.deepEqual([cls('매출 값의 출처가 뭐야?').mode, cls('매출 값의 출처가 뭐야?').suggestedTools.slice(0, 3)], ['source', ['getCompanyOverview', 'getHistoricalQuality', 'getMappingTrace']]);
  assert.equal(cls('현재 Forecast 가정 정리해줘.').capabilities[0], 'forecast');
  assert.deepEqual([cls('과거 성장률 대비 Forecast 가 공격적이야?').mode, cls('과거 성장률 대비 Forecast 가 공격적이야?').capabilities.includes('forecast')], ['diagnose', true]);
  assert.deepEqual([cls('현재 기업가치가 얼마야?').mode, cls('현재 기업가치가 얼마야?').capabilities[0]], ['valuation', 'valuation']);
  assert.equal(cls('WACC가 올라가면 얼마나 영향 있어?').capabilities[0], 'sensitivity');
  assert.deepEqual([cls('Bull/Bear 차이가 왜 커?').mode, cls('Bull/Bear 차이가 왜 커?').capabilities[0]], ['compare', 'scenario']);
  assert.deepEqual([cls('DCF와 PER 결과가 왜 달라?').mode, cls('DCF와 PER 결과가 왜 달라?').capabilities[0]], ['compare', 'relative']);
  const none = cls('안녕');
  assert.deepEqual([none.matched, none.mode, none.capabilities, none.suggestedTools], [false, 'explain', [], ['getCompanyOverview']]);
});

test('System policy: 10개 규칙, 감사 이벤트', () => {
  assert.equal(AI_POLICY_RULES.length, 10);
  const rule = (re: RegExp) => AI_POLICY_RULES.some((r) => re.test(r));
  for (const re of [/never invent/i, /never perform valuation calculations/i, /use valuation tools/i, /distinguish actual/i, /material dataquality/i, /cite source/i, /missing data must remain missing/i, /unsupported companies must be disclosed/i, /guaranteed/i, /investment recommendations/i]) assert.ok(rule(re), String(re));
  for (let i = 1; i <= 10; i++) assert.ok(SYSTEM_POLICY.includes(`${i}. `));
  assert.match(SYSTEM_POLICY, /not a calculation engine/);
  const ctx = ctxOf(withValuation(live()));
  const results = [executeTool('getHistoricalAnalysis', ctx), executeTool('getValuationResult', ctx)];
  const event = createAuditEvent('왜 이 결과가 나왔어?', results, undefined, () => new Date('2026-10-07T00:00:00Z'));
  assert.deepEqual([event.timestamp, event.question, event.toolUsed], ['2026-10-07T00:00:00.000Z', '왜 이 결과가 나왔어?', ['getHistoricalAnalysis', 'getValuationResult']]);
  assert.ok(event.sourceUsed.includes('actual:database:Consolidated') && event.sourceUsed.includes('calculated:valuation-engine'));
  assert.ok(event.warningsIncluded.some((t) => t.includes('학습용 가상값')));
  assert.deepEqual(Object.keys(event).sort(), ['question', 'sourceUsed', 'timestamp', 'toolUsed', 'warningsIncluded']);
});
