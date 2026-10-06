import type { Step } from '../types';
import { step01 } from './step01';
import { step02 } from './step02';
import { step03 } from './step03';
import { step04 } from './step04';

// LEARN 은 STEP 01~04 만 포함한다. STEP 05~10 은 PROJECT 로드맵(content/roadmap.ts).
export const steps: Step[] = [step01, step02, step03, step04];
export const getStep = (id: number) => steps.find((s) => s.id === id);

export const BRAND = {
  name: 'ValuFlow',
  tagline: 'From Financial Statements to AI-powered Valuation.',
  hero: 'Learn Valuation.',
  sub: ['재무제표, 재무분석, DCF, WACC 까지 가치평가 업무의 원리를 이해하는 학습 공간.', '여기서 익힌 로직을 PROJECT 영역의 Valuation Engine 으로 구현합니다.'],
};

/** 완료된 Step 01 학습의 시작 상태(명세 12절): STEP 01 은 IN PROGRESS, 실습 미션이 다음 작업. */
export const SEED_COMPLETED_LESSONS = ['1:l01', '1:l02', '1:l03', '1:l04', '1:l05', '1:l06'];

export const finalArchitecture = [
  '기업 선택', '재무데이터', 'Historical Analysis', 'Forecast Assumptions', 'Valuation Engine', 'DCF / WACC',
  'Relative Valuation', 'Sensitivity / Scenario', 'AI Analyst', 'Valuation Report',
];
