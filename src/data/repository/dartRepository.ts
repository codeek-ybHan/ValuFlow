// OpenDART 기반 저장소. STEP 06-2: 기업 검색 / 개황만 구현한다.
// 재무데이터는 fixture 로 몰래 대체하지 않고 "아직 구현되지 않음" 을 명확히 돌려준다.
import type { DartClient } from '../dart/client.ts';
import type { DartCompanyDetail, DartCompanySummary } from '../dart/types.ts';
import type { CompanyProfile, CompanyRef, FinancialRepository, HistoricalFinancialsRequest, HistoricalFinancialsResult } from './financialRepository.ts';

const fromSummary = (c: DartCompanySummary): CompanyProfile => ({ name: c.corpName, corpCode: c.corpCode, ...(c.stockCode ? { stockCode: c.stockCode } : {}), source: 'OpenDART' });

const fromDetail = (c: DartCompanyDetail): CompanyProfile => ({
  name: c.corpName, corpCode: c.corpCode, ...(c.stockCode ? { stockCode: c.stockCode } : {}),
  ...(c.corpNameEng ? { nameEng: c.corpNameEng } : {}), ...(c.corpClass ? { corpClass: c.corpClass } : {}),
  source: 'OpenDART', fetchedAt: c.fetchedAt,
});

export class DartFinancialRepository implements FinancialRepository {
  private readonly client: DartClient;
  constructor(client: DartClient) { this.client = client; }

  async searchCompanies(query: string): Promise<CompanyProfile[]> {
    return (await this.client.searchCompanies({ query })).map(fromSummary);
  }

  /** corpCode 로 기업개황을 조회한다. corpCode 가 없으면 조회할 수 없다. */
  async getCompany(ref: CompanyRef): Promise<CompanyProfile | null> {
    if (!ref.corpCode) return null;
    return fromDetail(await this.client.getCompany(ref.corpCode));
  }

  async getHistoricalFinancials(_request: HistoricalFinancialsRequest): Promise<HistoricalFinancialsResult> {
    return { ok: false, reason: 'not-implemented', message: '재무제표 수집은 STEP 06-3 에서 구현됩니다. fixture 데이터로 대체하지 않습니다.' };
  }
}
