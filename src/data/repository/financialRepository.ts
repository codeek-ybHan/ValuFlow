// Workspace 가 OpenDART 를 직접 알지 않도록 하는 경계.
// 구현체: FixtureFinancialRepository (현재) → DartFinancialRepository / DatabaseFinancialRepository (이후).
import type { HistoricalData } from '../types.ts';
import type { DartBasis } from '../dart/types.ts';
import type { DataQuality } from '../normalization/quality.ts';
import type { DartFetchQuality } from '../dart/types.ts';

/** 결과의 출처: database 에서 읽었는지, 방금 OpenDART 에서 가져왔는지, DB 에 저장되었는지 (DatabaseFinancialRepository 가 채운다). */
export interface Provenance {
  source: 'database' | 'opendart';
  persisted: boolean;
  fetchedAt: string;
  fetchId: number | null;
}

export interface CompanyProfile {
  name: string;
  corpCode?: string;
  /** 비상장사는 없다. */
  stockCode?: string;
  nameEng?: string;
  corpClass?: string;
  source: 'OpenDART' | 'Fixture';
  /** 조회 시각. 검색 결과 목록에는 없고 개황 조회 결과에만 있다. */
  fetchedAt?: string;
}

/** 기업 식별자. OpenDART 는 corpCode, fixture 는 stockCode 로 찾는다. */
export interface CompanyRef {
  corpCode?: string;
  stockCode?: string;
}

export interface HistoricalFinancialsRequest extends CompanyRef {
  /** HistoricalData.company.name 에 쓸 이름. 없으면 corpCode 를 쓴다. */
  companyName?: string;
  /** true 면 저장된 결과를 건너뛰고 원천(OpenDART)을 다시 조회한다 (DatabaseFinancialRepository). */
  refresh?: boolean;
  /** 비우면 저장소가 가진 최신 3개년. */
  fiscalYears?: number[];
  preferredBasis?: DartBasis;
}

export type HistoricalFinancialsResult =
  | { ok: true; data: HistoricalData; quality: DataQuality; fetch?: DartFetchQuality; provenance?: Provenance }
  | { ok: false; reason: 'not-found' | 'incomplete' | 'unavailable' | 'not-implemented' | 'unsupported'; message: string; quality?: DataQuality; fetch?: DartFetchQuality; /** unsupported 일 때 구분 */ code?: 'unsupported-industry' | 'unsupported-structure'; provenance?: Provenance };

export interface FinancialRepository {
  searchCompanies(query: string): Promise<CompanyProfile[]>;
  getCompany(ref: CompanyRef): Promise<CompanyProfile | null>;
  getHistoricalFinancials(request: HistoricalFinancialsRequest): Promise<HistoricalFinancialsResult>;
}
