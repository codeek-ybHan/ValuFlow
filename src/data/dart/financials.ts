// 재무제표 요청 모델. 프론트는 OpenDART 파라미터(reprt_code, fs_div, bsns_year …)를 모른다: backend 가 사업보고서 기준으로 변환한다.

export type DartBasisMode = 'auto' | 'consolidated' | 'separate';

export interface DartFinancialsRequest {
  corpCode: string;
  /** 가져올 회계연도. 예: [2023, 2024, 2025] */
  years: number[];
  /** auto: 연결을 먼저 시도하고 없거나 불완전하면 별도 전체로 전환 (섞지 않는다). 기본 auto. */
  basis?: DartBasisMode;
  /** true 면 backend cache 를 건너뛴다. */
  refresh?: boolean;
}
