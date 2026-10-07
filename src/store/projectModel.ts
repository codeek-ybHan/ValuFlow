// PROJECT 상태의 순수 모델. React 에 의존하지 않으므로 단위 테스트할 수 있다.
//
// 상태는 출처가 다른 네 영역으로 분리하며 하나의 companyData 객체로 섞지 않는다.
//   historicalData        공시 / fixture 기반 과거 데이터
//   valuationAssumptions  사용자 / 학습용 입력 (ValuationInput)
//   valuationResult       runValuation() 결과  — 파생값
//   sensitivityResult     runSensitivity() 결과 — 파생값
//
// 계산은 valuation 공개 API 로만 수행한다 (forecast.ts / wacc.ts / dcf.ts 직접 import 금지).
// 저장 대상은 historicalData 와 valuationAssumptions 뿐이며, 결과는 로드할 때 다시 계산한다
// (입력과 결과가 어긋난 stale state 를 만들지 않기 위해).
import { runSensitivity, runValuation, ValuationError } from '../valuation/index.ts';
import type { SensitivityResult, ValuationInput, ValuationResult } from '../valuation/index.ts';
import type { HistoricalData } from '../data/types.ts';
import type { ForecastInputs } from '../engine/forecastForm.ts';
import { samsungHistoricalData } from '../data/samsungHistorical.ts';
import { step04PracticeAssumptions } from '../data/step04PracticeAssumptions.ts';

export interface ProjectState {
  historicalData: HistoricalData | null;
  valuationAssumptions: ValuationInput | null;
  valuationResult: ValuationResult | null;
  sensitivityResult: SensitivityResult | null;
  /** 직전 계산이 ValuationError 로 실패했을 때의 메시지. 화면에 표시하고 앱은 멈추지 않는다. */
  valuationError: string | null;
  sensitivityError: string | null;
}

/** 저장되는 부분. 결과와 오류는 파생값이라 저장하지 않는다. */
export interface PersistedProject {
  historicalData: HistoricalData | null;
  valuationAssumptions: ValuationInput | null;
}

export const emptyProjectState: ProjectState = {
  historicalData: null,
  valuationAssumptions: null,
  valuationResult: null,
  sensitivityResult: null,
  valuationError: null,
  sensitivityError: null,
};

/** Sensitivity 기본 축 (소수). Base WACC 8.1375% / g 2% 가 축에 포함된다. */
export const DEFAULT_WACC_VALUES = [0.075, 0.08, 0.081375, 0.085, 0.09];
export const DEFAULT_TERMINAL_GROWTH_VALUES = [0.01, 0.015, 0.02, 0.025, 0.03];

function toMessage(e: unknown): string {
  if (e instanceof ValuationError) return e.message;
  // 엔진 버그 등 예상 밖 오류도 화면이 멈추지 않게 하되, 원인은 콘솔에 남긴다.
  console.error(e);
  return '계산 중 예기치 않은 오류가 발생했습니다.';
}

/**
 * Forecast 입력 폼이 다루지 않는 가정(WACC · Terminal Growth · Net Debt · 주식 수)의 기본값.
 * WACC / DCF 입력 화면(07-4 이후)이 생기기 전까지 사용하며, STEP 04 학습용 가상값이다.
 * 이 값으로 Forecast 만 직접 입력해 계산하는 경우에도 UI 에 "학습용 기본값" 임을 밝혀야 한다.
 */
export const LEARNING_NON_FORECAST_DEFAULTS = {
  riskFreeRate: step04PracticeAssumptions.riskFreeRate,
  beta: step04PracticeAssumptions.beta,
  marketRiskPremium: step04PracticeAssumptions.marketRiskPremium,
  preTaxCostOfDebt: step04PracticeAssumptions.preTaxCostOfDebt,
  equityMarketValue: step04PracticeAssumptions.equityMarketValue,
  debtMarketValue: step04PracticeAssumptions.debtMarketValue,
  terminalGrowth: step04PracticeAssumptions.terminalGrowth,
  interestBearingDebt: step04PracticeAssumptions.interestBearingDebt,
  cash: step04PracticeAssumptions.cash,
  sharesOutstanding: step04PracticeAssumptions.sharesOutstanding,
} satisfies Omit<ValuationInput, keyof ForecastInputs>;

// ---- 상태 전이 (모두 새 상태를 반환하며 입력 상태를 변경하지 않는다) ----

/** Historical Data 만 설정한다. 가정과 결과는 건드리지 않는다. */
export function withHistoricalData(state: ProjectState, historicalData: HistoricalData | null): ProjectState {
  return { ...state, historicalData };
}

/** 삼성전자 FY2023~FY2025 공시 기반 데이터 불러오기. historicalData 만 바뀐다. */
export function withSamsungHistorical(state: ProjectState): ProjectState {
  return withHistoricalData(state, samsungHistoricalData);
}

