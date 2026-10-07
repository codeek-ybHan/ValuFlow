// STEP 07-7: Valuation Workspace End-to-End 흐름. 화면 클릭 대신 화면이 호출하는 상태 전이를 같은 순서로 실행해 검증한다.
//   Historical → Forecast → WACC → DCF/Equity → Run Valuation → Result → Validation
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { step04PracticeAssumptions as fixture } from '../data/step04PracticeAssumptions.ts';
import { samsungHistoricalData } from '../data/samsungHistorical.ts';
import {
  applyPracticeWithConfirmation, emptyProjectState, isPracticeAssumptions, restoreProjectState, toPersisted, withDcfInputs, withForecastInputs,
  withRelativeInputs, withSamsungHistorical, withSensitivityRun, withValuationReset, withValuationRun, withWaccInputs, type ProjectState,
} from './projectModel.ts';
import { assumptionBasis, buildWorkflowProgress, describeBasis, stageStatuses } from './workflowStatus.ts';
import { isCompleteAssumptions } from './assumptions.ts';
import { buildValidationView } from '../engine/validationView.ts';
import { parseForecastForm, forecastDraftToForm, type ForecastFormValues } from '../engine/forecastForm.ts';
import { parseWaccForm, waccDraftToForm, type WaccFormValues } from '../engine/waccForm.ts';
import { parseDcfForm, dcfDraftToForm, type DcfFormValues } from '../engine/dcfForm.ts';

const approx = (x: number, y: number, e = 0.006) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const progress = (s: ProjectState) => Object.fromEntries(buildWorkflowProgress(s).map((r) => [r.key, r.display]));

/** 사용자가 폼에 문자열로 입력한 값 (화면과 같은 경로: 문자열 → 검증 → 소수 변환). 학습용 fixture 와 겹치는 값이 없다. */
const typed = {
  forecast: { currentRevenue: '3336059.38', taxRate: '22', revenueGrowth: ['11', '9', '7'], operatingMargin: ['12', '13', '14'], depreciation: ['500', '510', '520'], capex: ['900', '910', '920'], deltaNwc: ['30', '31', '32'] } satisfies ForecastFormValues,
  wacc: { riskFreeRate: '3.5', beta: '0.95', marketRiskPremium: '5.5', preTaxCostOfDebt: '4', equityMarketValue: '4000000', debtMarketValue: '400000' } satisfies WaccFormValues,
  dcf: { terminalGrowth: '2.5', interestBearingDebt: '280', cash: '120', sharesOutstanding: '5000000' } satisfies DcfFormValues,
};
const parsedForecast = () => { const r = parseForecastForm(typed.forecast); assert.ok(r.ok); return r.value; };
const parsedWacc = () => { const r = parseWaccForm(typed.wacc); assert.ok(r.ok); return r.value; };
const parsedDcf = () => { const r = parseDcfForm(typed.dcf); assert.ok(r.ok); return r.value; };

// ===========================================================================
// Flow A — 학습용: Reset → Apply Practice → Run → Result → Validation
// ===========================================================================
test('Flow A: Reset → 학습용 적용 → Run → Result → Validation', () => {
  // Reset (Historical 은 유지)
  let s = withValuationReset(withSamsungHistorical(emptyProjectState));
  assert.deepEqual(progress(s), { historical: 'LOADED', forecast: 'NOT STARTED', wacc: 'NOT STARTED', dcf: 'NOT STARTED', valuation: 'NOT STARTED', sensitivity: 'NOT STARTED', validation: 'NOT STARTED' });

  // 입력이 없으므로 확인 없이 바로 적용 → 가정 전체 + 계산
  s = applyPracticeWithConfirmation(s, false);
  assert.deepEqual(s.valuationAssumptions, fixture);
  assert.equal(isPracticeAssumptions(s.valuationAssumptions), true);
  assert.equal(describeBasis(s).assumptions.label, '학습용 가정');

  // Result
  const r = s.valuationResult!;
  assert.ok(r);
  approx(r.enterpriseValue, 2345.56);
  approx(r.equityValue, 2145.56);
  approx(r.perShareValue, 214556, 0.6);
  assert.equal(r.netDebt, 200);

  // Sensitivity Base 일치
  const base = s.sensitivityResult!.cells.flat().find((c) => c.isBaseCase)!;
  assert.equal(base.enterpriseValue, r.enterpriseValue);
  assert.equal(base.equityValue, r.equityValue);
  assert.equal(base.perShareValue, r.perShareValue);

  // 워크플로 상태
  assert.deepEqual(progress(s), { historical: 'LOADED', forecast: 'READY', wacc: 'READY', dcf: 'READY', valuation: 'CALCULATED', sensitivity: 'CALCULATED', validation: 'READY' });

  // Validation 으로 이동 가능 (Valuation 결과가 있다)
  assert.equal(stageStatuses(s).validation, 'READY');
  assert.ok(isCompleteAssumptions(s.valuationAssumptions));
  const v = buildValidationView({ assumptions: s.valuationAssumptions, result: r, sensitivity: s.sensitivityResult, relativeInput: s.relativeInputs });
  const [bear, mid, bull] = v.scenarios.columns;
  assert.ok(bear.equityValue! < mid.equityValue! && mid.equityValue! < bull.equityValue!, 'Bear < Base < Bull');
  assert.equal(mid.enterpriseValue, r.enterpriseValue);
  assert.equal(v.sensitivity!.rows.flatMap((x) => x.cells).filter((c) => c.isBaseCase).length, 1);
  assert.ok(v.range.low.equityValue <= v.range.base.equityValue && v.range.base.equityValue <= v.range.high.equityValue);
});

