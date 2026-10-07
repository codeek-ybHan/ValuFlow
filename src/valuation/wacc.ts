// WACC: CAPM 자기자본비용, 세후 타인자본비용, 자본구조 가중치.
import type { ValuationInput } from './models.ts';
import { ValuationError } from './models.ts';
import { assertFinite, assertTaxRate } from './validate.ts';

export interface WaccResult {
  costOfEquity: number;
  afterTaxCostOfDebt: number;
  equityWeight: number;
  debtWeight: number;
  wacc: number;
}

/** Re = Rf + β × MRP */
export function calculateCostOfEquity(riskFreeRate: number, beta: number, marketRiskPremium: number): number {
  assertFinite('riskFreeRate', riskFreeRate);
  assertFinite('beta', beta);
  assertFinite('marketRiskPremium', marketRiskPremium);
  return riskFreeRate + beta * marketRiskPremium;
}

/** Rd × (1 − T). 세율은 0 이상 1 미만. */
export function calculateAfterTaxCostOfDebt(preTaxCostOfDebt: number, taxRate: number): number {
  assertFinite('preTaxCostOfDebt', preTaxCostOfDebt);
  assertTaxRate(taxRate);
  return preTaxCostOfDebt * (1 - taxRate);
}

/** wE = E / (D + E), wD = D / (D + E). E, D 는 0 이상이고 합이 0 보다 커야 한다. */
export function calculateCapitalWeights(equityMarketValue: number, debtMarketValue: number): { equityWeight: number; debtWeight: number } {
  assertFinite('equityMarketValue', equityMarketValue);
  assertFinite('debtMarketValue', debtMarketValue);
  if (equityMarketValue < 0 || debtMarketValue < 0) throw new ValuationError('equityMarketValue / debtMarketValue: 음수일 수 없습니다.');
  const total = equityMarketValue + debtMarketValue;
  if (total <= 0) throw new ValuationError('equityMarketValue + debtMarketValue: 0 보다 커야 합니다.');
  return { equityWeight: equityMarketValue / total, debtWeight: debtMarketValue / total };
}

/** WACC = wE × Re + wD × Rd × (1 − T) */
export function calculateWacc(input: ValuationInput): WaccResult {
  const costOfEquity = calculateCostOfEquity(input.riskFreeRate, input.beta, input.marketRiskPremium);
  const afterTaxCostOfDebt = calculateAfterTaxCostOfDebt(input.preTaxCostOfDebt, input.taxRate);
  const { equityWeight, debtWeight } = calculateCapitalWeights(input.equityMarketValue, input.debtMarketValue);
  const wacc = equityWeight * costOfEquity + debtWeight * afterTaxCostOfDebt;
  return { costOfEquity, afterTaxCostOfDebt, equityWeight, debtWeight, wacc };
}
