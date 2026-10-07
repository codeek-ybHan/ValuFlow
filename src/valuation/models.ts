// Valuation Engine v1 의 입출력 모델.
// 단위 규칙
//   금액            억원 (Revenue, EBIT, FCFF, EV, Net Debt, Equity Value 등)
//   비율            소수 (8% → 0.08, 25% → 0.25)
//   sharesOutstanding  실제 주식 수(주)
//   perShareValue   원 — 억원 × 100,000,000 → 원으로 변환한 뒤 주식 수로 나눈다
//   연도 배열        Y1, Y2, … 순서
// 계산은 이 폴더의 순수 함수만 수행한다. UI / LLM 은 결과 객체를 읽기만 한다.

export interface ValuationInput {
  /** 현재(Y0) 매출 */
  currentRevenue: number;

  /** 연도별 매출성장률 (길이 = 예측 기간) */
  revenueGrowth: number[];
  /** 연도별 영업이익률 */
  operatingMargin: number[];

  taxRate: number;

  /** 연도별 D&A, CAPEX, ΔNWC (양수로 입력. FCFF 에서 부호를 적용) */
  depreciation: number[];
  capex: number[];
  deltaNwc: number[];

  riskFreeRate: number;
  beta: number;
  marketRiskPremium: number;

  preTaxCostOfDebt: number;

  /** WACC 가중치 계산용 시장가치 */
  equityMarketValue: number;
  debtMarketValue: number;

  terminalGrowth: number;

  interestBearingDebt: number;
  cash: number;
  /** 발행주식수(주). Equity Value(억원)를 원으로 변환한 뒤 나눈다. */
  sharesOutstanding: number;
}

export interface ValuationResult {
  revenue: number[];
  ebit: number[];
  nopat: number[];
  fcff: number[];

  costOfEquity: number;
  afterTaxCostOfDebt: number;
  equityWeight: number;
  debtWeight: number;
  wacc: number;

  discountFactors: number[];
  pvFcff: number[];

  terminalFcff: number;
  terminalValue: number;
  pvTerminalValue: number;

  enterpriseValue: number;
  netDebt: number;
  equityValue: number;
  /** 원 */
  perShareValue: number;
}

/** 입력이 계산 불가능하거나 정의되지 않을 때 던진다. 임의의 값으로 대체하지 않는다. */
export class ValuationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValuationError';
  }
}

/** 아직 구현되지 않은 계산. 가짜 값을 돌려주지 않고 명시적으로 실패한다. */
export function notImplemented(fn: string): never {
  throw new ValuationError(`${fn}: 아직 구현되지 않았습니다 (STEP 05-2 에서 구현 예정).`);
}
