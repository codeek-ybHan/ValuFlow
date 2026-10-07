// Valuation Workflow 정의. 화면(Stepper / 슬롯)은 이 설정만 읽는다. 계산식은 여기에 두지 않는다.
// 계산은 valuation 공개 API(runValuation / runSensitivity)가 하고, 각 단계는 그 결과 객체의 필드를 보여 준다.

export type StageId = 'historical' | 'forecast' | 'wacc' | 'dcf' | 'result';

export interface WorkflowStage {
  id: StageId;
  no: number;
  label: string;
  summary: string;
  /** 사용자 입력 영역(향후 Assumption Inputs) */
  inputs: string[];
  /** 이 단계가 보여 줄 Engine 결과 설명 */
  outputs: string[];
  /** 이 단계가 읽는 ValuationResult 필드 이름 */
  resultFields: string[];
}

export const DEFAULT_STAGE: StageId = 'historical';

export const stages: WorkflowStage[] = [
  {
    id: 'historical', no: 1, label: 'Historical',
    summary: '공시 기반 과거 재무데이터를 확인하고 Forecast 의 기준으로 삼습니다.',
    inputs: [],
    outputs: ['Historical Financials 요약', '성장률 · 영업이익률 · NWC 등 파생지표 (07-2 예정)'],
    resultFields: [],
  },
  {
    id: 'forecast', no: 2, label: 'Forecast',
    summary: '미래 가정을 입력하고 FCFF 를 추정합니다.',
    inputs: ['Revenue Growth (Y1–Y3)', 'Operating Margin (Y1–Y3)', 'D&A', 'CAPEX', 'ΔNWC', 'Tax Rate'],
    outputs: ['Forecast Table (Revenue → EBIT → NOPAT → FCFF) — 결과 표는 07-5 예정'],
    resultFields: ['revenue', 'ebit', 'nopat', 'fcff'],
  },
  {
    id: 'wacc', no: 3, label: 'WACC',
    summary: 'CAPM 으로 자기자본비용을, 자본구조로 WACC 를 산출합니다.',
    inputs: ['Risk-free Rate', 'Beta', 'Market Risk Premium', 'Pre-tax Cost of Debt', 'Equity Market Value (E)', 'Debt Market Value (D)'],
    outputs: ['Cost of Equity', 'After-tax Cost of Debt', 'Capital Structure Weights', 'WACC + 계산 근거'],
    resultFields: ['costOfEquity', 'afterTaxCostOfDebt', 'equityWeight', 'debtWeight', 'wacc'],
  },
  {
    id: 'dcf', no: 4, label: 'DCF',
    summary: 'FCFF 를 할인하고 Terminal Value 를 더해 Enterprise Value 를 구합니다.',
    inputs: ['Terminal Growth'],
    outputs: ['FCFF / Discount Factor / PV 표', 'Terminal Value Card', 'Enterprise Value'],
    resultFields: ['discountFactors', 'pvFcff', 'terminalFcff', 'terminalValue', 'pvTerminalValue', 'enterpriseValue'],
  },
  {
    id: 'result', no: 5, label: 'Result',
    summary: 'Net Debt 를 차감해 Equity Value 와 주당 가치를 확인합니다.',
    inputs: ['Cash', 'Interest-bearing Debt', 'Shares Outstanding'],
    outputs: ['Value Bridge (EV → Equity Value)', 'Implied Share Price', 'Sensitivity'],
    resultFields: ['netDebt', 'equityValue', 'perShareValue'],
  },
];

export const stageIndex = (id: string | undefined) => stages.findIndex((s) => s.id === id);

/** Dashboard 의 Workflow Progress. Engine 연결 전이므로 모두 NOT STARTED 로 표시한다. */
export const dashboardWorkflow = [
  { no: '01', label: 'Historical Analysis', to: '/workspace' },
  { no: '02', label: 'Forecast', to: '/valuation/forecast' },
  { no: '03', label: 'WACC', to: '/valuation/wacc' },
  { no: '04', label: 'DCF', to: '/valuation/dcf' },
  { no: '05', label: 'Comparable Analysis', to: '/analysis' },
  { no: '06', label: 'Sensitivity', to: '/analysis' },
  { no: '07', label: 'Report', to: '/report' },
];
