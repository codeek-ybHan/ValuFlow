import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samsungHistoricalData as d } from '../data/samsungHistorical.ts';
import { step04PracticeAssumptions as a } from '../data/step04PracticeAssumptions.ts';
import { deriveHistoricalMetrics } from './historical.ts';

const close = (x: number, y: number, e = 1e-6) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const m = deriveHistoricalMetrics(d);

test('fixture 정합성: 매출총이익 = 매출 - 매출원가', () =>
  d.incomeStatement.revenue.forEach((r, i) => assert.equal(r - d.incomeStatement.cogs[i], d.incomeStatement.grossProfit[i])));
test('fixture 정합성: 영업이익 = 매출총이익 - 판관비', () =>
  d.incomeStatement.grossProfit.forEach((g, i) => assert.equal(g - d.incomeStatement.sga[i], d.incomeStatement.operatingProfit[i])));
test('fixture 정합성: 자산 = 부채 + 자본', () =>
  d.balanceSheet.totalAssets.forEach((t, i) => assert.equal(d.balanceSheet.totalLiabilities[i] + d.balanceSheet.totalEquity[i], t)));
test('모든 계열이 기간 수와 같은 길이', () => {
  const n = d.company.period.length;
  for (const group of [d.incomeStatement, d.balanceSheet, d.cashFlow]) for (const v of Object.values(group)) assert.equal(v.length, n);
});

test('Revenue growth: 첫 해 null, 2024 ≈ 16.2%, 2025 ≈ 10.9%', () => {
  assert.equal(m.revenueGrowth[0], null);
  close(m.revenueGrowth[1]!, 0.1619, 5e-4);
  close(m.revenueGrowth[2]!, 0.1088, 5e-4);
});
test('Operating margin = 영업이익 / 매출', () => {
  close(m.operatingMargin[0]!, 6566976 / 258935494);
  close(m.operatingMargin[2]!, 43601051 / 333605938);
});
test('NWC = AR + Inventory - AP 와 ΔNWC', () => {
  assert.deepEqual(m.nwc, [76953443, 83007761, 90725090]);
  assert.equal(m.deltaNwc[0], null);
  assert.equal(m.deltaNwc[1], 6054318);
  assert.equal(m.deltaNwc[2], 7717329);
});
test('CAPEX(Learning Basis) = 유형자산 취득액, CFO - CAPEX 는 참고지표', () => {
  assert.deepEqual(m.capex, [57611292, 51406355, 47522179]);
  assert.deepEqual(m.cfoMinusCapex, [-13473865, 21576266, 37792969]);
});

test('Practice Assumption 은 Historical 과 별개 fixture (억원 단위 가상값)', () => {
  assert.equal(a.currentRevenue, 1500);
  assert.equal(a.sharesOutstanding, 1_000_000);
  assert.notEqual(a.currentRevenue, d.incomeStatement.revenue[2]);
});
