// PROJECT 개발 로드맵 (기획서 9절). LEARN(STEP 01~04) 이후의 제품 구현 단계다.
// 완료 여부는 구현 상태를 반영해 직접 갱신한다 (STEP 05 Valuation Engine, STEP 07 Valuation Workspace 완료).

export type RoadmapStatus = 'COMPLETE' | 'NEXT' | 'LOCKED';

export interface ProjectStep {
  code: string;
  title: string;
  summary: string;
  status: RoadmapStatus;
}

export const projectRoadmap: ProjectStep[] = [
  { code: 'STEP 05', title: 'Valuation Engine v1', summary: 'TypeScript 계산 엔진: Forecast · FCFF · WACC · DCF · Sensitivity · Scenario · 상대가치', status: 'COMPLETE' },
  { code: 'STEP 06', title: 'Financial Data Pipeline', summary: 'OpenDART 수집 · 정규화 · DB 적재', status: 'NEXT' },
  { code: 'STEP 07', title: 'Valuation Workspace', summary: 'Historical · Forecast · WACC · DCF/Equity · Result · Validation 통합 화면', status: 'COMPLETE' },
  { code: 'STEP 08', title: 'AI Valuation Analyst', summary: '계산 결과 해석과 근거 검색 (계산은 Engine 이 수행)', status: 'LOCKED' },
  { code: 'STEP 09', title: 'Report Automation', summary: 'Valuation Report 생성과 PDF 내보내기', status: 'LOCKED' },
  { code: 'STEP 10', title: 'Final Product', summary: '기업 선택부터 Report 까지 End-to-End 흐름', status: 'LOCKED' },
];
