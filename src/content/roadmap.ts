// PROJECT 개발 로드맵 (기획서 9절). LEARN(STEP 01~04) 이후의 제품 구현 단계다.
// 완료 여부는 코드 상태를 반영해 직접 갱신한다. Phase 1 시점에서는 구현된 STEP 이 없다.

export type RoadmapStatus = 'NEXT' | 'LOCKED';

export interface ProjectStep {
  code: string;
  title: string;
  summary: string;
  status: RoadmapStatus;
}

export const projectRoadmap: ProjectStep[] = [
  { code: 'STEP 05', title: 'Valuation Engine v1', summary: 'TypeScript 계산 엔진: Forecast · FCFF · WACC · DCF · Sensitivity', status: 'NEXT' },
  { code: 'STEP 06', title: 'Financial Data Pipeline', summary: 'OpenDART 수집 · 정규화 · DB 적재', status: 'LOCKED' },
  { code: 'STEP 07', title: 'Valuation Workspace', summary: 'Forecast · WACC · DCF · Equity Value 화면 연결', status: 'LOCKED' },
  { code: 'STEP 08', title: 'AI Valuation Analyst', summary: '계산 결과 해석과 근거 검색 (계산은 Engine 이 수행)', status: 'LOCKED' },
  { code: 'STEP 09', title: 'Report Automation', summary: 'Valuation Report 생성과 PDF 내보내기', status: 'LOCKED' },
  { code: 'STEP 10', title: 'Final Product', summary: '기업 선택부터 Report 까지 End-to-End 흐름', status: 'LOCKED' },
];
