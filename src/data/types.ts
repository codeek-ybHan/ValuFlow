// PROJECT 상태의 세 축 중 입력 두 가지의 타입.
// historicalData(공시 기반 실제값)와 valuationAssumptions(사용자/학습용 가정)는 의미가 다르므로 타입도 분리한다.

export interface HistoricalData {
  company: {
    name: string;
    ticker: string;
    basis: 'Consolidated' | 'Separate';
    currency: 'KRW';
    unit: 'million';
    /** 'A' = Actual (공시 확정값) */
    period: string[];
  };
  incomeStatement: {
    revenue: number[];
    cogs: number[];
    grossProfit: number[];
    sga: number[];
    operatingProfit: number[];
    netIncome: number[];
  };
  balanceSheet: {
    accountsReceivable: number[];
    inventory: number[];
    accountsPayable: number[];
    totalAssets: number[];
    totalLiabilities: number[];
    totalEquity: number[];
  };
  cashFlow: {
    cfo: number[];
    ppeAcquisition: number[];
    intangibleAcquisition: number[];
  };
}

/** Valuation 입력 가정. 엔진의 입력 모델(valuation/models.ts)과 같은 타입이다. */
export type { ValuationInput as ValuationAssumptions } from '../valuation/models';
