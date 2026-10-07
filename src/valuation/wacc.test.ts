import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as a } from '../data/step04PracticeAssumptions.ts';
import { calculateAfterTaxCostOfDebt, calculateCapitalWeights, calculateCostOfEquity, calculateWacc } from './wacc.ts';
import { ValuationError } from './models.ts';

const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);

test('CAPM: Re = 3% + 1.1 × 6% = 9.6%', () => close(calculateCostOfEquity(a.riskFreeRate, a.beta, a.marketRiskPremium), 0.096));
test('세후 타인자본비용: 5% × (1 − 25%) = 3.75%', () => close(calculateAfterTaxCostOfDebt(a.preTaxCostOfDebt, a.taxRate), 0.0375));
test('자본구조: E 900, D 300 → 75% / 25%', () => {
  const w = calculateCapitalWeights(a.equityMarketValue, a.debtMarketValue);
  close(w.equityWeight, 0.75);
  close(w.debtWeight, 0.25);
});
test('WACC = 8.1375%', () => {
  const r = calculateWacc(a);
  close(r.costOfEquity, 0.096);
  close(r.afterTaxCostOfDebt, 0.0375);
  close(r.equityWeight, 0.75);
  close(r.debtWeight, 0.25);
  close(r.wacc, 0.081375);
});
test('부채가 0 이면 WACC = Ke', () => {
  close(calculateWacc({ ...a, debtMarketValue: 0 }).wacc, 0.096);
});
test('WACC 입력 검증', () => {
  assert.throws(() => calculateCapitalWeights(0, 0), ValuationError);
  assert.throws(() => calculateCapitalWeights(-1, 100), ValuationError);
  assert.throws(() => calculateCapitalWeights(NaN, 100), ValuationError);
  assert.throws(() => calculateAfterTaxCostOfDebt(0.05, 1), ValuationError);
  assert.throws(() => calculateCostOfEquity(NaN, 1, 0.06), ValuationError);
});
