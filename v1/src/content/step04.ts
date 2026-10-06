import type { Step } from '../types';
import { bodies04 } from './bodies04';

const base: Step = {
  id: 4,
  code: 'STEP 04',
  title: 'WACC & Valuation',
  short: 'WACC & Valuation',
  subtitle: 'WACC & 기업가치평가',
  overview: ['DCF의 할인율(WACC)을 이해하고 Enterprise Value 에서 Equity Value 까지 연결하며, 상대가치평가와 민감도 분석까지 수행하는 단계입니다.', { formula: 'Equity Value = Enterprise Value − Net Debt' }],
  goals: ['EV 와 Equity Value 의 차이를 설명한다.', 'CAPM 으로 Cost of Equity 를 계산한다.', 'WACC 를 자본구조 가중치로 계산한다.', '민감도 분석으로 가정 의존성을 설명한다.'],
  lessons: [
    { id: 'l01', title: 'Enterprise Value vs Equity Value', summary: '영업자산 전체 가치 vs 주주 귀속 가치.', outline: [{ formula: 'Equity Value = Enterprise Value − Net Debt' }, '필요 시 기타 조정항목(비지배지분, 우선주 등)이 존재할 수 있다.'] },
    { id: 'l02', title: '자본구조', summary: 'Debt + Equity, 채권자와 주주의 요구수익률 차이.', outline: ['채권자와 주주가 요구하는 수익률이 다르다.'] },
    { id: 'l03', title: 'Cost of Debt', summary: '차입금 금리, 채권 수익률, 세금효과.', outline: [{ formula: '세후 Kd = Kd × (1 − 세율)' }] },
    { id: 'l04', title: 'Cost of Equity와 CAPM', summary: 'Rf + β × MRP.', outline: [{ formula: 'Cost of Equity = Risk-free Rate + Beta × Market Risk Premium' }, '위험이 요구수익률과 연결되는 이유.'] },
    { id: 'l05', title: 'WACC', summary: '자본구조를 반영한 가중평균 자본비용.', outline: [{ formula: 'WACC = E/(D+E) × Ke + D/(D+E) × Kd × (1 − t)' }, '왜 FCFF 를 WACC 로 할인하는가?'] },
    { id: 'l06', title: 'Net Debt', summary: '이자부부채 − 현금.', outline: [{ formula: 'Net Debt ≈ Interest-bearing Debt − Cash' }, '현금성자산과 부채 범위에는 판단이 필요할 수 있다.'] },
    { id: 'l07', title: 'DCF 완성', summary: 'FCFF → WACC 할인 → EV → Net Debt → Equity Value.', outline: [{ formula: 'FCFF Forecast → WACC 할인 → EV → Net Debt 조정 → Equity Value' }] },
    { id: 'l08', title: '상대가치평가', summary: 'PER · PBR · EV/EBITDA · Comparable Companies.', outline: [{ list: ['PER', 'PBR', 'EV/EBITDA', 'Comparable Companies', 'Trading Multiple'] }, 'DCF 와 상대가치평가의 접근 방식 차이.'] },
    { id: 'l09', title: '민감도 분석', summary: 'WACC × Terminal Growth 조합.', outline: [{ formula: 'WACC: 8% / 9% / 10%\nTerminal Growth: 1% / 2% / 3%' }, '가치평가는 하나의 정답이 아니라 가정에 따라 달라진다.'] },
    { id: 'l10', title: '가치평가 결과 해석', summary: '어떤 가정이 결과에 가장 큰 영향을 주는가.', outline: [{ list: ['어떤 가정이 결과에 가장 큰 영향을 주는가?', 'WACC 상승 시 왜 가치가 하락하는가?', 'g 상승 시 왜 가치가 상승하는가?', '지나치게 낙관적인 가정은 없는가?'] }] },
  ],
  quiz: [
    { id: 'q1', type: 'numeric', prompt: 'Rf 3%, β 1.2, MRP 5% 일 때 Cost of Equity(%)는?', answer: 9, tolerance: 0.01, unit: '%', explain: '3% + 1.2 × 5% = 9%' },
    { id: 'q2', type: 'numeric', prompt: 'E 60, D 40, Ke 10%, Kd 5%, 세율 20% 일 때 WACC(%)는?', answer: 7.6, tolerance: 0.01, unit: '%', explain: '0.6×10% + 0.4×5%×0.8 = 7.6%' },
    { id: 'q3', type: 'numeric', prompt: 'EV 1,000, 이자부부채 300, 현금 100 일 때 Equity Value는?', answer: 800, tolerance: 0.01, unit: '', explain: 'Net Debt = 200, Equity = 1,000 − 200 = 800' },
  ],
  practice: {
    title: '실제 기업 Valuation',
    brief: ['실제 기업 한 곳을 대상으로 다음을 수행하고, 근거와 함께 기록합니다. 숫자는 직접 찾은 출처와 함께 적으세요.'],
    questions: [
      { id: 'assump', prompt: '1. Forecast Assumption (성장률·마진·세율·CAPEX·NWC 와 근거)' },
      { id: 'wacc', prompt: '2. WACC 산정 (Rf, β, MRP, Kd, 자본구조와 출처)' },
      { id: 'dcf', prompt: '3~4. DCF 결과와 Enterprise Value' },
      { id: 'nd', prompt: '5~6. Net Debt 와 Equity Value' },
      { id: 'sens', prompt: '7. Sensitivity Matrix 해석 (어떤 가정이 가장 민감한가)' },
      { id: 'mult', prompt: '8. 가능하면 Multiples 비교 (PER / PBR / EV/EBITDA)' },
    ],
    deliverables: ['Forecast Assumption', 'WACC', 'DCF', 'EV', 'Net Debt', 'Equity Value', 'Sensitivity Matrix', 'Multiples'],
  },
  build: { title: 'Valuation Dashboard', kind: 'valuation', description: ['Enterprise Value, Equity Value, WACC, Terminal Growth, FCFF Forecast, Sensitivity Matrix 를 한 화면에서 확인. 계산은 engine/dcf.ts 를 사용합니다.'] },
  reflectionPrompts: ['결과에 가장 큰 영향을 준 가정과 그 근거의 강도는?', '지나치게 낙관적이라고 느낀 가정은?', '상대가치와 DCF 결과가 다르다면 왜 그럴까?'],
  evolution: { manual: '실제 기업의 WACC 와 DCF 를 직접 산정하고 민감도 표를 만들었다.', problem: '가정을 바꿀 때마다 표를 다시 만들어야 하고, 어떤 가정이 결과를 흔드는지 한눈에 보기 어렵다.', automated: 'Valuation Dashboard (WACC·EV·Equity·Sensitivity 자동 계산).' },
};

export const step04: Step = { ...base, lessons: base.lessons.map((l) => ({ ...l, body: bodies04[l.id] })) };
