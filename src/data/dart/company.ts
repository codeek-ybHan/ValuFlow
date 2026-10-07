// 기업 조회 요청 모델.

export interface DartCompanyQuery {
  /** 기업명 일부 또는 종목코드(6자리). */
  query: string;
  /** 결과 수 상한. 비우면 backend 기본값. */
  limit?: number;
}
