// "숨겨진 학습용 fallback 없음" 규칙 검증.
//   1. 학습용 fixture 전체는 [학습용 DCF 가정 적용] 을 명시적으로 눌렀을 때만 들어온다.
//   2. 그 외 어떤 동작에서도 fixture 의 값이 가정에 섞이지 않는다.
//   3. Forecast 만 입력된 상태를 완전한 ValuationInput 으로 강제 완성하지 않는다.
//   4. Forecast / WACC / DCF·Equity 가 모두 준비되기 전에는 Run Valuation 이 불가능하다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { step04PracticeAssumptions as fixture } from '../data/step04PracticeAssumptions.ts';
import { samsungHistoricalData } from '../data/samsungHistorical.ts';
import {
  emptyProjectState, isPracticeAssumptions, restoreProjectState, toPersisted, withAssumptions, withForecastInputs, withPracticeAssumptions,
  withResultsCleared, withSamsungHistorical, withSensitivityRun, withValuationReset, withValuationRun, withWaccInputs, type ProjectState,
} from './projectModel.ts';
import { assumptionCompleteness, isCompleteAssumptions, type AssumptionsDraft } from './assumptions.ts';
import type { ForecastInputs } from '../engine/forecastForm.ts';
import type { WaccInputs } from '../engine/waccForm.ts';

// 사용자가 직접 입력한 "실제" 값. fixture 값과 겹치는 값이 없도록 일부러 다르게 잡는다.
const realForecast: ForecastInputs = {
  currentRevenue: 3336059.38, // 삼성전자 2025A 매출(억원 환산)
  revenueGrowth: [0.11, 0.09, 0.07],
  operatingMargin: [0.12, 0.13, 0.14],
  taxRate: 0.22,
  depreciation: [500, 510, 520],
  capex: [900, 910, 920],
  deltaNwc: [30, 31, 32],
};
const realWacc: WaccInputs = { riskFreeRate: 0.035, beta: 0.95, marketRiskPremium: 0.055, preTaxCostOfDebt: 0.04, equityMarketValue: 4000000, debtMarketValue: 400000 };
const realDcf = { terminalGrowth: 0.025, interestBearingDebt: 280, cash: 120, sharesOutstanding: 5_000_000 };

const FIXTURE_ONLY_KEYS = ['riskFreeRate', 'beta', 'marketRiskPremium', 'preTaxCostOfDebt', 'equityMarketValue', 'debtMarketValue', 'terminalGrowth', 'interestBearingDebt', 'cash', 'sharesOutstanding'] as const;
const approx = (x: number, y: number, e = 0.006) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);

// ---------------------------------------------------------------------------
// 시나리오 1: 삼성전자 로드 → Forecast 직접 입력 → WACC 미입력
// ---------------------------------------------------------------------------
test('시나리오 1: 삼성전자 로드 + Forecast 직접 입력 + WACC 미입력 → Run 불가, STEP 04 값이 뒤에서 들어가지 않는다', () => {
  let s: ProjectState = withSamsungHistorical(emptyProjectState);
  s = withForecastInputs(s, realForecast);

  const a = s.valuationAssumptions!;
  // 입력한 값은 그대로
  assert.equal(a.currentRevenue, 3336059.38);
  assert.deepEqual(a.revenueGrowth, [0.11, 0.09, 0.07]);
  assert.equal(a.taxRate, 0.22);
  // WACC / DCF 필드는 비어 있다 — fixture 값(beta 1.1, E 900, 주식 1,000,000 …)이 섞이지 않음
  for (const k of FIXTURE_ONLY_KEYS) assert.equal(a[k], undefined, `${k} 에 값이 들어옴`);
  assert.equal(JSON.stringify(a).includes('"beta"'), false);

  // 완성도: Forecast READY, WACC INCOMPLETE, DCF/Equity INCOMPLETE → Run 불가
  const c = assumptionCompleteness(a);
  assert.deepEqual([c.forecast, c.wacc, c.dcf, c.complete], ['READY', 'INCOMPLETE', 'INCOMPLETE', false]);
  assert.equal(isCompleteAssumptions(a), false);

  // 실행을 시도해도 아무 일도 일어나지 않고, 결과가 생기지 않는다
  assert.equal(withValuationRun(s), s);
  assert.equal(withSensitivityRun(s), s);
  const tried = withSensitivityRun(withValuationRun(s));
  assert.equal(tried.valuationResult, null);
  assert.equal(tried.sensitivityResult, null);
  assert.equal(tried.valuationError, null);

  // 실제 historicalData 는 그대로
  assert.equal(s.historicalData, samsungHistoricalData);
});

