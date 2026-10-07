import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as a } from '../data/step04PracticeAssumptions.ts';
import { runValuation } from './engine.ts';
import { ValuationError, type ValuationInput } from './models.ts';

const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const approx = (x: number, y: number, e = 0.006) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const arr = (xs: number[], ys: number[], f: (x: number, y: number) => void) => {
  assert.equal(xs.length, ys.length);
  xs.forEach((x, i) => f(x, ys[i]));
};

test('runValuation: STEP 04 종합실습 전체 결과', () => {
  const r = runValuation(a);

  // Forecast
  arr(r.revenue, [1620, 1717.2, 1785.888], close);
  arr(r.ebit, [226.8, 240.408, 250.02432], close);
  arr(r.nopat, [170.1, 180.306, 187.51824], close);
  arr(r.fcff, [135.1, 144.306, 150.51824], close);

  // WACC
  close(r.costOfEquity, 0.096);
  close(r.afterTaxCostOfDebt, 0.0375);
  close(r.equityWeight, 0.75);
  close(r.debtWeight, 0.25);
  close(r.wacc, 0.081375);

  // DCF
  assert.equal(r.discountFactors.length, 3);
  arr(r.pvFcff, [124.93, 123.4, 119.03], approx);
  approx(r.terminalValue, 2501.48);
  approx(r.pvTerminalValue, 1978.19);
  approx(r.enterpriseValue, 2345.56);
  close(r.terminalFcff, 150.51824 * 1.02);

  // Equity
  assert.equal(r.netDebt, 200);
  approx(r.equityValue, 2145.56);
  approx(r.perShareValue, 214556, 0.6);
});

test('runValuation: 입력을 변경하지 않고 같은 입력에 같은 결과 (결정적)', () => {
  const snapshot = JSON.stringify(a);
  const r1 = runValuation(a);
  const r2 = runValuation(a);
  assert.equal(JSON.stringify(a), snapshot);
  assert.deepEqual(r1, r2);
});

test('runValuation: 예측 기간이 5년이어도 동작한다', () => {
  const five: ValuationInput = {
    ...a,
    revenueGrowth: [0.08, 0.06, 0.04, 0.03, 0.03],
    operatingMargin: Array(5).fill(0.14),
    depreciation: [40, 42, 44, 45, 46],
    capex: [60, 62, 64, 65, 66],
    deltaNwc: [15, 16, 17, 17, 17],
  };
  const r = runValuation(five);
  assert.equal(r.fcff.length, 5);
  assert.equal(r.discountFactors.length, 5);
  assert.ok(Number.isFinite(r.enterpriseValue) && r.enterpriseValue > 0);
});

test('Invalid input: 배열 길이 불일치', () => {
  for (const k of ['revenueGrowth', 'operatingMargin', 'depreciation', 'capex', 'deltaNwc'] as const) {
    assert.throws(() => runValuation({ ...a, [k]: a[k].slice(0, 2) }), ValuationError, k);
  }
});

test('Invalid input: sharesOutstanding ≤ 0', () => {
  assert.throws(() => runValuation({ ...a, sharesOutstanding: 0 }), ValuationError);
  assert.throws(() => runValuation({ ...a, sharesOutstanding: -1 }), ValuationError);
});

test('Invalid input: equity + debt market value ≤ 0', () => {
  assert.throws(() => runValuation({ ...a, equityMarketValue: 0, debtMarketValue: 0 }), ValuationError);
});

test('Invalid input: WACC ≤ terminalGrowth', () => {
  assert.throws(() => runValuation({ ...a, terminalGrowth: 0.081375 }), ValuationError);
  assert.throws(() => runValuation({ ...a, terminalGrowth: 0.1 }), ValuationError);
});

test('Invalid input: NaN / Infinity 는 결과로 새어 나오지 않고 오류가 된다', () => {
  assert.throws(() => runValuation({ ...a, currentRevenue: NaN }), ValuationError);
  assert.throws(() => runValuation({ ...a, beta: Infinity }), ValuationError);
  assert.throws(() => runValuation({ ...a, revenueGrowth: [0.08, NaN, 0.04] }), ValuationError);
  assert.throws(() => runValuation({ ...a, taxRate: 1 }), ValuationError);
  assert.throws(() => runValuation({ ...a, revenueGrowth: [] }), ValuationError);
});
