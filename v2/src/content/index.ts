import type { Step } from '../types';
import { step01 } from './step01';
import { step02 } from './step02';
import { step03 } from './step03';
import { step04 } from './step04';
import { step05 } from './step05';
import { step06 } from './step06';
import { step07 } from './step07';
import { step08 } from './step08';

export const steps: Step[] = [step01, step02, step03, step04, step05, step06, step07, step08];
export const getStep = (id: number) => steps.find((s) => s.id === id);

export const BRAND = {
  name: 'ValuFlow',
  tagline: 'From Financial Statements to AI-powered Valuation.',
  hero: 'Learn Valuation. Automate the Workflow.',
  sub: ['재무제표를 직접 읽는 것부터 DCF, WACC, 데이터 자동화, AI Agent까지.', '가치평가 업무를 이해하고 단계적으로 자동화하는 프로젝트.'],
};

/** 완료된 Step 01 학습의 시작 상태(명세 12절): STEP 01 은 IN PROGRESS, 실습 미션이 다음 작업. */
export const SEED_COMPLETED_LESSONS = ['1:l01', '1:l02', '1:l03', '1:l04', '1:l05', '1:l06'];

export const finalArchitecture = [
  '기업 검색', 'OpenDART 재무데이터 수집', 'Financial Data Parser', 'Database', 'Financial Analysis Engine',
  'DCF / WACC Engine', 'Sensitivity Analysis', '공시자료 RAG', 'AI Valuation Agent', 'Valuation Dashboard', 'Valuation Report',
];
