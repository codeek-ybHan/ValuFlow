// Valuation Engine v1 진입점. 결정적(deterministic) 계산만 수행하며 UI / LLM 과 무관하다.
//
// [05-2 구현 순서]
//   1. 입력 검증 (배열 길이 일치, 세율·성장률 범위, WACC > g)
//   2. forecast.ts : forecastRevenue → calculateEbit → calculateNopat → calculateFcff
//   3. wacc.ts     : calculateWacc
//   4. dcf.ts      : discountCashFlow → calculateTerminalValue → calculatePvTerminalValue → calculateEnterpriseValue
//   5. dcf.ts      : calculateNetDebt → calculateEquityValue → calculatePerShareValue
//   6. 위 결과를 ValuationResult 로 조립해 반환
import type { ValuationInput, ValuationResult } from './models.ts';
import { notImplemented } from './models.ts';

export function runValuation(_input: ValuationInput): ValuationResult {
  return notImplemented('runValuation');
}
