import type { Step } from '../types';

export const step08: Step = {
  id: 8,
  code: 'STEP 08',
  title: 'Final Product',
  short: 'Final Product',
  subtitle: 'End-to-End Valuation Platform',
  overview: ['지금까지의 학습 결과와 자동화 기능을 실제 가치평가 업무지원 Web Application 으로 통합하는 단계입니다.', { formula: '기업 선택 → 데이터 자동수집 → 재무분석 → Valuation → 공시검색 → AI Interpretation → Report' }],
  goals: ['수작업 vs 자동화 Workflow 의 Before/After 를 보인다.', '사용자 Flow 와 Assumption UI 를 설계한다.', 'Report 를 생성한다.', '최종 시스템을 검증한다.'],
  lessons: [
    { id: 'l01', title: '전체 Valuation Workflow 재설계', summary: 'Before / After.', outline: [{ formula: '수작업: 사업보고서 탐색 → 재무정보 복사 → 데이터 정리 → 재무비율 계산 → Forecast → WACC → DCF → Sensitivity → 자료 검색 → 분석 → Report' }, { formula: '자동화: 기업 선택 → 데이터 자동수집 → 재무분석 → Valuation → 공시검색 → AI Interpretation → Report' }] },
    { id: 'l02', title: '사용자 Flow', summary: 'Company Search → … → Report.', outline: [{ formula: 'Company Search → Company Overview → Financial Dashboard → Historical Analysis\n→ Assumption Setting → WACC → DCF → Sensitivity → AI Analysis → Source Evidence → Report' }] },
    { id: 'l03', title: 'Valuation Dashboard', summary: '핵심 지표 표시.', outline: [{ list: ['Revenue', 'Operating Income', 'Operating Margin', 'CFO', 'CAPEX', 'FCFF', 'WACC', 'Enterprise Value', 'Equity Value'] }] },
    { id: 'l04', title: 'Assumption UI', summary: '가정 확인/수정.', outline: [{ list: ['Revenue Growth', 'Margin', 'Tax Rate', 'CAPEX', 'NWC', 'WACC', 'Terminal Growth'] }, 'AI 가 제안하더라도 최종 가정은 사용자가 확인할 수 있어야 한다.'] },
    { id: 'l05', title: 'AI Analysis UI', summary: '분석 화면과 연결된 AI.', outline: ['단순 Chatbot 이 아니라 분석 화면과 연결한다. 예: "왜 2025년 영업이익률이 하락했어?" → 현재 기업 데이터 + 공시자료 기반 답변.'] },
    { id: 'l06', title: 'Report Generation', summary: '12개 섹션 Report, PDF 는 선택.', outline: [{ list: ['Executive Summary', 'Company Overview', 'Historical Financial Analysis', 'Forecast Assumptions', 'FCFF Forecast', 'WACC', 'DCF Valuation', 'Sensitivity Analysis', 'Comparable Valuation', 'Risk Factors', 'AI-assisted Interpretation', 'Sources / Assumptions'] }] },
    { id: 'l07', title: '검증', summary: '최종 시스템 검증.', outline: [{ list: ['데이터가 원문과 일치하는가?', '계산 결과가 수기 모델과 일치하는가?', 'Agent 가 임의 숫자를 만들지 않는가?', 'RAG 근거가 질문과 관련 있는가?', '같은 입력에서 계산이 재현되는가?'] }] },
    { id: 'l08', title: '배포 및 운영', summary: '선택: Docker, Cloud, K8s, CI/CD, 모니터링.', outline: [{ list: ['Docker', 'Cloud', 'Kubernetes', 'CI/CD', 'Logging', 'Monitoring'] }, '인프라 자체가 프로젝트 목적이 되지 않도록 한다.'] },
  ],
  practice: {
    title: 'End-to-End Valuation Case Study',
    brief: ['실제 기업 하나를 선택해 처음부터 끝까지 수행합니다.', { formula: '기업 선택 → 재무데이터 → Historical Analysis → Forecast → WACC → DCF\n→ Sensitivity → 공시 RAG → Risk Analysis → AI Interpretation → Final Report' }],
    questions: [
      { id: 'company', prompt: '선택한 기업과 선택 이유' },
      { id: 'summary', prompt: 'Valuation 결과 요약 (EV / Equity Value / 핵심 가정)' },
      { id: 'validation', prompt: '검증 결과 (원문·수기·재현성)' },
      { id: 'limits', prompt: '한계와 개선 방향' },
    ],
    deliverables: ['Valuation Case Study'],
  },
  build: {
    title: '최종 Web Application + Portfolio Report', kind: 'planned',
    description: ['STEP 03~07 의 결과를 하나의 서비스로 통합합니다. 현재 개발 예정이며, 통합 전 결과를 임의로 만들지 않습니다.'],
    planned: { comingIn: 'Coming in STEP 08', modules: ['Company Search / Overview', 'Financial Dashboard', 'Assumption UI', 'Valuation (WACC · DCF · Sensitivity)', 'AI Analysis + Source Evidence', 'Report Generation (PDF 선택)'] },
  },
  reflectionPrompts: ['전체 프로젝트에서 가장 큰 자동화 효과가 있었던 구간은?', '자동화하지 않은 것(사람이 판단해야 하는 것)은 무엇이고 왜?', '면접에서 이 프로젝트를 3분으로 설명한다면?'],
  evolution: { manual: '데이터 수집부터 Report 까지 전 과정을 수작업으로 경험했다.', problem: '단계 간 이동 시 복사·붙여넣기, 재계산, 근거 정리가 반복된다.', automated: '기업 선택 한 번으로 수집→분석→Valuation→공시검색→Report 를 연결한 플랫폼.' },
};
