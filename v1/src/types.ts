// 학습 콘텐츠 데이터 모델. 컴포넌트에는 STEP별 내용을 넣지 않고 모두 이 구조로 content/ 에서 관리한다.

export type RichBlock =
  | string
  | { formula: string }
  | { table: { head: string[]; rows: string[][] } }
  | { list: string[] }
  | { callout: string };
export type Rich = RichBlock[];

export interface MiniCheck {
  q: string;
  a: string;
}

/** Lesson 내부 구조: 개념 / 직관 / 숫자 예시 / 가치평가 연결 / 실무 중요성 / Mini Check */
export interface LessonBody {
  concept: Rich;
  intuition: Rich;
  example: Rich;
  link: Rich;
  why: Rich;
  miniCheck: MiniCheck[];
}

export interface Lesson {
  id: string; // 'l01'
  title: string;
  summary: string;
  /** 명세 기반 학습 개요. body 가 없는 Lesson 은 이것만 표시된다. */
  outline?: Rich;
  /** 6단 구조의 상세 해설. 없으면 '해설 작성 예정'으로 정직하게 표시한다. */
  body?: LessonBody;
}

export type QuizQuestion =
  | { id: string; type: 'choice'; prompt: string; options: string[]; answer: number; explain: string }
  | { id: string; type: 'numeric'; prompt: string; answer: number; tolerance: number; unit: string; explain: string }
  | { id: string; type: 'reflect'; prompt: string; modelAnswer: string };

export interface PracticeField {
  id: string;
  label: string;
  kind: 'text' | 'number';
  hint?: string;
}

export interface PracticeConfig {
  title: string;
  brief: Rich;
  /** 데이터 입력 필드 (그룹 단위) */
  fields?: { group: string; items: PracticeField[] }[];
  /** 서술형 분석 질문 */
  questions: { id: string; prompt: string }[];
  deliverables?: string[];
  /** 전용 보조 위젯 */
  extra?: 'dataset-import' | 'three-year' | 'dcf-hand-check';
}

export type BuildKind = 'dataset' | 'analysis' | 'dcf' | 'valuation' | 'planned';

export interface BuildConfig {
  title: string;
  description: Rich;
  kind: BuildKind;
  /** kind === 'planned' 일 때: 아직 구현되지 않았음을 명시하고 설계만 보여준다. */
  planned?: { comingIn: string; modules: string[]; architecture?: string };
}

export interface Evolution {
  manual: string; // What I did manually
  problem: string; // What problem I found
  automated: string; // What I automated
}

export interface Step {
  id: number;
  code: string; // 'STEP 01'
  title: string;
  short: string; // Roadmap 표기
  subtitle: string;
  overview: Rich;
  goals: string[];
  lessons: Lesson[];
  quiz?: QuizQuestion[];
  practice: PracticeConfig;
  build: BuildConfig;
  reflectionPrompts: string[];
  evolution: Evolution;
}

// ---- 사용자 데이터 (학습 콘텐츠와 분리된 상태) ----

export interface FinancialRecord {
  id: string;
  company: string;
  year: number;
  unit: string; // '백만원' 등
  basis: '연결' | '별도';
  // STEP 01 핵심 9항목
  assets?: number;
  liabilities?: number;
  equity?: number;
  revenue?: number;
  operatingIncome?: number;
  netIncome?: number;
  cfo?: number;
  cfi?: number;
  cff?: number;
  // STEP 02~03 확장 항목
  grossProfit?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  receivables?: number;
  inventory?: number;
  payables?: number;
  da?: number;
  capex?: number;
  cash?: number;
  debt?: number;
}

export interface LessonNotes {
  understood: string;
  confusing: string;
  formula: string;
  practice: string;
  interview: string;
}
