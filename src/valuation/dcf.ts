// DCF: 할인 → Terminal Value → EV → Net Debt → Equity Value → 주당가치. [05-2 구현 예정]
import { notImplemented } from './models.ts';

/** 연도 말 할인 가정: DF_t = 1 / (1 + WACC)^t, t = 1..years */
export function calculateDiscountFactors(_wacc: number, _years: number): number[] {
  return notImplemented('calculateDiscountFactors');
}

/** PV(FCFF_t) = FCFF_t × DF_t */
export function discountCashFlow(_fcff: number[], _wacc: number): { discountFactors: number[]; pvFcff: number[] } {
  return notImplemented('discountCashFlow');
}

/** FCFF_(n+1) = FCFF_n × (1 + g),  TV = FCFF_(n+1) / (WACC − g).  WACC ≤ g 는 오류 */
export function calculateTerminalValue(_lastFcff: number, _wacc: number, _terminalGrowth: number): { terminalFcff: number; terminalValue: number } {
  return notImplemented('calculateTerminalValue');
}

/** PV(TV) = TV / (1 + WACC)^n */
export function calculatePvTerminalValue(_terminalValue: number, _wacc: number, _years: number): number {
  return notImplemented('calculatePvTerminalValue');
}

/** EV = Σ PV(FCFF) + PV(TV) */
export function calculateEnterpriseValue(_pvFcff: number[], _pvTerminalValue: number): number {
  return notImplemented('calculateEnterpriseValue');
}

/** Net Debt = 이자부부채 − 현금 */
export function calculateNetDebt(_interestBearingDebt: number, _cash: number): number {
  return notImplemented('calculateNetDebt');
}

/** Equity Value = EV − Net Debt */
export function calculateEquityValue(_enterpriseValue: number, _netDebt: number): number {
  return notImplemented('calculateEquityValue');
}

/** 억원 → 원 변환 후 주식 수로 나눈다. 반환 단위: 원 */
export function calculatePerShareValue(_equityValue: number, _sharesOutstanding: number): number {
  return notImplemented('calculatePerShareValue');
}
