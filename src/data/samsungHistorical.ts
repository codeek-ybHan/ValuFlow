import type { HistoricalData } from './types';

/**
 * 삼성전자 2025 사업보고서 연결재무제표 기준 FY2023~FY2025 (단위: KRW million).
 * 공시 기반 Historical Data 이며, 학습용 Valuation Assumption(step04PracticeAssumptions)과 섞지 않는다.
 */
export const samsungHistoricalData: HistoricalData = {
  // 학습용 fixture: 실제 OpenDART 조회 결과가 아니다. corpCode 는 일부러 비워 둔다.
  meta: { stockCode: '005930', source: 'Fixture' },
  company: {
    name: '삼성전자',
    ticker: '005930',
    basis: 'Consolidated',
    currency: 'KRW',
    unit: 'million',
    period: ['2023A', '2024A', '2025A'],
  },
  incomeStatement: {
    revenue: [258935494, 300870903, 333605938],
    cogs: [180388580, 186562268, 202235513],
    grossProfit: [78546914, 114308635, 131370425],
    sga: [71979938, 81582674, 87769374],
    operatingProfit: [6566976, 32725961, 43601051],
    netIncome: [15487100, 34451351, 45206805],
  },
  balanceSheet: {
    accountsReceivable: [36647393, 43623073, 51127642],
    inventory: [51625874, 51754865, 52636828],
    accountsPayable: [11319824, 12370177, 13039380],
    totalAssets: [455905980, 514531948, 566942110],
    totalLiabilities: [92228115, 112339878, 130621773],
    totalEquity: [363677865, 402192070, 436320337],
  },
  cashFlow: {
    cfo: [44137427, 72982621, 85315148],
    ppeAcquisition: [57611292, 51406355, 47522179],
    intangibleAcquisition: [2922875, 2335284, 4630970],
  },
};
