// Workspace 가 OpenDART 를 직접 알지 않도록 하는 경계.
// 구현체: FixtureFinancialRepository (현재) → DartFinancialRepository / DatabaseFinancialRepository (이후).
import type { HistoricalData } from '../types.ts';
import type { DartBasis } from '../dart/types.ts';
import type { DataQuality } from '../normalization/quality.ts';

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
  /** 비우면 저장소가 가진 최신 3개년. */
  fiscalYears?: number[];
  preferredBasis?: DartBasis;
}

export type HistoricalFinancialsResult =
  | { ok: true; data: HistoricalData; quality: DataQuality }
  | { ok: false; reason: 'not-found' | 'incomplete' | 'unavailable' | 'not-implemented'; message: string; quality?: DataQuality };

export interface FinancialRepository {
  searchCompanies(query: string): Promise<CompanyProfile[]>;
  getCompany(ref: CompanyRef): Promise<CompanyProfile | null>;
  getHistoricalFinancials(request: HistoricalFinancialsRequest): Promise<HistoricalFinancialsResult>;
}
