// WACC: CAPM 자기자본비용, 세후 타인자본비용, 자본구조 가중치. [05-2 구현 예정]
import type { ValuationInput } from './models.ts';
import { notImplemented } from './models.ts';

export interface WaccResult {
  costOfEquity: number;
  afterTaxCostOfDebt: number;
  equityWeight: number;
  debtWeight: number;
  wacc: number;
}

/** Re = Rf + β × MRP */
export function calculateCostOfEquity(_riskFreeRate: number, _beta: number, _marketRiskPremium: number): number {
  return notImplemented('calculateCostOfEquity');
}

/** Rd × (1 − T) */
export function calculateAfterTaxCostOfDebt(_preTaxCostOfDebt: number, _taxRate: number): number {
  return notImplemented('calculateAfterTaxCostOfDebt');
}

/** wE = E / (D + E), wD = D / (D + E) */
export function calculateCapitalWeights(_equityMarketValue: number, _debtMarketValue: number): { equityWeight: number; debtWeight: number } {
  return notImplemented('calculateCapitalWeights');
}

/** WACC = wE × Re + wD × Rd × (1 − T) */
export function calculateWacc(_input: ValuationInput): WaccResult {
  return notImplemented('calculateWacc');
}
