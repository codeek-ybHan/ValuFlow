import type { FinancialRecord } from '../types';
import type { HistoricalData } from './types';

/**
 * 공시 기반 HistoricalData → LEARN 의 FinancialRecord(연도별 레코드).
 * Historical Data 에 없는 항목(CFI, CFF, 유동자산 등)은 채우지 않고 비워 둔다.
 * 단위는 LEARN 입력 규칙에 맞춰 '백만원', CAPEX 는 유형자산 취득액(Learning Basis)이다.
 */
export function historicalToRecords(h: HistoricalData): FinancialRecord[] {
  const { incomeStatement: is, balanceSheet: bs, cashFlow: cf, company } = h;
  const basis = company.basis === 'Consolidated' ? '연결' : '별도';
  return company.period.map((p, i) => {
    const year = Number(p.replace(/\D/g, ''));
    return {
      id: `${company.name}-${year}-${basis}`,
      company: company.name,
      year,
      unit: '백만원',
      basis,
      assets: bs.totalAssets[i],
      liabilities: bs.totalLiabilities[i],
      equity: bs.totalEquity[i],
      revenue: is.revenue[i],
      grossProfit: is.grossProfit[i],
      operatingIncome: is.operatingProfit[i],
      netIncome: is.netIncome[i],
      receivables: bs.accountsReceivable[i],
      inventory: bs.inventory[i],
      payables: bs.accountsPayable[i],
      cfo: cf.cfo[i],
      capex: cf.ppeAcquisition[i],
    };
  });
}
