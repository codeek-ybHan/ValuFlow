// 기존 samsungHistoricalData fixture 를 새 HistoricalData domain model 에 맞추는 adapter.
// fixture 를 OpenDART 응답처럼 위장하지 않는다: source 는 'Fixture', corpCode 는 비워 둔다.
import { samsungHistoricalData } from '../samsungHistorical.ts';
import type { HistoricalData } from '../types.ts';
import { OPTIONAL_FIELDS, REQUIRED_FIELDS, type CanonicalField } from '../normalization/accounts.ts';
import type { DataQuality, FieldQuality } from '../normalization/quality.ts';

const SECTION_OF: Record<CanonicalField, 'incomeStatement' | 'balanceSheet' | 'cashFlow'> = {
  revenue: 'incomeStatement', cogs: 'incomeStatement', grossProfit: 'incomeStatement', sga: 'incomeStatement', operatingProfit: 'incomeStatement', netIncome: 'incomeStatement',
  accountsReceivable: 'balanceSheet', inventory: 'balanceSheet', accountsPayable: 'balanceSheet', totalAssets: 'balanceSheet', totalLiabilities: 'balanceSheet', totalEquity: 'balanceSheet',
  cash: 'balanceSheet', interestBearingDebt: 'balanceSheet', leaseLiabilities: 'balanceSheet',
  cfo: 'cashFlow', ppeAcquisition: 'cashFlow', intangibleAcquisition: 'cashFlow', depreciationAmortization: 'cashFlow',
};

const LABEL: Partial<Record<CanonicalField, string>> = { cash: 'Cash', interestBearingDebt: 'Interest-bearing Debt', depreciationAmortization: 'D&A' };

/** 도메인 데이터의 품질 보고. 필드가 있으면 available, 없으면 missing (연도 길이가 맞지 않으면 partial). */
export function assessHistoricalQuality(data: HistoricalData): DataQuality {
  const n = data.company.period.length;
  const fields: DataQuality['fields'] = {};
  const warnings: string[] = [];
  for (const f of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    const arr = (data[SECTION_OF[f]] as unknown as Record<string, number[] | undefined>)[f];
    const q: FieldQuality = !arr
      ? { status: 'missing', missingYears: [], sources: [] }
      : arr.length === n ? { status: 'available', missingYears: [], sources: [] } : { status: 'partial', missingYears: [], sources: [] };
    fields[f] = q;
    if (f === 'leaseLiabilities') continue;
    if (q.status !== 'available') warnings.push(`${LABEL[f] ?? f} ${q.status === 'missing' ? 'account not found' : 'series length mismatch'}`);
  }
  const basis = data.company.basis;
  return { basisRequested: basis, basisUsed: basis, basisFallback: false, fields, warnings, trace: [], checks: [] };
}

/** fixture → HistoricalData (깊은 복사 + meta). fixture 객체는 바꾸지 않는다. */
export function fromSamsungFixture(fetchedAt: string, fixture: HistoricalData = samsungHistoricalData): HistoricalData {
  const copy = structuredClone(fixture);
  return { ...copy, meta: { stockCode: fixture.company.ticker, source: 'Fixture', fetchedAt } };
}
