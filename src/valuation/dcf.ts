// DCF: 할인 → Terminal Value → EV → Net Debt → Equity Value → 주당가치.
// 할인은 연도 말(end-of-year) 가정이다. Terminal Value 는 Gordon Growth.
import { ValuationError } from './models.ts';

const finite = (n: number) => typeof n === 'number' && Number.isFinite(n);
function assertFinite(name: string, n: number): void {
  if (!finite(n)) throw new ValuationError(`${name}: 숫자가 아닙니다.`);
}
function assertSeries(name: string, values: number[]): void {
  if (!Array.isArray(values) || values.length === 0) throw new ValuationError(`${name}: 예측 기간(1년 이상)의 값이 필요합니다.`);
  values.forEach((v, i) => assertFinite(`${name}[Y${i + 1}]`, v));
}
function assertWacc(wacc: number): void {
  assertFinite('wacc', wacc);
  if (wacc <= -1) throw new ValuationError('wacc: -100% 보다 커야 합니다.');
}

/** 억원 → 원 */
export const EOK_TO_WON = 100_000_000;

/** DF_t = 1 / (1 + WACC)^t, t = 1..years */
export function calculateDiscountFactors(wacc: number, years: number): number[] {
  assertWacc(wacc);
  if (!Number.isInteger(years) || years < 1) throw new ValuationError('years: 1 이상의 정수여야 합니다.');
  return Array.from({ length: years }, (_, i) => 1 / Math.pow(1 + wacc, i + 1));
}

/** PV(FCFF_t) = FCFF_t × DF_t */
export function discountCashFlow(fcff: number[], wacc: number): { discountFactors: number[]; pvFcff: number[] } {
  assertSeries('fcff', fcff);
  const discountFactors = calculateDiscountFactors(wacc, fcff.length);
  return { discountFactors, pvFcff: fcff.map((f, i) => f * discountFactors[i]) };
}

/** FCFF_(n+1) = FCFF_n × (1 + g),  TV = FCFF_(n+1) / (WACC − g).  WACC ≤ g 이면 Gordon Growth 가 성립하지 않으므로 오류. */
export function calculateTerminalValue(lastFcff: number, wacc: number, terminalGrowth: number): { terminalFcff: number; terminalValue: number } {
  assertFinite('lastFcff', lastFcff);
  assertWacc(wacc);
  assertFinite('terminalGrowth', terminalGrowth);
  if (wacc <= terminalGrowth) {
    throw new ValuationError(`WACC(${(wacc * 100).toFixed(2)}%)가 영구성장률(${(terminalGrowth * 100).toFixed(2)}%) 이하이면 Terminal Value 를 계산할 수 없습니다.`);
  }
  const terminalFcff = lastFcff * (1 + terminalGrowth);
  return { terminalFcff, terminalValue: terminalFcff / (wacc - terminalGrowth) };
}

/** PV(TV) = TV / (1 + WACC)^n, n = 예측 연수 */
export function calculatePvTerminalValue(terminalValue: number, wacc: number, years: number): number {
  assertFinite('terminalValue', terminalValue);
  assertWacc(wacc);
  if (!Number.isInteger(years) || years < 1) throw new ValuationError('years: 1 이상의 정수여야 합니다.');
  return terminalValue / Math.pow(1 + wacc, years);
}

/** EV = Σ PV(FCFF) + PV(TV) */
export function calculateEnterpriseValue(pvFcff: number[], pvTerminalValue: number): number {
  assertSeries('pvFcff', pvFcff);
  assertFinite('pvTerminalValue', pvTerminalValue);
  return pvFcff.reduce((sum, v) => sum + v, 0) + pvTerminalValue;
}

/** Net Debt = 이자부부채 − 현금 */
export function calculateNetDebt(interestBearingDebt: number, cash: number): number {
  assertFinite('interestBearingDebt', interestBearingDebt);
  assertFinite('cash', cash);
  return interestBearingDebt - cash;
}

/** Equity Value = EV − Net Debt */
export function calculateEquityValue(enterpriseValue: number, netDebt: number): number {
  assertFinite('enterpriseValue', enterpriseValue);
  assertFinite('netDebt', netDebt);
  return enterpriseValue - netDebt;
}

/** 주당가치(원) = Equity Value(억원) × 100,000,000 ÷ 주식 수. 반올림하지 않는다. */
export function calculatePerShareValue(equityValue: number, sharesOutstanding: number): number {
  assertFinite('equityValue', equityValue);
  assertFinite('sharesOutstanding', sharesOutstanding);
  if (sharesOutstanding <= 0) throw new ValuationError('sharesOutstanding: 0 보다 커야 합니다.');
  return (equityValue * EOK_TO_WON) / sharesOutstanding;
}

export interface DcfResult {
  discountFactors: number[];
  pvFcff: number[];
  terminalFcff: number;
  terminalValue: number;
  pvTerminalValue: number;
  enterpriseValue: number;
}

/**
 * FCFF 와 (WACC, g) 만으로 EV 까지 계산한다. runValuation 과 Sensitivity 가 공유한다.
 * WACC 가 바뀌면 FCFF 할인, TV 공식, PV(TV) 모두 같은 WACC 로 다시 계산된다.
 */
export function runDcf(fcff: number[], wacc: number, terminalGrowth: number): DcfResult {
  const { discountFactors, pvFcff } = discountCashFlow(fcff, wacc);
  const { terminalFcff, terminalValue } = calculateTerminalValue(fcff[fcff.length - 1], wacc, terminalGrowth);
  const pvTerminalValue = calculatePvTerminalValue(terminalValue, wacc, fcff.length);
  const enterpriseValue = calculateEnterpriseValue(pvFcff, pvTerminalValue);
  return { discountFactors, pvFcff, terminalFcff, terminalValue, pvTerminalValue, enterpriseValue };
}
