// STEP 07-5: DCF / Equity 입력과 Run Valuation. 숨겨진 학습용 fallback 없이 직접 입력만으로 가정을 완성하는 흐름을 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as fixture } from '../data/step04PracticeAssumptions.ts';
import {
  emptyProjectState, isPracticeAssumptions, withAssumptions, withDcfInputs, withForecastInputs, withPracticeAssumptions, withSamsungHistorical,
  withSensitivityRun, withValuationRun, withWaccInputs, type ProjectState,
} from './projectModel.ts';
import { assumptionCompleteness } from './assumptions.ts';
import { parseDcfForm, dcfDraftToForm, type DcfInputs } from '../engine/dcfForm.ts';
import { parseForecastForm, forecastDraftToForm } from '../engine/forecastForm.ts';
import { parseWaccForm, waccDraftToForm } from '../engine/waccForm.ts';

const approx = (x: number, y: number, e = 0.006) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);

// 폼을 거쳐(문자열 → 검증 → 소수) 만든 입력. STEP 04 fixture 와 값이 같지만 fixture 객체를 쓰지 않는다.
const forecast = () => { const r = parseForecastForm(forecastDraftToForm(fixture)); assert.ok(r.ok); return r.value; };
const wacc = () => { const r = parseWaccForm(waccDraftToForm(fixture)); assert.ok(r.ok); return r.value; };
const dcf = (changes: Partial<DcfInputs> = {}): DcfInputs => { const r = parseDcfForm(dcfDraftToForm({ ...fixture, ...changes })); assert.ok(r.ok); return r.value; };
const manualFull = (): ProjectState => withDcfInputs(withWaccInputs(withForecastInputs(withSamsungHistorical(emptyProjectState), forecast()), wacc()), dcf());

// ---- 6. withDcfInputs 는 네 필드만 수정 ----
test('withDcfInputs 는 DCF / Equity 4개 필드만 수정하고 Forecast / WACC 가정은 그대로 둔다', () => {
  const s = withPracticeAssumptions(emptyProjectState);
  const next = withDcfInputs(s, dcf({ terminalGrowth: 0.025, interestBearingDebt: 500, cash: 50, sharesOutstanding: 2_000_000 }));
  const a = next.valuationAssumptions!;
  assert.equal(a.terminalGrowth, 0.025);
  assert.equal(a.interestBearingDebt, 500);
  assert.equal(a.cash, 50);
  assert.equal(a.sharesOutstanding, 2_000_000);
  for (const k of ['currentRevenue', 'revenueGrowth', 'operatingMargin', 'taxRate', 'depreciation', 'capex', 'deltaNwc', 'riskFreeRate', 'beta', 'marketRiskPremium', 'preTaxCostOfDebt', 'equityMarketValue', 'debtMarketValue'] as const) {
    assert.deepEqual(a[k], fixture[k], k);
  }
});

test('withDcfInputs 는 가정이 없어도 반영되며 나머지 섹션은 비어 있다 (fixture 로 채우지 않는다)', () => {
  const s = withDcfInputs(emptyProjectState, dcf());
  const c = assumptionCompleteness(s.valuationAssumptions);
  assert.deepEqual([c.forecast, c.wacc, c.dcf], ['INCOMPLETE', 'INCOMPLETE', 'READY']);
  assert.equal(s.valuationAssumptions!.beta, undefined);
  assert.equal(s.valuationAssumptions!.revenueGrowth, undefined);
});

// ---- 7. stale ----
test('DCF 입력이 바뀌면 stale 결과(valuationResult / sensitivityResult)가 초기화된다', () => {
  const calculated = withPracticeAssumptions(emptyProjectState);
  assert.ok(calculated.valuationResult && calculated.sensitivityResult);
  const changed = withDcfInputs(calculated, dcf({ cash: 150 }));
  assert.equal(changed.valuationResult, null);
  assert.equal(changed.sensitivityResult, null);
  assert.equal(changed.valuationError, null);
});

// ---- 8. WACC ≤ g ----
test('WACC ≤ g: 입력 단계 오류와 별개로, 실행하면 엔진이 ValuationError 를 메시지로 남긴다 (앱은 멈추지 않는다)', () => {
  const s = withValuationRun(withDcfInputs(withPracticeAssumptions(emptyProjectState), dcf({ terminalGrowth: 0.09 })));
  assert.equal(s.valuationResult, null);
  assert.match(s.valuationError!, /영구성장률/);
});

