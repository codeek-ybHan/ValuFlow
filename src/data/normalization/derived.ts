// Historical 에서 파생되는 값. 원본은 바꾸지 않는다.
import type { HistoricalData } from '../types.ts';

/** 'ppe' : 유형자산 취득액 (현재 학습 기준) · 'ppe+intangible' : 유형 + 무형자산 취득액 */
export type CapexBasis = 'ppe' | 'ppe+intangible';

/**
 * Valuation 에서 쓸 CAPEX (KRW million). CAPEX 의 정의는 하나로 못 박지 않고 호출하는 쪽이 기준을 고른다.
 * 기본값은 학습 기준(PPE)이며 ppeAcquisition / intangibleAcquisition 원본은 그대로 보존된다.
 */
export function capexForValuation(h: HistoricalData, basis: CapexBasis = 'ppe'): number[] {
  const ppe = h.cashFlow.ppeAcquisition;
  if (basis === 'ppe') return [...ppe];
  return ppe.map((v, i) => v + h.cashFlow.intangibleAcquisition[i]);
}
