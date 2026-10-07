// OpenDART 기업 조회 요청 모델. (STEP 06-1: 타입만 정의하고 HTTP 호출은 구현하지 않는다.)

export interface DartCompanyQuery {
  /** 기업명 일부 또는 종목코드(6자리) 또는 corp_code(8자리). */
  query: string;
}
