// External API 의 경계. 실제 구현(DartHttpClient)은 STEP 06-2 에서 추가한다.
// 이 interface 를 통해서만 OpenDART 를 부르므로, UI / Engine / Repository 는 HTTP 세부사항을 모른다.
import type { DartCompanyQuery } from './company.ts';
import type { DartFinancialsRequest } from './financials.ts';
import type { DartRawAccount, DartRawCompany } from './types.ts';

export interface DartClient {
  searchCompanies(query: DartCompanyQuery): Promise<DartRawCompany[]>;
  fetchFinancials(request: DartFinancialsRequest): Promise<DartRawAccount[]>;
}

/** 아직 연결되지 않은 클라이언트. 호출하면 명확한 오류를 던진다 (조용히 빈 값을 돌려주지 않는다). */
export const unconnectedDartClient: DartClient = {
  searchCompanies: () => Promise.reject(new Error('OpenDART 연결은 STEP 06-2 에서 구현됩니다.')),
  fetchFinancials: () => Promise.reject(new Error('OpenDART 연결은 STEP 06-2 에서 구현됩니다.')),
};
