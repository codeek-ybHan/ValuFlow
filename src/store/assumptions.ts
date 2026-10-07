// 가정(valuationAssumptions) 입력의 "완성도" 개념.
// 사용자는 Forecast → WACC → DCF 순서로 가정을 채우므로, 입력 도중에는 ValuationInput 의 일부만 존재한다.
// 엔진은 모든 필수 가정이 준비된(complete) 입력에서만 실행한다. 비어 있는 값은 어떤 기본값으로도 채우지 않는다.
// (학습용 값은 [학습용 DCF 가정 적용] 을 명시적으로 눌렀을 때만 들어온다.)
import type { ValuationInput } from '../valuation/index.ts';

/** 입력 중인 가정. 일부 필드만 있을 수 있다. */
export type AssumptionsDraft = Partial<ValuationInput>;

export const FORECAST_FIELDS = ['currentRevenue', 'revenueGrowth', 'operatingMargin', 'taxRate', 'depreciation', 'capex', 'deltaNwc'] as const;
export const WACC_FIELDS = ['riskFreeRate', 'beta', 'marketRiskPremium', 'preTaxCostOfDebt', 'equityMarketValue', 'debtMarketValue'] as const;
/** DCF 입력 화면은 07-5 에서 추가된다. */
export const DCF_FIELDS = ['terminalGrowth', 'interestBearingDebt', 'cash', 'sharesOutstanding'] as const;

export type AssumptionSection = 'forecast' | 'wacc' | 'dcf';
export type SectionStatus = 'READY' | 'INCOMPLETE';

export interface AssumptionCompleteness {
  forecast: SectionStatus;
  wacc: SectionStatus;
  dcf: SectionStatus;
  /** 세 섹션이 모두 READY 이고 연도별 배열 길이가 같다 → 실제 Run Valuation 가능 */
  complete: boolean;
  /** 섹션별로 아직 없는 필드 이름 */
  missing: Record<AssumptionSection, string[]>;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const present = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 && v.every(finite) : finite(v));

export function assumptionCompleteness(d: AssumptionsDraft | null): AssumptionCompleteness {
  const src = (d ?? {}) as Record<string, unknown>;
  const missingOf = (fields: readonly string[]) => fields.filter((k) => !present(src[k]));
  const missing = { forecast: missingOf(FORECAST_FIELDS), wacc: missingOf(WACC_FIELDS), dcf: missingOf(DCF_FIELDS) };

  // 연도별 배열 길이가 서로 다르면 Forecast 는 준비된 것이 아니다.
  const lengths = ['revenueGrowth', 'operatingMargin', 'depreciation', 'capex', 'deltaNwc'].map((k) => (Array.isArray(src[k]) ? (src[k] as unknown[]).length : -1));
  const lengthsAgree = lengths.every((n) => n === lengths[0]);
  const forecastReady = missing.forecast.length === 0 && lengthsAgree;

  const status = (ready: boolean): SectionStatus => (ready ? 'READY' : 'INCOMPLETE');
  const forecast = status(forecastReady);
  const wacc = status(missing.wacc.length === 0);
  const dcf = status(missing.dcf.length === 0);
  return { forecast, wacc, dcf, complete: forecast === 'READY' && wacc === 'READY' && dcf === 'READY', missing };
}

/** 엔진에 넘길 수 있는 완성된 입력인지 */
export function isCompleteAssumptions(d: AssumptionsDraft | null): d is ValuationInput {
  return assumptionCompleteness(d).complete;
}
