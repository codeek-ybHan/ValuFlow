// Historical Data 에서 파생지표를 계산한다. UI 에는 계산식을 두지 않고 이 함수의 결과만 렌더링한다.
// 개별 지표 함수는 analysis.ts 를 재사용하며, 계산 불가(첫 해 성장률 등)는 null 이다.
import type { HistoricalData } from '../data/types';
import { growth, operatingMargin } from './analysis.ts';

export interface HistoricalMetrics {
  period: string[];
  /** YoY. 첫 해는 비교 대상이 없어 null */
  revenueGrowth: (number | null)[];
  operatingMargin: (number | null)[];
  /** NWC = AR + Inventory - AP (학습용 단순식) */
  nwc: number[];
  deltaNwc: (number | null)[];
  /** CAPEX (Learning Basis) = 유형자산 취득액 */
  capex: number[];
  /** 참고지표. FCFF 가 아니다. */
  cfoMinusCapex: number[];
}

export function deriveHistoricalMetrics(h: HistoricalData): HistoricalMetrics {
  const { revenue, operatingProfit } = h.incomeStatement;
  const { accountsReceivable: ar, inventory: inv, accountsPayable: ap } = h.balanceSheet;
  const nwc = ar.map((v, i) => v + inv[i] - ap[i]);
  const capex = [...h.cashFlow.ppeAcquisition];
  return {
    period: h.company.period,
    revenueGrowth: revenue.map((v, i) => (i === 0 ? null : growth(v, revenue[i - 1]))),
    operatingMargin: revenue.map((v, i) => operatingMargin(operatingProfit[i], v)),
    nwc,
    deltaNwc: nwc.map((v, i) => (i === 0 ? null : v - nwc[i - 1])),
    capex,
    cfoMinusCapex: h.cashFlow.cfo.map((v, i) => v - capex[i]),
  };
}
