import type { ValuationAssumptions } from './types';

/**
 * STEP 04 종합실습의 가상 가정값 (단위: 억원). 삼성전자의 실제 Forecast 나 실제 가치평가 입력이 아니다.
 * 이 값으로 계산한 WACC / EV / Equity Value 를 삼성전자의 결과처럼 표시하지 않는다.
 * Valuation Engine(STEP 05) 연결 전까지는 fixture 로만 존재하며 화면에 적용되지 않는다.
 */
export const step04PracticeAssumptions: ValuationAssumptions = {
  currentRevenue: 1500,

  revenueGrowth: [0.08, 0.06, 0.04],
  operatingMargin: [0.14, 0.14, 0.14],

  taxRate: 0.25,

  depreciation: [40, 42, 44],
  capex: [60, 62, 64],
  deltaNwc: [15, 16, 17],

  riskFreeRate: 0.03,
  beta: 1.1,
  marketRiskPremium: 0.06,

  preTaxCostOfDebt: 0.05,

  equityMarketValue: 900,
  debtMarketValue: 300,

  terminalGrowth: 0.02,

  interestBearingDebt: 300,
  cash: 100,
  sharesOutstanding: 1_000_000,
};
