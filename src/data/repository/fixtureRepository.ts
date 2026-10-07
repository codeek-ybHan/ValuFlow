// mock 구현: 삼성전자 fixture 만 돌려준다. 실제 OpenDART / DB 구현체로 교체할 수 있다.
import type { CompanyProfile, CompanyRef, FinancialRepository, HistoricalFinancialsRequest, HistoricalFinancialsResult } from './financialRepository.ts';
import { assessHistoricalQuality, fromSamsungFixture } from './fixtureAdapter.ts';
import { samsungHistoricalData } from '../samsungHistorical.ts';

const SAMSUNG: CompanyProfile = { name: samsungHistoricalData.company.name, stockCode: samsungHistoricalData.company.ticker, source: 'Fixture' };

export class FixtureFinancialRepository implements FinancialRepository {
  private readonly now: () => string;
  constructor(now: () => string = () => new Date().toISOString()) { this.now = now; }

  async searchCompanies(query: string): Promise<CompanyProfile[]> {
    const q = query.trim();
    return q !== '' && (SAMSUNG.name.includes(q) || SAMSUNG.stockCode === q) ? [{ ...SAMSUNG }] : [];
  }

  async getCompany(ref: CompanyRef): Promise<CompanyProfile | null> {
    return ref.stockCode === SAMSUNG.stockCode ? { ...SAMSUNG } : null;
  }

  async getHistoricalFinancials(request: HistoricalFinancialsRequest): Promise<HistoricalFinancialsResult> {
    if (request.stockCode !== SAMSUNG.stockCode) return { ok: false, reason: 'not-found', message: `${request.stockCode ?? request.corpCode ?? '(없음)'}: fixture 에 없는 기업입니다.` };
    const data = fromSamsungFixture(this.now());
    const have = data.company.period.map((p) => Number.parseInt(p, 10));
    if (request.fiscalYears && !request.fiscalYears.every((y) => have.includes(y))) {
      return { ok: false, reason: 'unavailable', message: `fixture 는 ${data.company.period.join(', ')} 만 제공합니다.` };
    }
    return { ok: true, data, quality: assessHistoricalQuality(data) };
  }
}
