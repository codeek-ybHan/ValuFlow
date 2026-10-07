// OpenDART 기반 저장소. 기업 검색 / 개황 + 재무제표(Raw fetch → normalizeFinancials).
// 정규화가 실패하거나 데이터가 없으면 incomplete / unavailable 을 돌려준다. fixture 로 대체하지 않는다.
import { DartClientError, type DartClient } from '../dart/client.ts';
import type { DartCompanyDetail, DartCompanySummary } from '../dart/types.ts';
import { normalizeFinancials } from '../normalization/normalizeFinancials.ts';
import type { CompanyProfile, CompanyRef, FinancialRepository, HistoricalFinancialsRequest, HistoricalFinancialsResult } from './financialRepository.ts';

const fromSummary = (c: DartCompanySummary): CompanyProfile => ({ name: c.corpName, corpCode: c.corpCode, ...(c.stockCode ? { stockCode: c.stockCode } : {}), source: 'OpenDART' });

const fromDetail = (c: DartCompanyDetail): CompanyProfile => ({
  name: c.corpName, corpCode: c.corpCode, ...(c.stockCode ? { stockCode: c.stockCode } : {}),
  ...(c.corpNameEng ? { nameEng: c.corpNameEng } : {}), ...(c.corpClass ? { corpClass: c.corpClass } : {}),
  source: 'OpenDART', fetchedAt: c.fetchedAt,
});

/** 가장 최근에 공시가 끝났을 가능성이 높은 3개 사업연도. 사업보고서는 보통 3월 말까지 제출되므로 4월 이후면 직전 연도까지. */
export function defaultFiscalYears(now: Date): number[] {
  const last = now.getFullYear() - (now.getMonth() >= 3 ? 1 : 2);
  return [last - 2, last - 1, last];
}

export class DartFinancialRepository implements FinancialRepository {
  private readonly client: DartClient;
  private readonly now: () => Date;
  constructor(client: DartClient, now: () => Date = () => new Date()) { this.client = client; this.now = now; }

  async searchCompanies(query: string): Promise<CompanyProfile[]> {
    return (await this.client.searchCompanies({ query })).map(fromSummary);
  }

  /** corpCode 로 기업개황을 조회한다. corpCode 가 없으면 조회할 수 없다. */
  async getCompany(ref: CompanyRef): Promise<CompanyProfile | null> {
    if (!ref.corpCode) return null;
    return fromDetail(await this.client.getCompany(ref.corpCode));
  }

  async getHistoricalFinancials(request: HistoricalFinancialsRequest): Promise<HistoricalFinancialsResult> {
    if (!request.corpCode) return { ok: false, reason: 'not-found', message: 'corpCode 가 필요합니다 (기업을 먼저 선택하세요).' };
    const years = request.fiscalYears ?? defaultFiscalYears(this.now());
    const preferred = request.preferredBasis ?? 'Consolidated';

    let res;
    try {
      res = await this.client.fetchFinancials({ corpCode: request.corpCode, years, basis: preferred === 'Separate' ? 'separate' : 'auto' });
    } catch (e) {
      const message = e instanceof DartClientError ? e.message : '재무제표를 가져오지 못했습니다.';
      return { ok: false, reason: e instanceof DartClientError && e.code === 'no-data' ? 'not-found' : 'unavailable', message };
    }

    const n = normalizeFinancials({
      company: { name: request.companyName ?? request.corpCode, corpCode: request.corpCode, ...(request.stockCode ? { stockCode: request.stockCode } : {}) },
      accounts: res.accounts, fiscalYears: years, preferredBasis: preferred, fetchedAt: res.fetchedAt, source: 'DART Annual Report',
    });
    const warnings = [...new Set([...n.quality.warnings, ...res.quality.warnings])];
    const quality = { ...n.quality, warnings };
    if (!n.ok) return { ok: false, reason: 'incomplete', message: n.reason, quality, fetch: res.quality };
    return { ok: true, data: n.data, quality, fetch: res.quality };
  }
}