/** 가정을 바꾸면 이전 결과는 더 이상 유효하지 않으므로 비운다 (stale 방지). */
export function withAssumptions(state: ProjectState, valuationAssumptions: ValuationInput | null): ProjectState {
  return { ...state, valuationAssumptions, valuationResult: null, sensitivityResult: null, valuationError: null, sensitivityError: null };
}

/**
 * Forecast 입력(매출·마진·세율·D&A·CAPEX·ΔNWC)을 가정에 반영한다. 나머지 가정은 기존 값을 유지하고,
 * 가정이 아직 없으면 학습용 기본값으로 채운다. 이전 결과는 stale 이므로 비운다.
 */
export function withForecastInputs(state: ProjectState, forecast: ForecastInputs): ProjectState {
  const base = state.valuationAssumptions ?? { ...LEARNING_NON_FORECAST_DEFAULTS, ...forecast };
  return withAssumptions(state, { ...base, ...forecast });
}

/** 입력이 유효하지 않은 상태로 바뀌었을 때: 가정은 그대로 두고 어긋난(stale) 결과와 오류만 비운다. */
export function withResultsCleared(state: ProjectState): ProjectState {
  if (!state.valuationResult && !state.sensitivityResult && !state.valuationError && !state.sensitivityError) return state;
  return { ...state, valuationResult: null, sensitivityResult: null, valuationError: null, sensitivityError: null };
}

/** WACC · Terminal Growth · Net Debt · 주식 수 입력이 아직 학습용 기본값 그대로인지 */
export function usesLearningNonForecastInputs(a: ValuationInput | null): boolean {
  if (!a) return false;
  return (Object.keys(LEARNING_NON_FORECAST_DEFAULTS) as (keyof typeof LEARNING_NON_FORECAST_DEFAULTS)[]).every((k) => a[k] === LEARNING_NON_FORECAST_DEFAULTS[k]);
}

/** valuationAssumptions 로 runValuation 을 실행해 결과(또는 오류 메시지)를 저장한다. 가정이 없으면 변화 없음. */
export function withValuationRun(state: ProjectState): ProjectState {
  const a = state.valuationAssumptions;
  if (!a) return state;
  try {
    return { ...state, valuationResult: runValuation(a), valuationError: null };
  } catch (e) {
    return { ...state, valuationResult: null, valuationError: toMessage(e) };
  }
}

/** 기본 축(WACC 5 × g 5)으로 runSensitivity 를 실행한다. 가정이 없으면 변화 없음. */
export function withSensitivityRun(state: ProjectState): ProjectState {
  const a = state.valuationAssumptions;
  if (!a) return state;
  try {
    return { ...state, sensitivityResult: runSensitivity(a, DEFAULT_WACC_VALUES, DEFAULT_TERMINAL_GROWTH_VALUES), sensitivityError: null };
  } catch (e) {
    return { ...state, sensitivityResult: null, sensitivityError: toMessage(e) };
  }
}

/** 가정 + 결과를 모두 비운다. historicalData 는 유지한다. */
export function withValuationReset(state: ProjectState): ProjectState {
  return withAssumptions(state, null);
}

/** STEP 04 학습용 가정을 적용하고 두 계산을 모두 실행한다. historicalData 는 건드리지 않는다. */
export function withPracticeAssumptions(state: ProjectState): ProjectState {
  return withSensitivityRun(withValuationRun(withAssumptions(state, step04PracticeAssumptions)));
}

// ---- 저장 / 복원 ----

export function toPersisted(state: ProjectState): PersistedProject {
  return { historicalData: state.historicalData, valuationAssumptions: state.valuationAssumptions };
}

/**
 * 저장된 입력을 복원하고, 가정이 있으면 결과를 다시 계산한다.
 * 저장소 값이 비정상이어도 앱이 멈추지 않는다 (계산 오류는 상태의 오류 메시지로 남는다).
 */
export function restoreProjectState(raw: unknown): ProjectState {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<PersistedProject>;
  const base: ProjectState = {
    ...emptyProjectState,
    historicalData: p.historicalData ?? null,
    valuationAssumptions: p.valuationAssumptions ?? null,
  };
  return withSensitivityRun(withValuationRun(base));
}

/**
 * 현재 가정이 STEP 04 학습용 가정과 값이 모두 같은지 (같을 때만 "학습용 가정" 배지를 표시).
 * 객체를 만든 순서(키 순서)와 무관하게 필드별 값으로 비교한다.
 */
export function isPracticeAssumptions(a: ValuationInput | null): boolean {
  if (a === null) return false;
  const keys = Object.keys(step04PracticeAssumptions) as (keyof ValuationInput)[];
  return Object.keys(a).length === keys.length && keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(step04PracticeAssumptions[k]));
}
