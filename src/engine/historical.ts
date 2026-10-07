// Historical Data 에서 파생지표를 계산한다. 계산은 historicalAnalysis.ts(source of truth)가 하고,
// 이 파일은 기존 호출부(Workspace 분석 탭 등)가 쓰는 형태로 결과를 넘겨주는 얇은 어댑터다. 계산식은 여기에 두지 않는다.
import type { HistoricalData } from '../data/types';
import { analyzeHistorical } from './historicalAnalysis.ts';

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
  const { metrics } = analyzeHistorical(h);
  return {
    period: h.company.period,
    revenueGrowth: metrics.revenueGrowth.values,
    operatingMargin: metrics.operatingMargin.values,
    nwc: metrics.nwc.values as number[],
    deltaNwc: metrics.deltaNwc.values,
    capex: metrics.capex.values as number[],
    cfoMinusCapex: metrics.cfoMinusCapex.values as number[],
  };
}
