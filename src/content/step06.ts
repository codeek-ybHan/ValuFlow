import type { Step } from '../types';

export const step06: Step = {
  id: 6,
  code: 'STEP 06',
  title: 'Financial Data Automation',
  short: 'Data Automation',
  subtitle: '재무데이터 수집 자동화',
  overview: ['STEP 01 에서 사람이 사업보고서를 열고 직접 입력했던 작업을 OpenDART 와 DB 로 자동화하는 단계입니다.'],
  goals: ['OpenDART API 로 기업·재무제표를 조회한다.', '계정과목을 내부 표준 스키마로 매핑한다.', '정제 후 PostgreSQL 에 저장하고 SQL 로 3개년 추세를 조회한다.', 'STEP 01 수동 데이터와 API 데이터를 비교 검증한다.'],
  lessons: [
    { id: 'l01', title: '공시 데이터 이해', summary: 'DART, 사업보고서, 연결/별도, 계정과목, 보고기간.', outline: [{ list: ['DART', '사업보고서', '재무제표', '연결재무제표', '별도재무제표', '계정과목', '보고기간'] }] },
    { id: 'l02', title: 'OpenDART API', summary: '요청/응답, 고유번호, 보고서 코드, JSON.', outline: [{ list: ['API 요청/응답', '기업 고유번호', '보고서 코드', '재무제표 조회', 'JSON 데이터'] }] },
    { id: 'l03', title: '기업 검색과 corp_code', summary: '기업명으로 조회하는 검색 Flow.', outline: ['기업명만으로 필요한 데이터를 조회할 수 있는 검색 Flow 를 만든다.'] },
    { id: 'l04', title: '계정과목 Mapping', summary: '내부 표준 Schema 로 변환.', outline: [{ list: ['revenue', 'operating_income', 'net_income', 'assets', 'liabilities', 'equity', 'operating_cash_flow', 'capex'] }, '기업/보고서마다 계정명이 다른 문제.'] },
    { id: 'l05', title: '데이터 정제', summary: '숫자 변환, 단위, 결측, 중복, 연도, 연결/별도.', outline: [{ list: ['숫자 변환', '단위', '결측값', '중복', '연도', '연결/별도 구분'] }] },
    { id: 'l06', title: 'DB 설계', summary: 'PostgreSQL 스키마.', outline: [{ list: ['companies', 'financial_statements', 'financial_items', 'valuation_assumptions', 'valuation_results'] }] },
    { id: 'l07', title: 'SQL 활용', summary: '연도·기업별 조회와 3개년 추세 Query.', outline: ['필요한 연도와 기업의 데이터를 조회하고 3개년 추세를 만드는 Query 를 작성한다.'] },
    { id: 'l08', title: 'Data Pipeline', summary: '검색 → OpenDART → Parser → Normalizer → DB → 분석.', outline: [{ formula: 'Company Search → OpenDART → Parser → Normalizer\n→ Database → Financial Analysis Engine → Valuation Engine' }] },
  ],
  practice: {
    title: 'Manual Data vs OpenDART Data',
    brief: ['STEP 01 에서 직접 입력한 동일 기업/연도의 숫자를 API 로 수집하고 비교합니다. 불일치가 있으면 원인을 분석합니다.'],
    questions: [
      { id: 'compare', prompt: '항목별 Manual vs OpenDART 값 비교' },
      { id: 'cause', prompt: '불일치 원인 (계정 매핑, 단위, 연결/별도, 정정공시 등)' },
      { id: 'rule', prompt: '정제/매핑 규칙으로 반영한 내용' },
    ],
    deliverables: ['DART Pipeline Validation'],
  },
  build: {
    title: '기업 선택 → 자동수집 → DB 저장 → 분석', kind: 'planned',
    description: ['OpenDART 수집 파이프라인과 DB. 현재 개발 예정이며 수집 결과를 임의로 생성하지 않습니다.'],
    planned: { comingIn: 'Coming in STEP 06', modules: ['Company Search (corp_code)', 'OpenDART Client', 'Parser', 'Normalizer (계정 매핑)', 'PostgreSQL 저장', '분석 자동 실행'], architecture: 'Company Search → OpenDART → Parser → Normalizer → Database → Financial Analysis Engine' },
  },
  reflectionPrompts: ['매핑이 가장 어려웠던 계정과목은?', '수동 입력 대비 시간/오류가 어떻게 달라졌는가?'],
  evolution: { manual: '사업보고서를 열어 숫자를 복사·입력했다.', problem: '기업/연도 수가 늘면 시간이 비례해 늘고 단위·계정명 오류가 생긴다.', automated: 'OpenDART 수집 → 정규화 → DB 저장 파이프라인.' },
};