test('시나리오 1-b: WACC 까지 입력해도 DCF/Equity 가 없으면 여전히 Run 불가', () => {
  const s = withWaccInputs(withForecastInputs(withSamsungHistorical(emptyProjectState), realForecast), realWacc);
  const c = assumptionCompleteness(s.valuationAssumptions);
  assert.deepEqual([c.forecast, c.wacc, c.dcf, c.complete], ['READY', 'READY', 'INCOMPLETE', false]);
  assert.deepEqual(c.missing.dcf, ['terminalGrowth', 'interestBearingDebt', 'cash', 'sharesOutstanding']);
  assert.equal(withValuationRun(s), s);
  for (const k of ['terminalGrowth', 'interestBearingDebt', 'cash', 'sharesOutstanding'] as const) assert.equal(s.valuationAssumptions![k], undefined);
});

// ---------------------------------------------------------------------------
// 시나리오 2: [학습용 DCF 가정 적용] → 전체 fixture 적용 → Run 가능
// ---------------------------------------------------------------------------
test('시나리오 2: [학습용 DCF 가정 적용] → STEP 04 fixture 전체가 적용되고 Run 가능', () => {
  const s = withPracticeAssumptions(withSamsungHistorical(emptyProjectState));
  assert.deepEqual(s.valuationAssumptions, fixture); // 전체
  const c = assumptionCompleteness(s.valuationAssumptions);
  assert.deepEqual([c.forecast, c.wacc, c.dcf, c.complete], ['READY', 'READY', 'READY', true]);
  assert.ok(isPracticeAssumptions(s.valuationAssumptions));
  assert.ok(s.valuationResult); // 실행 가능 (결과가 계산되어 있다)
  approx(s.valuationResult.enterpriseValue, 2345.56);
  // 이미 완성된 상태에서는 다시 실행해도 같은 결과
  assert.deepEqual(withValuationRun(s).valuationResult, s.valuationResult);
});

test('시나리오 2-b: 학습용 적용은 직접 입력해 둔 값을 모두 덮어쓴다 (일부만 섞이지 않는다)', () => {
  const typed = withWaccInputs(withForecastInputs(emptyProjectState, realForecast), realWacc);
  const s = withPracticeAssumptions(typed);
  assert.deepEqual(s.valuationAssumptions, fixture);
  assert.notEqual(s.valuationAssumptions!.beta, realWacc.beta);
  assert.notEqual(s.valuationAssumptions!.taxRate, realForecast.taxRate);
});

test('학습용 fixture 는 복사본으로 저장된다 (이후 수정이 fixture 에 영향을 주지 않는다)', () => {
  const snapshot = JSON.stringify(fixture);
  const s = withPracticeAssumptions(emptyProjectState);
  assert.notEqual(s.valuationAssumptions, fixture);
  assert.notEqual(s.valuationAssumptions!.revenueGrowth, fixture.revenueGrowth);
  s.valuationAssumptions!.revenueGrowth![0] = 0.99; // 상태를 직접 오염시켜도
  s.valuationAssumptions!.beta = 9;
  assert.equal(JSON.stringify(fixture), snapshot); // fixture 는 그대로
  assert.ok(isPracticeAssumptions(withPracticeAssumptions(emptyProjectState).valuationAssumptions));
});

