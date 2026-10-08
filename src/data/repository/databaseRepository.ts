// backend(FastAPI + PostgreSQL) 기반 저장소. Database 우선 → 없거나 refresh 면 OpenDART → backend 가 정규화·저장한 결과를 받는다.
// 프론트는 DB 세부사항을 모르고 FinancialRepository interface 만 구현한다. 정규화는 backend 가 하므로 여기서 다시 하지 않는다.
// fixture 로 대체하지 않는다: 미지원 / 불완전 / 조회 실패는 사유 그대로 돌려준다.
import { DartClientError, type DartClient } from '../dart/client.ts';
import type { DartCompanyDetail, DartCompanySummary, DartHistoricalResponse } from '../dart/types.ts';
import type { HistoricalData } from '../types.ts';
import type { DataQuality } from '../normalization/quality.ts';
import { defaultFiscalYears } from './dartRepository.ts';
import type { CompanyProfile, CompanyRef, FinancialRepository, HistoricalFinancialsRequest, HistoricalFinancialsResult } from './financialRepository.ts';

const fromSummary = (c: DartCompanySummary): CompanyProfile => ({ name: c.corpName, corpCode: c.corpCode, ...(c.stockCode ? { stockCode: c.stockCode } : {}), source: 'OpenDART' });
const fromDetail = (c: DartCompanyDetail): CompanyProfile => ({
  name: c.corpName, corpCode: c.corpCode, ...(c.stockCode ? { stockCode: c.stockCode } : {}),
  ...(c.corpNameEng ? { nameEng: c.corpNameEng } : {}), ...(c.corpClass ? { corpClass: c.corpClass } : {}), source: 'OpenDART', fetchedAt: c.fetchedAt,
});

export class DatabaseFinancialRepository implements FinancialRepository {
  private readonly client: DartClient;
  private readonly now: () => Date;
  constructor(client: DartClient, now: () => Date = () => new Date()) { this.client = client; this.now = now; }

  async searchCompanies(query: string): Promise<CompanyProfile[]> {
    return (await this.client.searchCompanies({ query })).map(fromSummary);
  }

  async getCompany(ref: CompanyRef): Promise<CompanyProfile | null> {
    if (!ref.corpCode) return null;
    return fromDetail(await this.client.getCompany(ref.corpCode));
  }

  async getHistoricalFinancials(request: HistoricalFinancialsRequest): Promise<HistoricalFinancialsResult> {
    if (!request.corpCode) return { ok: false, reason: 'not-found', message: 'corpCode 가 필요합니다 (기업을 먼저 선택하세요).' };
    const years = request.fiscalYears ?? defaultFiscalYears(this.now());
    let res: DartHistoricalResponse<HistoricalData, DataQuality>;
    try {
      res = await this.client.getHistorical({ corpCode: request.corpCode, years, basis: request.basisMode ?? (request.preferredBasis === 'Separate' ? 'separate' : 'auto'), refresh: request.refresh }) as DartHistoricalResponse<HistoricalData, DataQuality>;
    } catch (e) {
      const message = e instanceof DartClientError ? e.message : '재무제표를 가져오지 못했습니다.';
      return { ok: false, reason: e instanceof DartClientError && e.code === 'no-data' ? 'not-found' : 'unavailable', message };
    }
    const provenance = { source: res.source, persisted: res.persisted, fetchedAt: res.fetchedAt, fetchId: res.fetchId };
    if (res.status === 'ok' && res.data) return { ok: true, data: res.data, quality: res.quality, fetch: res.fetch, provenance };
    if (res.status === 'unsupported') {
      return { ok: false, reason: 'unsupported', code: res.code === 'unsupported-industry' ? 'unsupported-industry' : 'unsupported-structure', message: res.reason ?? '', quality: res.quality, fetch: res.fetch, provenance };
    }
    return { ok: false, reason: 'incomplete', message: res.reason ?? '필수 계정을 찾지 못했습니다.', quality: res.quality, fetch: res.fetch, provenance };
  }
}
