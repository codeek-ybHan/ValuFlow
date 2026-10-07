// DCF / Equity 결과의 표시용 모델. ValuationResult 를 읽기만 하며 엔진 결과를 바꾸거나 다시 계산하지 않는다.
// 새로 계산하는 값은 검토용 참고지표뿐이다 (Σ PV of FCFF, Terminal Value 비중).
import type { ValuationResult } from '../valuation/index.ts';

export interface DcfRow {
  label: string;
  fcff: number;
  discountFactor: number;
  pvFcff: number;
}

export interface DcfView {
  rows: DcfRow[];
  sumPvFcff: number;
  terminalFcff: number;
  terminalValue: number;
  pvTerminalValue: number;
  enterpriseValue: number;
  /** PV(TV) / EV. EV 가 0 이하이면 null */
  tvContribution: number | null;
  /** TV 비중이 높을 때의 검토 안내 (참고용) */
  tvNote: string | null;
}

export interface EquityBridge {
  enterpriseValue: number;
  netDebt: number;
  equityValue: number;
  sharesOutstanding: number;
  perShareValue: number;
  /** Net Debt < 0 (현금이 부채보다 많음): Equity Value 가 EV 보다 커진다 */
  netCash: boolean;
}

export const TV_HIGH_THRESHOLD = 0.8;

/** PV(TV) / EV — 기업가치 중 Terminal Value 가 차지하는 비중 (실무 검토용 참고지표) */
export function terminalValueContribution(r: Pick<ValuationResult, 'pvTerminalValue' | 'enterpriseValue'>): number | null {
  return r.enterpriseValue > 0 ? r.pvTerminalValue / r.enterpriseValue : null;
}

export function buildDcfView(r: ValuationResult, yearLabels: string[]): DcfView {
  const tv = terminalValueContribution(r);
  return {
    rows: r.fcff.map((fcff, i) => ({ label: yearLabels[i] ?? `Y${i + 1}E`, fcff, discountFactor: r.discountFactors[i], pvFcff: r.pvFcff[i] })),
    sumPvFcff: r.pvFcff.reduce((s, v) => s + v, 0),
    terminalFcff: r.terminalFcff,
    terminalValue: r.terminalValue,
    pvTerminalValue: r.pvTerminalValue,
    enterpriseValue: r.enterpriseValue,
    tvContribution: tv,
    tvNote: tv !== null && tv > TV_HIGH_THRESHOLD ? `Terminal Value 비중이 ${Math.round(TV_HIGH_THRESHOLD * 100)}% 를 넘어 영구성장률·WACC 가정에 민감합니다.` : null,
  };
}

export function buildEquityBridge(r: ValuationResult, sharesOutstanding: number): EquityBridge {
  return {
    enterpriseValue: r.enterpriseValue,
    netDebt: r.netDebt,
    equityValue: r.equityValue,
    sharesOutstanding,
    perShareValue: r.perShareValue,
    netCash: r.netDebt < 0,
  };
}

export interface BridgeAdjustment {
  /** '−' (Net Debt 차감) 또는 '+' (Net Cash 가산) */
  operator: '−' | '+';
  label: 'Net Debt' | 'Net Cash';
  /** 항상 0 이상. 부호는 operator 로 표현한다 */
  amount: number;
}

/**
 * Equity Bridge 의 표기만 정한다 (계산식과 엔진 값은 그대로).
 *  Net Debt ≥ 0 : EV − Net Debt = Equity Value
 *  Net Debt < 0 : EV + Net Cash = Equity Value  ("− Net Debt −200" 같은 이중 부정을 피한다)
 */
export function bridgeAdjustment(netDebt: number): BridgeAdjustment {
  return netDebt < 0 ? { operator: '+', label: 'Net Cash', amount: -netDebt } : { operator: '−', label: 'Net Debt', amount: netDebt };
}