// ---------------------------------------------------------------------------
// 시나리오 3: 학습용 적용 후 일부를 실제 값으로 수정
// ---------------------------------------------------------------------------
test('시나리오 3: 학습용 적용 후 일부를 실제 값으로 수정 → 배지 제거, 나머지는 명시적으로 입력된 값으로만 유지', () => {
  const applied = withPracticeAssumptions(emptyProjectState);
  assert.ok(isPracticeAssumptions(applied.valuationAssumptions));

  // 사용자가 Forecast 와 Beta 를 실제 값으로 수정
  let s = withForecastInputs(applied, realForecast);
  s = withWaccInputs(s, { ...realWacc, equityMarketValue: fixture.equityMarketValue, debtMarketValue: fixture.debtMarketValue, riskFreeRate: fixture.riskFreeRate, marketRiskPremium: fixture.marketRiskPremium, preTaxCostOfDebt: fixture.preTaxCostOfDebt });
  const a = s.valuationAssumptions!;

  // 학습용 배지(= 학습용 가정과 같은지)가 사라진다
  assert.equal(isPracticeAssumptions(a), false);
  // 수정한 값은 새 값
  assert.equal(a.beta, realWacc.beta);
  assert.deepEqual(a.revenueGrowth, realForecast.revenueGrowth);
  // 수정하지 않은 값은 명시적으로 입력된 값(처음 학습용 적용으로 들어온 값)으로 그대로 남는다 — 사라지거나 다른 값으로 바뀌지 않는다
  assert.equal(a.terminalGrowth, fixture.terminalGrowth);
  assert.equal(a.sharesOutstanding, fixture.sharesOutstanding);
  assert.equal(a.cash, fixture.cash);
  assert.equal(a.riskFreeRate, fixture.riskFreeRate);
  // 가정은 여전히 완성되어 있고, 이전 결과는 stale 이라 비워졌다
  assert.equal(assumptionCompleteness(a).complete, true);
  assert.equal(s.valuationResult, null);
  assert.equal(s.sensitivityResult, null);
});

test('시나리오 3-b: 학습용 가정을 초기화한 뒤 직접 입력하면 fixture 값이 되살아나지 않는다', () => {
  let s = withPracticeAssumptions(emptyProjectState);
  s = withValuationReset(s);
  assert.equal(s.valuationAssumptions, null);
  s = withForecastInputs(s, realForecast);
  for (const k of FIXTURE_ONLY_KEYS) assert.equal(s.valuationAssumptions![k], undefined, k);
  assert.equal(isPracticeAssumptions(s.valuationAssumptions), false);
});

test('시나리오 3-c: fixture 를 쓰지 않고 직접 완성한 가정은 학습용 가정이 아니며 결과도 fixture 와 다르다', () => {
  const s0 = withWaccInputs(withForecastInputs(emptyProjectState, realForecast), realWacc);
  const manual: AssumptionsDraft = { ...s0.valuationAssumptions!, ...realDcf };
  const s = withSensitivityRun(withValuationRun(withAssumptions(s0, manual)));
  assert.equal(isPracticeAssumptions(s.valuationAssumptions), false);
  assert.equal(assumptionCompleteness(s.valuationAssumptions).complete, true);
  assert.ok(s.valuationResult);
  assert.ok(Number.isFinite(s.valuationResult.enterpriseValue));
  assert.ok(Math.abs(s.valuationResult.enterpriseValue - 2345.56) > 1, 'fixture 결과와 달라야 한다');
  assert.equal(s.valuationResult.netDebt, realDcf.interestBearingDebt - realDcf.cash);
  assert.ok(s.sensitivityResult);
});

// ---------------------------------------------------------------------------
// 불변 조건: 학습용 적용을 하지 않는 모든 동작 순서에서 fixture 값이 새어 들어오지 않는다
// ---------------------------------------------------------------------------
test('불변 조건: [학습용 DCF 가정 적용] 없이 어떤 순서로 동작해도 가정에는 사용자가 입력한 값만 있다', () => {
  const allowed: Record<string, unknown> = { ...realForecast, ...realWacc };
  const ops: [string, (s: ProjectState) => ProjectState][] = [
    ['load', withSamsungHistorical],
    ['forecast', (s) => withForecastInputs(s, realForecast)],
    ['wacc', (s) => withWaccInputs(s, realWacc)],
    ['run', (s) => withSensitivityRun(withValuationRun(s))],
    ['clear', withResultsCleared],
    ['reset', withValuationReset],
    ['reload', (s) => restoreProjectState(JSON.parse(JSON.stringify(toPersisted(s))))],
  ];
  let sequences = 0;
  const walk = (state: ProjectState, depth: number, trail: string[]) => {
    const a = state.valuationAssumptions;
    if (a) {
      for (const [k, v] of Object.entries(a)) {
        assert.ok(k in allowed, `[${trail.join(' → ')}] 사용자가 입력하지 않은 필드 ${k} 가 생겼다`);
        assert.deepEqual(v, allowed[k], `[${trail.join(' → ')}] ${k} 값이 사용자 입력과 다르다`);
      }
      for (const k of FIXTURE_ONLY_KEYS.filter((k) => !(k in realWacc))) assert.equal(a[k], undefined);
    }
    // 입력만으로는 결과가 만들어지지 않는다 (DCF/Equity 가정이 없으므로 Run 은 항상 무효)
    assert.equal(state.valuationResult, null, `[${trail.join(' → ')}] 결과가 생겼다`);
    assert.equal(state.sensitivityResult, null);
    assert.equal(isPracticeAssumptions(a), false);
    sequences++;
    if (depth === 0) return;
    for (const [name, op] of ops) walk(op(state), depth - 1, [...trail, name]);
  };
  walk(emptyProjectState, 4, []);
  assert.ok(sequences > 2000, `검사한 동작 순서 수: ${sequences}`);
});

