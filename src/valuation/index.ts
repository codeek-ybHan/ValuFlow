// Valuation Engine v1 공개 API.
// UI / 상태 / 다른 모듈은 이 파일을 통해서만 가져다 쓴다 (forecast.ts, wacc.ts, dcf.ts 등 내부 파일 직접 import 금지).
export { runValuation } from './engine.ts';
export { runSensitivity } from './sensitivity.ts';
// WACC 구성요소 계산 — WACC 입력 화면의 Live Preview 가 같은 계산식을 재사용하도록 공개한다 (Valuation 결과를 만들지 않는다).
export { calculateWacc, calculateCostOfEquity, calculateAfterTaxCostOfDebt, calculateCapitalWeights } from './wacc.ts';
export type { WaccInput, WaccResult } from './wacc.ts';
// Scenario(Bear / Base / Bull 가정 묶음): runValuation 을 재사용한다.
export { runScenario, runScenarios, applyOverrides, buildDefaultScenarios, buildScenarioOverrides, DEFAULT_SCENARIO_ADJUSTMENTS } from './scenario.ts';
export type { ScenarioOverrides, ScenarioAdjustments, ScenarioDefinition, ScenarioOutcome, ScenarioId } from './scenario.ts';
// Relative Valuation(PER / PBR / EV·EBITDA): 멀티플은 사용자가 직접 입력한다.
export { calculateRelativeValuation } from './multiples.ts';
export type { RelativeInput, RelativeBridge, RelativeOutcome, RelativeMethod } from './multiples.ts';
export { ValuationError } from './models.ts';
export type { ValuationInput, ValuationResult } from './models.ts';
export type { SensitivityResult, SensitivityCell } from './sensitivity.ts';
