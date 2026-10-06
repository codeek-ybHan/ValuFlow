import type { Step } from '../types';
import { bodies03 } from './bodies03';

const base: Step = {
  id: 3,
  code: 'STEP 03',
  title: 'DCF',
  short: 'DCF',
  subtitle: '현금흐름할인법',
  overview: ['기업의 미래 현금흐름을 현재가치로 바꾸는 논리를 처음부터 이해하고 직접 DCF를 계산할 수 있게 되는 단계입니다.', { formula: 'FCFF = NOPAT + D&A − CAPEX − ΔNWC\nTV = FCFF(n+1) / (WACC − g)' }],
  goals: ['장부가치·시장가치·경제적 가치를 구분한다.', '할인(시간가치)의 의미를 설명한다.', 'NOPAT → FCFF를 각 항목의 이유와 함께 말로 설명한다.', '가상기업의 DCF를 손으로 계산한다.'],
  lessons: [
    { id: 'l01', title: '기업가치란 무엇인가?', summary: '장부가치·시장가치·경제적 가치의 차이.', outline: ['핵심 질문: 기업은 왜 미래에 벌어들일 돈을 기준으로 평가할 수 있는가?'] },
    { id: 'l02', title: '화폐의 시간가치', summary: '오늘의 100만원 ≠ 5년 뒤의 100만원.', outline: [{ formula: '오늘의 100만원 ≠ 5년 뒤의 100만원' }, { list: ['투자기회', '위험', '시간'] }, '미래 현금을 현재 기준으로 비교하려면 할인해야 한다.'] },
    { id: 'l03', title: 'Present Value', summary: '미래 현금흐름을 할인한 값.', outline: [{ formula: 'PV = CF / (1 + r)^t' }, '할인율이 높아질수록 현재가치는 낮아진다.'] },
    { id: 'l04', title: 'FCF와 FCFF', summary: '필요한 투자를 한 뒤 자본 제공자 전체에 귀속되는 현금.', outline: ['사업을 유지하고 필요한 투자를 한 뒤 창출하는 현금. FCFF는 자본 제공자(채권자+주주) 전체 관점이다.'] },
    { id: 'l05', title: 'NOPAT', summary: '영업이익 기반의 세후 이익.', outline: [{ formula: 'NOPAT = EBIT × (1 − Tax Rate)' }, '왜 당기순이익이 아니라 영업활동 기반 이익에서 출발하는가?'] },
    { id: 'l06', title: '감가상각과 CAPEX 재등장', summary: 'STEP 01 개념을 FCFF 공식 안에서 다시 연결.', outline: [{ formula: '감가상각 → 영업이익에서는 비용 → 현금유출 아님 → FCFF에서 가산\nCAPEX → 실제 투자 현금유출 → FCFF에서 차감' }] },
    { id: 'l07', title: '순운전자본과 ΔNWC', summary: '운전자본 증가가 현금흐름에 미치는 영향.', outline: [{ formula: '매출채권 ↑ → 현금 묶임\n재고 ↑ → 현금 묶임\n매입채무 ↑ → 현금 지급 지연' }] },
    { id: 'l08', title: 'FCFF 공식 완성', summary: '각 항목을 왜 더하고 빼는지 말로 설명.', outline: [{ formula: 'FCFF = NOPAT + D&A − CAPEX − ΔNWC' }] },
    { id: 'l09', title: '미래 FCFF Forecast', summary: '근거 있는 가정 설정.', outline: [{ list: ['매출 성장률', '영업이익률', '세율', '감가상각', 'CAPEX', '운전자본'] }, '가정은 임의의 숫자가 아니라 근거가 필요하다.'] },
    { id: 'l10', title: 'Terminal Value', summary: '명시적 예측기간 이후의 가치.', outline: [{ formula: 'TV = FCFF(n+1) / (WACC − g)' }, '공식 암기보다 WACC와 g 변화가 TV에 미치는 영향을 이해한다.'] },
    { id: 'l11', title: 'DCF 구조 완성', summary: 'Forecast FCFF의 PV + TV의 PV = EV.', outline: [{ formula: 'Forecast FCFF → 각 연도 PV + Terminal Value PV → Enterprise Value' }] },
  ],
  quiz: [
    { id: 'q1', type: 'numeric', prompt: '1년 뒤 110을 받는다. 할인율 10%일 때 현재가치는?', answer: 100, tolerance: 0.01, unit: '', explain: '110 / 1.10 = 100' },
    { id: 'q2', type: 'numeric', prompt: 'EBIT 200, 세율 25% 일 때 NOPAT은?', answer: 150, tolerance: 0.01, unit: '', explain: '200 × (1 − 0.25) = 150' },
    { id: 'q3', type: 'numeric', prompt: 'NOPAT 150, D&A 30, CAPEX 50, ΔNWC 10 일 때 FCFF는?', answer: 120, tolerance: 0.01, unit: '', explain: '150 + 30 − 50 − 10 = 120' },
  ],
  practice: {
    title: '가상기업 DCF 손계산',
    brief: [
      '아래 가상기업 데이터로 손(또는 엑셀)으로 먼저 계산하고, 값을 입력해 엔진 결과와 대조하세요. 정답을 먼저 보여주지 않으며, 입력 후에 비교합니다.',
      { table: { head: ['가정', '값'], rows: [['Base Revenue', '1,000'], ['Revenue Growth', '10% (3년 모두)'], ['Operating Margin', '15%'], ['Tax Rate', '25%'], ['D&A', '매출의 4%'], ['CAPEX', '매출의 5%'], ['ΔNWC', '매출 증가분의 10%'], ['Discount Rate', '10%'], ['Terminal Growth', '2%']] } },
    ],
    fields: [{ group: '손계산 결과 입력', items: [
      { id: 'ebit1', label: '1년차 EBIT', kind: 'number' },
      { id: 'nopat1', label: '1년차 NOPAT', kind: 'number' },
      { id: 'fcff1', label: '1년차 FCFF', kind: 'number' },
      { id: 'fcff3', label: '3년차 FCFF', kind: 'number' },
      { id: 'tv', label: 'Terminal Value (3년차 말)', kind: 'number' },
      { id: 'ev', label: 'Enterprise Value', kind: 'number' },
    ] }],
    questions: [{ id: 'gap', prompt: '손계산과 엔진 결과가 다르다면 어디에서 차이가 났는가? 원인을 적으세요.' }],
    deliverables: ['EBIT', 'NOPAT', 'FCFF', 'Forecast', 'Terminal Value', 'Discounted FCFF', 'Enterprise Value'],
    extra: 'dcf-hand-check',
  },
  build: { title: '초기 DCF 계산 모듈', kind: 'dcf', description: ['가정을 입력하면 FCFF 예측 → 할인 → Terminal Value → Enterprise Value 를 단계별 표로 보여주는 계산 모듈. 계산은 UI와 분리된 engine/dcf.ts 에 있으며 STEP 05 에서 Python 으로 이식·검증합니다.'] },
  reflectionPrompts: ['TV 가 EV 에서 차지하는 비중을 보고 어떤 생각이 들었는가?', 'FCFF 의 각 항목을 면접에서 1분 안에 설명한다면?', '가장 근거 잡기 어려웠던 가정은?'],
  evolution: { manual: '가상기업 DCF 를 손으로 계산했다.', problem: '연도 수·가정이 바뀔 때마다 처음부터 다시 계산해야 한다.', automated: '가정 입력 기반 DCF 계산 모듈 (UI 와 분리된 순수 함수).' },
};

export const step03: Step = { ...base, lessons: base.lessons.map((l) => ({ ...l, body: bodies03[l.id] })) };