// ---------------------------------------------------------------------------
// 저장 / 복원
// ---------------------------------------------------------------------------
test('reload: 일부만 입력된 가정은 복원 후에도 완성되지 않고 fixture 로 채워지지 않는다', () => {
  const partial = withForecastInputs(withSamsungHistorical(emptyProjectState), realForecast);
  const restored = restoreProjectState(JSON.parse(JSON.stringify(toPersisted(partial))));
  assert.deepEqual(restored.valuationAssumptions, partial.valuationAssumptions);
  for (const k of FIXTURE_ONLY_KEYS) assert.equal(restored.valuationAssumptions![k], undefined);
  assert.equal(restored.valuationResult, null);
  assert.equal(assumptionCompleteness(restored.valuationAssumptions).complete, false);
});

// ---------------------------------------------------------------------------
// UI: Run Valuation 비활성화와 completeness 표시
// ---------------------------------------------------------------------------
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('UI: 두 곳의 Run Valuation 이 모두 가정 완성도로 비활성화된다', () => {
  const controls = src('../components/valuation/ValuationControls.tsx');
  assert.ok(/onClick=\{run\} disabled=\{!completeness\.complete\}/.test(controls), '상단 Run Valuation');
  const forecast = src('../components/valuation/ForecastStage.tsx');
  assert.ok(forecast.includes('assumptionCompleteness(a).complete'), 'Forecast 단계 runnable 판정');
  assert.ok(/onClick=\{run\} disabled=\{!runnable\}/.test(forecast), 'Forecast 단계 Run Valuation');
});

test('UI: completeness 가 Forecast / WACC / DCF/Equity / Valuation 로 표시된다', () => {
  const c = src('../components/valuation/AssumptionCompleteness.tsx');
  for (const label of ["'Forecast'", "'WACC'", "'DCF/Equity'", 'Valuation', 'NOT READY']) assert.ok(c.includes(label), label);
  const controls = src('../components/valuation/ValuationControls.tsx');
  assert.ok(controls.includes("'NOT READY'"), '상단 Valuation 상태가 가정 미완성일 때 NOT READY');
  assert.ok(controls.includes('<AssumptionCompleteness'));
});

test('코드 경로: 학습용 fixture 는 withPracticeAssumptions 와 배지 비교에서만 쓰인다', () => {
  const model = src('./projectModel.ts');
  const code = model.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(code.includes('structuredClone(step04PracticeAssumptions)'), '적용 함수는 fixture 를 복사해서 저장한다');
  // 적용 함수 / 비교 함수 바깥에서는 fixture 를 참조하지 않는다
  const outside = code
    .replace(/export function withPracticeAssumptions[\s\S]*?\n\}\n/, '')
    .replace(/export function isPracticeAssumptions[\s\S]*?\n\}\n/, '')
    .replace(/import .*step04PracticeAssumptions.*\n/, '');
  assert.ok(!outside.includes('step04PracticeAssumptions'));
  // UI 컴포넌트는 fixture 를 직접 import 하지 않는다
  for (const f of ['ForecastStage', 'WaccStage', 'ValuationControls', 'HistoricalStage', 'ResultStage']) {
    assert.ok(!src(`../components/valuation/${f}.tsx`).includes('step04PracticeAssumptions'), f);
  }
});