// ===========================================================================
// Flow B — 실제 Historical + 직접 입력: Reset → Samsung → Forecast → WACC → DCF → Run → Validation
// ===========================================================================
test('Flow B: 삼성전자 Historical + Forecast / WACC / DCF 직접 입력 → Run → Validation (학습용 fixture 가 섞이지 않는다)', () => {
  let s = withValuationReset(emptyProjectState);
  s = withSamsungHistorical(s);
  assert.equal(s.historicalData, samsungHistoricalData);

  // Forecast 직접 입력 → WACC 직접 입력: DCF/Equity 가 없으면 아직 실행할 수 없다
  s = withForecastInputs(s, parsedForecast());
  assert.deepEqual([progress(s).forecast, progress(s).valuation], ['READY', 'INCOMPLETE']);
  s = withWaccInputs(s, parsedWacc());
  assert.deepEqual([progress(s).wacc, progress(s).dcf, progress(s).valuation], ['READY', 'NOT STARTED', 'INCOMPLETE']);
  assert.equal(withValuationRun(s), s, 'DCF/Equity 입력 전에는 실행되지 않는다');
  assert.equal(s.valuationResult, null);

  // DCF / Equity 직접 입력 → 이제 실행 가능
  s = withDcfInputs(s, parsedDcf());
  assert.deepEqual([progress(s).dcf, progress(s).valuation], ['READY', 'READY']);
  assert.equal(s.valuationResult, null, '입력만으로는 계산되지 않는다 (Run 버튼)');

  // Run Valuation
  s = withSensitivityRun(withValuationRun(s));
  assert.equal(s.valuationError, null);
  assert.ok(s.valuationResult && s.sensitivityResult);
  assert.deepEqual(progress(s), { historical: 'LOADED', forecast: 'READY', wacc: 'READY', dcf: 'READY', valuation: 'CALCULATED', sensitivity: 'CALCULATED', validation: 'READY' });

  // 출처: Historical 은 Samsung Actual, 가정은 사용자 입력 (학습용 배지 없음)
  assert.equal(s.historicalData, samsungHistoricalData);
  assert.equal(assumptionBasis(s), 'user');
  assert.equal(isPracticeAssumptions(s.valuationAssumptions), false);
  const basis = describeBasis(s);
  assert.equal(basis.historical.label, '삼성전자 · Actual');
  assert.equal(basis.assumptions.label, '사용자 입력');
  assert.equal(basis.caution, null);

  // 가정은 사용자가 입력한 값뿐 — fixture 의 값이 하나도 섞이지 않았다
  const a = s.valuationAssumptions!;
  assert.equal(Object.keys(a).length, 17);
  assert.deepEqual(a.revenueGrowth, [0.11, 0.09, 0.07]);
  assert.equal(a.taxRate, 0.22);
  assert.equal(a.beta, 0.95);
  assert.equal(a.terminalGrowth, 0.025);
  assert.equal(a.sharesOutstanding, 5_000_000);
  for (const k of Object.keys(a) as (keyof typeof a)[]) assert.notDeepEqual(a[k], fixture[k], `${String(k)} 가 학습용 fixture 값과 같다`);

  // 결과는 사용자 입력에 기반한다 (정확한 가치 숫자는 단정하지 않고 입력과의 관계만 확인)
  const r = s.valuationResult!;
  assert.ok(Math.abs(r.enterpriseValue - 2345.56) > 1, '학습용 결과와 달라야 한다');
  assert.equal(r.netDebt, 280 - 120);
  assert.ok(Number.isFinite(r.enterpriseValue) && Number.isFinite(r.perShareValue));
  assert.equal(r.fcff.length, 3);
  const changed = withValuationRun(withDcfInputs(s, { ...parsedDcf(), sharesOutstanding: 10_000_000 }));
  assert.ok(Math.abs(changed.valuationResult!.perShareValue - r.perShareValue / 2) < 1e-6, '주식 수가 2배면 주당가치가 절반');
  assert.equal(changed.valuationResult!.enterpriseValue, r.enterpriseValue);

  // Validation 까지 정상 이동
  assert.equal(stageStatuses(s).validation, 'READY');
  assert.ok(isCompleteAssumptions(a));
  const v = buildValidationView({ assumptions: a, result: r, sensitivity: s.sensitivityResult, relativeInput: s.relativeInputs });
  assert.equal(v.scenarios.columns.length, 3);
  assert.equal(v.scenarios.columns[1].enterpriseValue, r.enterpriseValue); // Base 열 = 사용자 입력의 DCF 결과
  assert.ok(v.scenarios.columns.every((c) => c.ok));
  assert.equal(v.sensitivity!.base.wacc, r.wacc); // Sensitivity 의 Base 는 이 사용자의 WACC
  assert.equal(v.sensitivity!.base.inGrid, true, '직접 입력한 가정에서도 Base 칸이 격자에 들어온다');
  const baseCell = v.sensitivity!.rows.flatMap((x) => x.cells).filter((c) => c.isBaseCase);
  assert.equal(baseCell.length, 1);
  assert.equal(baseCell[0].enterpriseValue, r.enterpriseValue, 'Base 칸 = Run Valuation 결과');
  assert.ok(v.range.low.equityValue <= r.equityValue && r.equityValue <= v.range.high.equityValue);
  // 학습용 가정 문구는 나오지 않는다
  assert.ok(!JSON.stringify(v).includes('학습용'));
});

