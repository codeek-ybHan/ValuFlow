// Valuation Engine v1 통합 테스트. 공개 API(index.ts)만 사용해 STEP 04 종합실습 기준값 전체를 한 곳에서 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as input } from '../data/step04PracticeAssumptions.ts';
import { runSensitivity, runValuation, ValuationError, type SensitivityResult, type ValuationResult } from './index.ts';

// 기준 문서의 값은 소수 둘째 자리 표기이므로 ±0.006(주당가치는 ±0.6원) 허용
const approx = (x: number, y: number, e = 0.006) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);

const WACCS = [0.075, 0.08, 0.081375, 0.085, 0.09];
const GS = [0.01, 0.015, 0.02, 0.025, 0.03];

const result: ValuationResult = runValuation(input);
const sens: SensitivityResult = runSensitivity(input, WACCS, GS);
const evAt = (wacc: number, g: number) => sens.cells[WACCS.indexOf(wacc)][GS.indexOf(g)].enterpriseValue;

test('공개 API: runValuation / runSensitivity / ValuationError 를 제공한다', () => {
  assert.equal(typeof runValuation, 'function');
  assert.equal(typeof runSensitivity, 'function');
  assert.throws(() => runValuation({ ...input, sharesOutstanding: 0 }), (e) => e instanceof ValuationError);
});

test('STEP 04 기준값 — Forecast', () => {
  [1620, 1717.2, 1785.888].forEach((v, i) => close(result.revenue[i], v));
  [226.8, 240.408, 250.02432].forEach((v, i) => close(result.ebit[i], v));
  [170.1, 180.306, 187.51824].forEach((v, i) => close(result.nopat[i], v));
  [135.1, 144.306, 150.51824].forEach((v, i) => close(result.fcff[i], v));
});

test('STEP 04 기준값 — WACC', () => {
  close(result.costOfEquity, 0.096);
  close(result.afterTaxCostOfDebt, 0.0375);
  close(result.equityWeight, 0.75);
  close(result.debtWeight, 0.25);
  close(result.wacc, 0.081375);
});

test('STEP 04 기준값 — DCF / Equity', () => {
  [124.93, 123.4, 119.03].forEach((v, i) => approx(result.pvFcff[i], v));
  approx(result.terminalValue, 2501.48);
  approx(result.pvTerminalValue, 1978.19);
  approx(result.enterpriseValue, 2345.56);
  assert.equal(result.netDebt, 200);
  approx(result.equityValue, 2145.56);
  approx(result.perShareValue, 214556, 0.6);
});

test('STEP 04 기준값 — Sensitivity: Bear 9%/1%, Base 8.1375%/2%, Bull 7.5%/3%', () => {
  approx(evAt(0.09, 0.01), 1829.01);
  approx(evAt(0.081375, 0.02), 2345.56);
  approx(evAt(0.075, 0.03), 3144.95);
});

test('runValuation 과 runSensitivity Base Case 가 정확히 일치한다 (EV / Equity / 주당가치)', () => {
  const base = sens.cells.flat().find((c) => c.isBaseCase);
  assert.ok(base, 'base cell');
  assert.equal(base.enterpriseValue, result.enterpriseValue);
  assert.equal(base.equityValue, result.equityValue);
  assert.equal(base.perShareValue, result.perShareValue);
});

test('Sensitivity 모든 칸이 같은 FCFF 를 쓰고 Equity = EV − Net Debt 를 만족한다', () => {
  for (const c of sens.cells.flat()) {
    close(c.equityValue, c.enterpriseValue - result.netDebt);
    close(c.perShareValue, (c.equityValue * 1e8) / input.sharesOutstanding, 1e-6);
  }
});

test('결정적: 입력을 변경하지 않고 같은 입력은 같은 결과', () => {
  const snapshot = JSON.stringify(input);
  assert.deepEqual(runValuation(input), result);
  assert.deepEqual(runSensitivity(input, WACCS, GS), sens);
  assert.equal(JSON.stringify(input), snapshot);
});

test('결과 어디에도 NaN / Infinity 가 없다', () => {
  for (const v of Object.values(result)) for (const n of Array.isArray(v) ? v : [v]) assert.ok(Number.isFinite(n));
  for (const c of sens.cells.flat()) for (const n of [c.enterpriseValue, c.equityValue, c.perShareValue]) assert.ok(Number.isFinite(n));
});

test('WACC ≤ g 는 두 API 모두 ValuationError', () => {
  assert.throws(() => runValuation({ ...input, terminalGrowth: 0.09 }), ValuationError);
  assert.throws(() => runSensitivity(input, [0.02], [0.02]), ValuationError);
});
