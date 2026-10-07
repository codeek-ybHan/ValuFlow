import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as a } from '../data/step04PracticeAssumptions.ts';
import {
  calculateDiscountFactors, calculateEnterpriseValue, calculateEquityValue, calculateNetDebt, calculatePerShareValue,
  calculatePvTerminalValue, calculateTerminalValue, discountCashFlow, runDcf,
} from './dcf.ts';
import { ValuationError } from './models.ts';

// STEP 04 종합실습 중간값 (forecast / wacc 테스트에서 이미 검증됨)
const FCFF = [135.1, 144.306, 150.51824];
const WACC = 0.081375;
// 문서의 기대값은 소수 둘째 자리이므로 0.006 이내를 허용한다.
const approx = (x: number, y: number, e = 0.006) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);

test('할인계수 DF_t = 1 / (1 + WACC)^t', () => {
  const df = calculateDiscountFactors(WACC, 3);
  close(df[0], 1 / 1.081375);
  close(df[2], 1 / Math.pow(1.081375, 3));
});

test('PV(FCFF) ≈ 124.93 / 123.40 / 119.03', () => {
  const { pvFcff } = discountCashFlow(FCFF, WACC);
  approx(pvFcff[0], 124.93);
  approx(pvFcff[1], 123.4);
  approx(pvFcff[2], 119.03);
});

test('Terminal FCFF 와 Terminal Value ≈ 2501.48', () => {
  const { terminalFcff, terminalValue } = calculateTerminalValue(FCFF[2], WACC, a.terminalGrowth);
  close(terminalFcff, 150.51824 * 1.02);
  approx(terminalValue, 2501.48);
});

test('PV(TV) ≈ 1978.19', () => {
  const { terminalValue } = calculateTerminalValue(FCFF[2], WACC, a.terminalGrowth);
  approx(calculatePvTerminalValue(terminalValue, WACC, 3), 1978.19);
});

test('Enterprise Value ≈ 2345.56', () => {
  const r = runDcf(FCFF, WACC, a.terminalGrowth);
  approx(r.enterpriseValue, 2345.56);
  close(r.enterpriseValue, r.pvFcff.reduce((s, v) => s + v, 0) + r.pvTerminalValue);
});

test('Net Debt = 300 − 100 = 200', () => assert.equal(calculateNetDebt(a.interestBearingDebt, a.cash), 200));

test('Equity Value ≈ 2145.56', () => {
  const ev = runDcf(FCFF, WACC, a.terminalGrowth).enterpriseValue;
  approx(calculateEquityValue(ev, 200), 2145.56);
});

test('주당가치: 억원 → 원 변환 후 주식 수로 나눈다 (≈ 214,556원)', () => {
  assert.equal(calculatePerShareValue(2145.56, 1_000_000), 214556);
  const ev = runDcf(FCFF, WACC, a.terminalGrowth).enterpriseValue;
  approx(calculatePerShareValue(ev - 200, a.sharesOutstanding), 214556, 0.6);
});

test('WACC 가 달라지면 할인·TV·PV(TV) 모두 달라진다 (Sensitivity 재사용 계약)', () => {
  const base = runDcf(FCFF, WACC, 0.02);
  const high = runDcf(FCFF, 0.09, 0.02);
  assert.ok(high.discountFactors[0] < base.discountFactors[0]);
  assert.ok(high.terminalValue < base.terminalValue);
  assert.ok(high.pvTerminalValue < base.pvTerminalValue);
  assert.ok(high.enterpriseValue < base.enterpriseValue);
  // g 가 커지면 가치가 커진다
  assert.ok(runDcf(FCFF, WACC, 0.03).enterpriseValue > base.enterpriseValue);
});

test('WACC ≤ 영구성장률이면 ValuationError', () => {
  assert.throws(() => calculateTerminalValue(100, 0.02, 0.02), ValuationError);
  assert.throws(() => calculateTerminalValue(100, 0.01, 0.02), ValuationError);
  assert.throws(() => runDcf(FCFF, 0.02, 0.03), ValuationError);
});

test('DCF 입력 검증', () => {
  assert.throws(() => discountCashFlow([], WACC), ValuationError);
  assert.throws(() => discountCashFlow([100, NaN], WACC), ValuationError);
  assert.throws(() => calculateDiscountFactors(-1, 3), ValuationError);
  assert.throws(() => calculateDiscountFactors(0.08, 0), ValuationError);
  assert.throws(() => calculatePerShareValue(100, 0), ValuationError);
  assert.throws(() => calculatePerShareValue(100, -5), ValuationError);
  assert.throws(() => calculateEnterpriseValue([], 10), ValuationError);
});
