import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as a } from '../data/step04PracticeAssumptions.ts';
import { calculateEbit, forecastRevenue } from './forecast.ts';
import { ValuationError } from './models.ts';

const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);

test('STEP 04 기준: Revenue Y1~Y3 = 1620 / 1717.2 / 1785.888', () => {
  const rev = forecastRevenue(a.currentRevenue, a.revenueGrowth);
  assert.equal(rev.length, 3);
  close(rev[0], 1620);
  close(rev[1], 1717.2);
  close(rev[2], 1785.888);
  assert.equal(rev[2].toFixed(2), '1785.89');
});

test('EBIT = Revenue × Operating Margin (14%)', () => {
  const ebit = calculateEbit(forecastRevenue(a.currentRevenue, a.revenueGrowth), a.operatingMargin);
  close(ebit[0], 226.8);
  close(ebit[1], 240.408);
  close(ebit[2], 250.02432);
});

test('역성장(-10%)은 허용되고 매출이 감소한다', () => {
  const rev = forecastRevenue(1000, [-0.1, -0.1]);
  close(rev[0], 900);
  close(rev[1], 810);
});

test('입력 배열을 변경하지 않는다', () => {
  const growth = [...a.revenueGrowth];
  forecastRevenue(a.currentRevenue, growth);
  assert.deepEqual(growth, a.revenueGrowth);
});

test('잘못된 입력은 ValuationError', () => {
  assert.throws(() => forecastRevenue(1000, []), ValuationError);
  assert.throws(() => forecastRevenue(NaN, [0.1]), ValuationError);
  assert.throws(() => forecastRevenue(-1, [0.1]), ValuationError);
  assert.throws(() => forecastRevenue(1000, [0.1, NaN]), ValuationError);
  assert.throws(() => forecastRevenue(1000, [-1]), ValuationError);
  assert.throws(() => calculateEbit([100, 200], [0.1]), ValuationError);
  assert.throws(() => calculateEbit([], []), ValuationError);
});
