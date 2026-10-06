import type { Step } from '../types';

export const step05: Step = {
  id: 5,
  code: 'STEP 05',
  title: 'Python Automation',
  short: 'Python Automation',
  subtitle: 'Python Valuation Automation',
  overview: ['STEP 02~04 에서 직접 수행한 계산을 재현 가능하고 검증 가능한 Python 코드로 전환하는 단계입니다.', '현재 웹앱의 TypeScript 엔진(src/engine)은 학습용 계산기이며, 이 단계에서 Python 엔진으로 이식하고 수기/Excel/Python 결과를 교차 검증합니다.'],
  goals: ['재무모델을 Input → Transformation → Calculation → Output 으로 분리한다.', '핵심 계산을 함수/모듈로 구현한다.', '손계산 vs Excel vs Python 을 비교 검증한다.', '예외 입력(WACC ≤ g, 0 나누기, 단위 오류)을 처리한다.'],
  lessons: [
    { id: 'l01', title: '재무모델을 코드로 바꾸는 방법', summary: '거대한 함수 대신 단계 분리.', outline: [{ formula: 'Input → Transformation → Calculation → Output' }, '수식 하나를 거대한 함수로 만들지 않는다.'] },
    { id: 'l02', title: '데이터 구조 설계', summary: 'Company / FinancialStatement / ValuationAssumption / ValuationResult.', outline: [{ list: ['Company', 'FinancialStatement', 'ValuationAssumption', 'ValuationResult'] }, '연도별 데이터를 일관된 구조로 관리한다.'] },
    { id: 'l03', title: 'Financial Analysis Functions', summary: '재무분석 함수 구현.', outline: [{ list: ['revenue_growth()', 'operating_margin()', 'net_margin()', 'roe()', 'roa()', 'debt_ratio()'] }] },
    { id: 'l04', title: 'FCFF Engine', summary: 'calculate_nopat / calculate_fcff.', outline: [{ list: ['calculate_nopat()', 'calculate_fcff()'] }, '각 입력값과 출력값이 명확해야 한다.'] },
    { id: 'l05', title: 'WACC Engine', summary: 'Ke, 세후 Kd, WACC.', outline: [{ list: ['calculate_cost_of_equity()', 'calculate_after_tax_cost_of_debt()', 'calculate_wacc()'] }] },
    { id: 'l06', title: 'DCF Engine', summary: 'Forecast → 할인 → TV → EV → Equity.', outline: [{ list: ['forecast_fcff()', 'calculate_terminal_value()', 'discount_cash_flow()', 'calculate_enterprise_value()', 'calculate_equity_value()'] }] },
    { id: 'l07', title: 'Sensitivity Engine', summary: 'WACC × g 조합 자동 계산.', outline: ['WACC × Terminal Growth 조합을 자동 계산한다.'] },
    { id: 'l08', title: 'Validation', summary: '자동화했다고 계산이 맞는 것은 아니다.', outline: [{ formula: '손계산 vs Excel vs Python' }, { list: ['단위', '부호', '세율', '연도', '할인 시점', 'Terminal Value', 'Net Debt'] }] },
    { id: 'l09', title: '예외처리와 재현가능성', summary: '결측·0 나누기·WACC≤g·음수·단위 오류.', outline: [{ list: ['결측값', '0으로 나누기', 'WACC ≤ g', '음수 값', '잘못된 단위', '비정상 입력'] }] },
  ],
  practice: {
    title: '수기 계산 vs Python 검증 Report',
    brief: ['STEP 04 실제 기업의 수기 계산과 Python 결과를 비교하고 검증 Report 를 작성합니다.'],
    questions: [
      { id: 'compare', prompt: '항목별 비교 (FCFF, WACC, TV, EV, Equity Value) — 수기 / Excel / Python 값' },
      { id: 'diff', prompt: '차이가 있었다면 원인 (단위·부호·세율·연도·할인 시점·TV·Net Debt)' },
      { id: 'fix', prompt: '수정한 내용과 재검증 결과' },
    ],
    deliverables: ['검증 Report'],
  },
  build: {
    title: 'valuation/ Python 패키지', kind: 'planned',
    description: ['Python 으로 구현할 Valuation Engine 입니다. 현재는 개발 예정 상태이며 가짜 결과를 표시하지 않습니다.'],
    planned: { comingIn: 'Coming in STEP 05', modules: ['financial_analysis.py', 'fcff.py', 'wacc.py', 'dcf.py', 'sensitivity.py', 'validation.py'], architecture: 'valuation/\n├── financial_analysis.py\n├── fcff.py\n├── wacc.py\n├── dcf.py\n├── sensitivity.py\n└── validation.py' },
  },
  reflectionPrompts: ['검증 중 발견한 가장 큰 불일치와 원인은?', '코드로 옮기며 새로 알게 된 모델의 가정은?'],
  evolution: { manual: '수기·Excel 로 DCF/WACC 를 계산했다.', problem: '재현이 어렵고, 가정이 바뀌면 오류가 생기며 검증 기준이 없다.', automated: '함수 단위 Python 엔진 + 수기 대비 검증 모듈.' },
};
