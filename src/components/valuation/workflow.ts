// Valuation Workflow 정의. 화면(Stepper / 슬롯)은 이 설정만 읽는다.
// 계산식은 여기에 두지 않는다. 각 단계의 engineFns 는 engine/dcf.ts 에 이미 있는 함수 이름이며,
// 계산 컴포넌트를 붙일 때 Engine 의 결과 객체를 받아 렌더링만 하도록 연결한다.

export type StageId = 'forecast' | 'wacc' | 'dcf' | 'equity';

export interface WorkflowStage {
  id: StageId;
  no: number;
  label: string;
  summary: string;
  /** 사용자 입력 영역(향후 Assumption Inputs) */
  inputs: string[];
  /** Engine 결과 영역(향후 Result Table / Card) */
  outputs: string[];
  /** 연결 예정 Engine 함수 (src/engine/dcf.ts) */
  engineFns: string[];
}

export const DEFAULT_STAGE: StageId = 'forecast';

export const stages: WorkflowStage[] = [
  {
    id: 'forecast', no: 1, label: 'Forecast',
    summary: '미래 가정을 입력하고 FCFF 를 추정합니다.',
    inputs: ['Revenue Growth (Y1–Y5)', 'Operating Margin (Y1–Y5)', 'D&A', 'CAPEX', 'ΔNWC', 'Tax Rate'],
    outputs: ['Forecast Table (Revenue → EBIT → NOPAT → FCFF)'],
    engineFns: ['forecastFcff', 'calculateNopat', 'calculateFcff'],
  },
  {
    id: 'wacc', no: 2, label: 'WACC',
    summary: 'CAPM 으로 자기자본비용을, 자본구조로 WACC 를 산출합니다.',
    inputs: ['Risk-free Rate', 'Beta', 'Market Risk Premium', 'Pre-tax Cost of Debt', 'Equity Value (E)', 'Debt (D)'],
    outputs: ['Cost of Equity', 'After-tax Cost of Debt', 'Capital Structure Weights', 'WACC + 계산 근거'],
    engineFns: ['costOfEquity', 'afterTaxCostOfDebt', 'calculateWacc'],
  },
  {
    id: 'dcf', no: 3, label: 'DCF',
    summary: 'FCFF 를 할인하고 Terminal Value 를 더해 Enterprise Value 를 구합니다.',
    inputs: ['Terminal Growth'],
    outputs: ['FCFF / Discount Factor / PV 표', 'Terminal Value Card', 'Enterprise Value'],
    engineFns: ['calculateEnterpriseValue', 'calculateTerminalValue', 'discountFactor'],
  },
  {
    id: 'equity', no: 4, label: 'Equity Value',
    summary: 'Net Debt 를 차감해 Equity Value 와 주당 가치를 확인합니다.',
    inputs: ['Cash', 'Interest-bearing Debt', 'Shares Outstanding'],
    outputs: ['Value Bridge (EV → Equity Value)', 'Implied Share Price', 'Assumptions Summary'],
    engineFns: ['calculateEquityValue'],
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
