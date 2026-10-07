// Workspace 가 OpenDART 를 직접 알지 않도록 하는 경계.
// 구현체: FixtureFinancialRepository (현재) → DartFinancialRepository / DatabaseFinancialRepository (이후).
import type { HistoricalData } from '../types.ts';
import type { DartBasis } from '../dart/types.ts';
import type { DataQuality } from '../normalization/quality.ts';

export interface CompanyProfile {
  name: string;
  corpCode?: string;
  stockCode: string;
}

export interface HistoricalFinancialsRequest {
  stockCode: string;
  /** 비우면 저장소가 가진 최신 3개년. */
  fiscalYears?: number[];
  preferredBasis?: DartBasis;
}

export type HistoricalFinancialsResult =
  | { ok: true; data: HistoricalData; quality: DataQuality }
  | { ok: false; reason: 'not-found' | 'incomplete' | 'unavailable'; message: string; quality?: DataQuality };

export interface FinancialRepository {
  searchCompanies(query: string): Promise<CompanyProfile[]>;
  getCompany(stockCode: string): Promise<CompanyProfile | null>;
  getHistoricalFinancials(request: HistoricalFinancialsRequest): Promise<HistoricalFinancialsResult>;
}
