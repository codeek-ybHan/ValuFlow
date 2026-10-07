// PROJECT 상태의 세 축 중 입력 두 가지의 타입.
// historicalData(공시 기반 실제값)와 valuationAssumptions(사용자/학습용 가정)는 의미가 다르므로 타입도 분리한다.

/** 데이터 출처. 실제 공시처럼 보이지 않도록 fixture 는 반드시 'Fixture' 로 표시한다. */
export type HistoricalSource = 'Fixture' | 'DART Annual Report' | 'Database';

/**
 * 실제 데이터 연결을 위한 메타데이터. 기존 저장값(localStorage)과의 호환을 위해 선택 필드로 둔다.
 * company.basis 는 "실제로 사용한" 기준이다 (연결 → 별도 fallback 이 일어났다면 Separate).
 */
export interface HistoricalMeta {
  corpCode?: string;
  stockCode?: string;
  source: HistoricalSource;
  /** 데이터를 가져온(또는 fixture 를 만든) 시각, ISO 8601. */
  fetchedAt?: string;
}

/** Workspace 에서 사용자가 고른 기업. Historical 재무데이터와는 별개이며, 선택만으로 재무데이터가 붙지 않는다. */
export interface SelectedCompany {
  corpCode: string;
  corpName: string;
  corpNameEng: string | null;
  /** 비상장사는 null. */
  stockCode: string | null;
  corpClass: string | null;
  source: 'OpenDART';
  /** OpenDART 에서 조회한 시각 (ISO 8601). */
  fetchedAt: string;
}

export interface HistoricalData {
  meta?: HistoricalMeta;
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
    /** 현금및현금성자산. 공시 연결(STEP 06-2) 이후 채워지며, fixture 에는 없다. */
    cash?: number[];
    /** 이자부부채(차입금 + 사채 등의 합). 계정 구성은 normalization 의 quality 에 기록된다. */
    interestBearingDebt?: number[];
    totalAssets: number[];
    totalLiabilities: number[];
    totalEquity: number[];
  };
  cashFlow: {
    cfo: number[];
    ppeAcquisition: number[];
    intangibleAcquisition: number[];
    /** 감가상각비 + 무형자산상각비. 현금흐름표 조정항목에서 찾으며 없을 수 있다. */
    depreciationAmortization?: number[];
  };
}

/** Valuation 입력 가정. 엔진의 입력 모델(valuation 공개 API 의 ValuationInput)과 같은 타입이다. */
export type { ValuationInput as ValuationAssumptions } from '../valuation';
