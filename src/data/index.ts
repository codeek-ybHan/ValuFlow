// Financial Data Pipeline 공개 진입점. 화면 / store 는 이 파일(또는 repository interface)만 import 한다.
export type { HistoricalData, HistoricalMeta, HistoricalSource } from './types.ts';
export type { FinancialRepository, CompanyProfile, HistoricalFinancialsRequest, HistoricalFinancialsResult } from './repository/financialRepository.ts';
export { FixtureFinancialRepository } from './repository/fixtureRepository.ts';
export { normalizeFinancials } from './normalization/normalizeFinancials.ts';
export type { NormalizeInput, NormalizeResult } from './normalization/normalizeFinancials.ts';
export type { DataQuality, FieldQuality, FieldStatus } from './normalization/quality.ts';
export { capexForValuation } from './normalization/derived.ts';