// ===========================================================================
// Reload — 입력만 저장하고 결과는 다시 계산한다
// ===========================================================================
const calculatedManual = (): ProjectState =>
  withRelativeInputs(
    withSensitivityRun(withValuationRun(withDcfInputs(withWaccInputs(withForecastInputs(withSamsungHistorical(emptyProjectState), parsedForecast()), parsedWacc()), parsedDcf()))),
    { netIncome: 150, per: 12, ebitda: 220, evEbitda: 10 },
  );

test('Reload: 입력 복원 + valuationResult / sensitivityResult 재계산, 상대가치 입력 복원', () => {
  const before = calculatedManual();
  const stored = JSON.parse(JSON.stringify(toPersisted(before))); // localStorage 왕복
  assert.ok(!('valuationResult' in stored) && !('sensitivityResult' in stored), '결과는 저장하지 않는다');
  const after = restoreProjectState(stored);
  assert.deepEqual(after.historicalData, before.historicalData);
  assert.deepEqual(after.valuationAssumptions, before.valuationAssumptions);
  assert.deepEqual(after.relativeInputs, { netIncome: 150, per: 12, ebitda: 220, evEbitda: 10 });
  assert.deepEqual(after.valuationResult, before.valuationResult); // 재계산
  assert.deepEqual(after.sensitivityResult, before.sensitivityResult);
  assert.deepEqual(progress(after), progress(before));
});

test('Reload: stale 결과가 없다 — 저장된 입력이 바뀐 뒤 복원하면 새 입력의 결과가 나온다', () => {
  const before = calculatedManual();
  const stored = JSON.parse(JSON.stringify(toPersisted(before)));
  stored.valuationAssumptions.beta = 1.4; // 입력이 바뀐 채로 저장되었다고 가정
  const after = restoreProjectState(stored);
  assert.notEqual(after.valuationResult!.wacc, before.valuationResult!.wacc);
  assert.equal(after.valuationResult!.wacc, restoreProjectState(JSON.parse(JSON.stringify(stored))).valuationResult!.wacc);
});

test('Reload: 입력이 일부뿐이면 복원은 되지만 결과는 만들어지지 않는다', () => {
  const partial = withWaccInputs(withForecastInputs(withSamsungHistorical(emptyProjectState), parsedForecast()), parsedWacc());
  const after = restoreProjectState(JSON.parse(JSON.stringify(toPersisted(partial))));
  assert.deepEqual(after.valuationAssumptions, partial.valuationAssumptions);
  assert.equal(after.valuationResult, null);
  assert.equal(after.sensitivityResult, null);
  assert.deepEqual([progress(after).valuation, progress(after).dcf], ['INCOMPLETE', 'NOT STARTED']);
});