// ---- 10. Cash > Debt ----
test('Cash > Debt: Net Debt 가 음수여도 실행되고 Equity Value 가 EV 보다 커진다', () => {
  const s = withValuationRun(withDcfInputs(withPracticeAssumptions(emptyProjectState), dcf({ interestBearingDebt: 100, cash: 300 })));
  const r = s.valuationResult!;
  assert.ok(r);
  assert.equal(r.netDebt, -200);
  assert.ok(r.equityValue > r.enterpriseValue);
  assert.equal(r.equityValue, r.enterpriseValue + 200);
  assert.equal(s.valuationError, null);
});

// ---- 11. completeness 최종 READY ----
test('Assumption completeness: Forecast / WACC / DCF·Equity 가 모두 READY 이면 Valuation READY', () => {
  const s = manualFull();
  const c = assumptionCompleteness(s.valuationAssumptions);
  assert.deepEqual([c.forecast, c.wacc, c.dcf, c.complete], ['READY', 'READY', 'READY', true]);
  assert.deepEqual(c.missing, { forecast: [], wacc: [], dcf: [] });
});

// ---- 12. 모든 필수 입력 전에는 Run 불가 ----
test('Run 은 모든 필수 입력이 준비되기 전에는 불가능하다 (단계별)', () => {
  let s = withSamsungHistorical(emptyProjectState);
  const canRun = (st: ProjectState) => assumptionCompleteness(st.valuationAssumptions).complete;
  assert.equal(canRun(s), false);
  s = withForecastInputs(s, forecast());
  assert.equal(canRun(s), false);
  s = withWaccInputs(s, wacc());
  assert.equal(canRun(s), false); // DCF/Equity 가 아직 없다
  assert.equal(withValuationRun(s), s);
  // DCF 네 필드 중 세 개만 있어도 불가
  const { sharesOutstanding, ...threeOfFour } = dcf();
  void sharesOutstanding;
  const almost = withAssumptions(s, { ...s.valuationAssumptions!, ...threeOfFour });
  assert.equal(canRun(almost), false);
  assert.deepEqual(assumptionCompleteness(almost.valuationAssumptions).missing.dcf, ['sharesOutstanding']);
  assert.equal(withValuationRun(almost), almost);
  // 네 개가 모두 있어야 가능
  s = withDcfInputs(s, dcf());
  assert.equal(canRun(s), true);
});

// ---- 13, 14. Run Valuation 성공, 결과 ----
test('직접 입력만으로 가정을 완성해 Run Valuation 을 실행하면 성공하고 Sensitivity 도 함께 계산된다', () => {
  const s = withSensitivityRun(withValuationRun(manualFull()));
  assert.equal(s.valuationError, null);
  assert.ok(s.valuationResult);
  assert.ok(s.sensitivityResult);
  assert.equal(s.sensitivityResult!.cells.flat().filter((c) => c.isBaseCase).length, 1);
  assert.equal(isPracticeAssumptions(s.valuationAssumptions), true); // 값이 학습용과 같으므로 배지 대상이 되지만, fixture 객체는 쓰지 않았다
});

test('EV / Equity Value / Per Share Value (STEP 04 값을 직접 입력한 경우)', () => {
  const r = withValuationRun(manualFull()).valuationResult!;
  approx(r.enterpriseValue, 2345.56);
  assert.equal(r.netDebt, 200);
  approx(r.equityValue, 2145.56);
  approx(r.perShareValue, 214556, 0.6);
  approx(r.wacc, 0.081375, 1e-12);
  // 학습용 적용 경로와 결과가 같다
  assert.deepEqual(r, withPracticeAssumptions(emptyProjectState).valuationResult);
});

test('학습용 DCF 적용 시 DCF 필드: g 2% / 부채 300억원 / 현금 100억원 / 주식 1,000,000주', () => {
  const a = withPracticeAssumptions(emptyProjectState).valuationAssumptions!;
  assert.equal(a.terminalGrowth, 0.02);
  assert.equal(a.interestBearingDebt, 300);
  assert.equal(a.cash, 100);
  assert.equal(a.sharesOutstanding, 1_000_000);
});

test('DCF 입력 변경 후 다시 실행하면 새 입력의 결과가 나온다', () => {
  const s = withValuationRun(withDcfInputs(manualFull(), dcf({ sharesOutstanding: 2_000_000 })));
  approx(s.valuationResult!.perShareValue, 107278, 0.6); // 주식 수가 2배 → 주당가치 절반
  approx(s.valuationResult!.equityValue, 2145.56);
});
