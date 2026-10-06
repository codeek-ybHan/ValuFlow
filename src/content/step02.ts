import type { Step } from '../types';
import { bodies02 } from './bodies02';

const base: Step = {
  id: 2,
  code: 'STEP 02',
  title: 'Financial Analysis',
  short: 'Financial Analysis',
  subtitle: '재무분석',
  overview: [
    '재무제표 숫자를 “읽는” 단계에서 벗어나 과거 실적과 재무상태를 해석하고, 미래 추정을 위한 질문을 만드는 단계입니다.',
    { formula: '과거 숫자 → 변화 확인 → 원인 분석 → 정상화 → 미래 추정 → Valuation Assumption' },
  ],
  goals: ['성장성·수익성·안정성·효율성·현금창출력 지표를 계산하고 해석한다.', '지표의 “변화 원인”을 가설로 세운다.', '일회성 항목을 구분해 정상화의 필요성을 설명한다.', '재무분석을 DCF 가정(성장률·마진·CAPEX·운전자본)으로 연결한다.'],
  lessons: [
    { id: 'l01', title: '재무분석의 목적', summary: '비율 계산이 목적이 아니라 미래 가정의 근거를 만드는 것.', outline: [{ formula: '과거 숫자 → 변화 확인 → 원인 분석 → 정상화 → 미래 추정 → Valuation Assumption' }, '재무비율 계산 자체가 최종 목적이 아님을 이해한다.'] },
    { id: 'l02', title: '성장성 분석', summary: '매출·영업이익·순이익 성장률과 CAGR.', outline: [{ list: ['매출 / 영업이익 / 순이익 성장률', 'CAGR 개념'] }, { formula: '성장률 = 당기 / 전기 − 1\nCAGR = (최종값 / 시작값)^(1/기간) − 1' }, '질문: 매출이 지속 성장하는가? 이익이 매출보다 빠르게 증가하는가? 특정 연도만 급등/급락했는가?'] },
    { id: 'l03', title: '수익성 분석', summary: '매출총이익률·영업이익률·순이익률·ROA·ROE와 변화 원인.', outline: [{ list: ['매출총이익률', '영업이익률', '순이익률', 'ROA', 'ROE'] }, { formula: 'ROE = 당기순이익 / 자본총계\nROA = 당기순이익 / 자산총계' }, '단순 계산이 아니라 “매출 ↑ / 영업이익률 ↓” 같은 변화의 가능한 원인을 탐색한다.'] },
    { id: 'l04', title: '안정성 분석', summary: '부채비율·유동비율·차입금·현금·Net Debt 기초.', outline: [{ formula: '부채비율 = 부채총계 / 자본총계\n유동비율 = 유동자산 / 유동부채' }, '기업이 어떤 구조로 자금을 조달하는지 이해한다. (Net Debt 는 STEP 04 에서 완성)'] },
    { id: 'l05', title: '활동성·효율성 및 운전자본', summary: '매출채권·재고·매입채무와 현금이 영업에 묶이는 구조.', outline: [{ list: ['매출채권', '재고', '매입채무', '운전자본 개념'] }, 'DCF에 필요한 순운전자본 변화(ΔNWC)의 직관을 만든다.'] },
    { id: 'l06', title: '현금창출력 분석', summary: '순이익 vs CFO, CFO vs CAPEX, CAPEX 추이.', outline: [{ list: ['순이익 vs CFO', 'CFO vs CAPEX', 'CAPEX 추이'] }, '회계상 이익이 실제 현금으로 전환되는지 확인한다.'] },
    { id: 'l07', title: '일회성 항목과 정상화', summary: '지속 가능한 영업성과와 일회성 요인의 구분.', outline: [{ list: ['일회성 비용 / 일회성 이익', '자산 매각', '대규모 충당금', '비정상적인 특정 연도'] }, '가치평가에서는 과거 숫자를 그대로 미래로 복사하지 않는다.'] },
    { id: 'l08', title: '과거에서 미래로', summary: '재무분석이 DCF 가정으로 연결되는 과정.', outline: [{ formula: 'Historical Analysis → Normalisation\n→ Revenue / Margin / CAPEX / Working Capital Assumption\n→ Forecast' }] },
  ],
  quiz: [
    { id: 'q1', type: 'numeric', prompt: '매출이 100 → 120 으로 증가했다. 매출 성장률(%)은?', answer: 20, tolerance: 0.01, unit: '%', explain: '120/100 − 1 = 20%' },
    { id: 'q2', type: 'numeric', prompt: '매출이 2년간 100 → 121 로 증가했다. CAGR(%)은?', answer: 10, tolerance: 0.01, unit: '%', explain: '(121/100)^(1/2) − 1 = 10%' },
    { id: 'q3', type: 'numeric', prompt: '당기순이익 30, 자본총계 200 일 때 ROE(%)는?', answer: 15, tolerance: 0.01, unit: '%', explain: '30/200 = 15%' },
  ],
  practice: {
    title: '실제 기업 3개년 분석',
    brief: ['STEP 01 에서 사용한 기업의 최근 3개년 데이터를 STEP 01 Project Build 의 데이터셋에 입력한 뒤, 아래 비교표를 보고 해석을 작성합니다. 표의 숫자는 입력한 데이터에서 계산됩니다.'],
    questions: [
      { id: 'summary', prompt: '기업 재무상태 5줄 요약' },
      { id: 'dcf-q1', prompt: 'DCF를 위해 추가로 확인해야 할 질문 1' },
      { id: 'dcf-q2', prompt: 'DCF를 위해 추가로 확인해야 할 질문 2' },
      { id: 'dcf-q3', prompt: 'DCF를 위해 추가로 확인해야 할 질문 3' },
    ],
    deliverables: ['기업 재무상태 5줄 요약', 'DCF를 위해 추가로 확인해야 할 질문 3개'],
    extra: 'three-year',
  },
  build: {
    title: '재무분석 자동 계산 + 차트',
    kind: 'analysis',
    description: ['STEP 01 데이터셋에서 revenue_growth, operating_income_growth, operating_margin, net_margin, roe, roa, debt_ratio, current_ratio 를 계산하고 Revenue / Operating Income / Margin / CFO·CAPEX 추이를 차트로 보여줍니다.'],
  },
  reflectionPrompts: ['가장 해석하기 어려웠던 지표와 그 이유는?', '일회성으로 의심한 항목은 무엇이고 근거는?', '이 단계에서 반복적인 계산 중 자동화한 것은? (STEP 05 Valuation Engine 후보 포함)'],
  evolution: {
    manual: '3개년 지표를 계산기·엑셀로 직접 계산하고 변화 원인을 가설로 세웠다.',
    problem: '연도·기업마다 같은 계산을 반복하고 입력 실수가 결과를 바꾼다.',
    automated: '데이터셋 기반 지표 자동 계산 + 추이 차트 (null-safe 계산 엔진).',
  },
};

export const step02: Step = { ...base, lessons: base.lessons.map((l) => ({ ...l, body: bodies02[l.id] })) };