// ===========================================================================
// Reset 정책 — 가정 · 결과 · 상대가치 입력은 지우고 Historical 은 유지
// ===========================================================================
test('Reset: Valuation 초기화는 가정 · 결과 · 상대가치 입력을 지우고 Historical 은 유지한다', () => {
  const before = calculatedManual();
  assert.ok(before.valuationResult && Object.keys(before.relativeInputs).length === 4);
  const after = withValuationReset(before);
  assert.equal(after.valuationAssumptions, null);
  assert.equal(after.valuationResult, null);
  assert.equal(after.sensitivityResult, null);
  assert.deepEqual(after.relativeInputs, {});
  assert.equal(after.historicalData, samsungHistoricalData);
  assert.deepEqual(progress(after), { historical: 'LOADED', forecast: 'NOT STARTED', wacc: 'NOT STARTED', dcf: 'NOT STARTED', valuation: 'NOT STARTED', sensitivity: 'NOT STARTED', validation: 'NOT STARTED' });
  // 초기화 후 reload 해도 비어 있다
  const reloaded = restoreProjectState(JSON.parse(JSON.stringify(toPersisted(after))));
  assert.equal(reloaded.valuationAssumptions, null);
  assert.deepEqual(reloaded.relativeInputs, {});
  assert.equal(reloaded.valuationResult, null);
});

// ===========================================================================
// stale 결과 없음 — 어떤 가정 입력이 바뀌어도 이전 결과는 즉시 사라진다
// ===========================================================================
test('Stale: Forecast / WACC / DCF 어느 입력을 바꿔도 결과와 Sensitivity 가 즉시 비워진다', () => {
  const calc = calculatedManual();
  const changes: [string, ProjectState][] = [
    ['forecast', withForecastInputs(calc, { ...parsedForecast(), taxRate: 0.3 })],
    ['wacc', withWaccInputs(calc, { ...parsedWacc(), beta: 1.2 })],
    ['dcf', withDcfInputs(calc, { ...parsedDcf(), cash: 200 })],
  ];
  for (const [name, next] of changes) {
    assert.equal(next.valuationResult, null, name);
    assert.equal(next.sensitivityResult, null, name);
    assert.equal(progress(next).valuation, 'READY', name);
    assert.equal(progress(next).validation, 'NOT STARTED', name);
  }
});

test('상대가치 입력만 바꾸면 Valuation 결과는 유지된다 (상대가치 결과는 입력에서 매번 계산되는 파생값)', () => {
  const calc = calculatedManual();
  const next = withRelativeInputs(calc, { netIncome: 999, per: 8 });
  assert.equal(next.valuationResult, calc.valuationResult);
  assert.equal(progress(next).valuation, 'CALCULATED');
});

// ===========================================================================
// 정리: 오래된 placeholder / 예정 표기 / 하드코딩 상태가 남아 있지 않다
// ===========================================================================
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('Valuation Workspace 화면에는 "예정" placeholder 나 오래된 STEP 안내가 없다', () => {
  for (const f of ['ValuationControls', 'AssumptionCompleteness', 'HistoricalStage', 'ForecastStage', 'WaccStage', 'DcfStage', 'ResultStage', 'ValidationStage', 'SensitivityPanel', 'ScenarioPanel', 'RelativePanel', 'ValidationSummary']) {
    const code = strip(src(`../components/valuation/${f}.tsx`));
    assert.ok(!code.includes('예정'), `${f}: '예정'`);
    assert.ok(!/0[1-9]-[0-9] (에서|이후|예정)/.test(code), `${f}: 오래된 STEP 안내`);
  }
  const wf = strip(src('../components/valuation/workflow.ts'));
  assert.ok(!wf.includes('예정'));
});

test('남은 placeholder 는 이후 STEP 용 메뉴(AI Analyst / Report)뿐이다', () => {
  const app = src('../App.tsx');
  const placeholders = [...app.matchAll(/<PlannedPage eyebrow="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(placeholders, ['AI Analyst', 'Report']);
});

test('LEARN BuildPage 에 도달 불가능한 planned 분기가 없다', () => {
  assert.ok(!src('../pages/BuildPage.tsx').includes("'planned'"));
  assert.ok(!strip(src('../types.ts')).includes("'planned'"));
});
