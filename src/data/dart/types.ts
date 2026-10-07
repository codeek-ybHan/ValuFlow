// External API 계층의 Raw Model.
// OpenDART 응답을 최대한 원본에 가깝게 담는다. revenue / capex 같은 ValuFlow business field 로는 변환하지 않는다
// (변환은 normalization/ 의 책임이다). UI 와 Valuation Engine 은 이 타입을 import 하지 않는다.

/** 재무제표 종류. BS 재무상태표 · IS 손익계산서 · CIS 포괄손익계산서 · CF 현금흐름표 · SCE 자본변동표 */
export type DartStatementType = 'BS' | 'IS' | 'CIS' | 'CF' | 'SCE';

/** 연결(Consolidated) / 별도(Separate). OpenDART 의 fs_div: CFS = 연결, OFS = 별도. */
export type DartBasis = 'Consolidated' | 'Separate';

/** 원본 금액 단위. KRW = 원, thousand = 천원, million = 백만원. */
export type DartRawUnit = 'KRW' | 'thousand' | 'million';

export interface DartRawAccount {
  /** 공시에 적힌 계정명 그대로 (예: "영업이익(손실)"). */
  accountName: string;
  /** XBRL 계정 ID (예: "ifrs-full_Revenue"). 없을 수 있다. */
  accountId?: string;
  statementType: DartStatementType;
  basis: DartBasis;
  /** 해당 금액이 속한 회계연도. 상대 표기(당기/전기)만 있으면 null 로 두고 periodLabel 을 채운다. */
  fiscalYear: number | null;
  /** 공시의 기간 표기 (예: "당기", "전기", "전전기"). fiscalYear 가 없을 때 reportYear 와 함께 해석한다. */
  periodLabel?: string;
  /** 이 계정을 담은 보고서의 사업연도. 상대 기간을 해석하는 기준이다. */
  reportYear?: number;
  /** 파싱된 금액. 원본 문자열을 숫자로 바꿀 수 없으면 null. 단위 환산 전 값이다. */
  amount: number | null;
  currency?: string;
  unit?: DartRawUnit;
  /** 응답 행 전체 (원본 보존용). Normalization 은 읽기만 한다. */
  raw: Readonly<Record<string, unknown>>;
}

/** backend 가 돌려주는 검색 결과 한 건. OpenDART 원본이 아니라 backend 가 변환한 구조다. */
export interface DartCompanySummary {
  corpCode: string;
  corpName: string;
  /** 비상장사는 null. */
  stockCode: string | null;
  modifyDate: string | null;
}

/** backend 가 돌려주는 기업개황. OpenDART 원본 필드명은 backend 안에서 변환된다. */
export interface DartCompanyDetail {
  corpCode: string;
  corpName: string;
  corpNameEng: string | null;
  stockCode: string | null;
  ceoName: string | null;
  /** Y 유가 · K 코스닥 · N 코넥스 · E 기타 */
  corpClass: string | null;
  address: string | null;
  homepage: string | null;
  industryCode: string | null;
  /** YYYY-MM-DD */
  establishmentDate: string | null;
  fiscalMonth: number | null;
  source: 'OpenDART';
  /** backend 가 OpenDART 에서 조회한 시각 (ISO 8601). */
  fetchedAt: string;
}

/** backend 오류 코드. backend 의 ErrorCode 와 같고, 서버에 닿지 못한 경우만 프론트에서 추가한다. */
export type DartErrorCode = 'invalid-key' | 'no-data' | 'rate-limit' | 'dart-unavailable' | 'invalid-request' | 'unknown' | 'backend-unreachable';
