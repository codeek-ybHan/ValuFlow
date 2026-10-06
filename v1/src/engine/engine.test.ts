import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFcff, calculateNopat, calculateEnterpriseValue, calculateWacc, calculateTerminalValue, sensitivityMatrix, ValuationError } from './dcf.ts';
import { operatingMargin, cagr, safeDiv } from './analysis.ts';

const close = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !≈ ${b}`);

test('STEP 01 예제: 영업이익률', () => close(operatingMargin(150, 1000)!, 0.15));
test('0 나누기는 null', () => assert.equal(safeDiv(1, 0), null));
test('CAGR', () => close(cagr(100, 121, 2)!, 0.1));
test('NOPAT / FCFF', () => {
  close(calculateNopat(100, 0.25), 75);
  close(calculateFcff(75, 20, 30, 5), 60);
});
test('DCF 손계산 일치 (FCFF 100,110,121 / WACC 10% / g 0%)', () => {
  const r = calculateEnterpriseValue([100, 110, 121], 0.1, 0);
  // PV = 90.909 + 90.909 + 90.909 ; TV = 121/0.1 = 1210 ; PV(TV) = 909.09
  close(r.sumPvFcff, 272.7272727, 1e-5);
  close(r.terminalValue, 1210);
  close(r.enterpriseValue, 272.7272727 + 909.0909091, 1e-4);
});
test('WACC', () => close(calculateWacc({ equityValue: 60, debtValue: 40, costOfEquity: 0.1, costOfDebt: 0.05, taxRate: 0.2 }), 0.076));
test('WACC <= g 는 예외', () => assert.throws(() => calculateTerminalValue(100, 0.02, 0.03), ValuationError));
test('민감도: WACC 상승 시 EV 하락, g 상승 시 EV 상승', () => {
  const m = sensitivityMatrix([100, 110, 121], [0.08, 0.1], [0.01, 0.03], 0);
  assert.ok(m[0][0].ev! > m[1][0].ev!);
  assert.ok(m[0][1].ev! > m[0][0].ev!);
});
