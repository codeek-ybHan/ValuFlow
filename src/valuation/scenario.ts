// Scenario: Bear / Base / Bull 은 "가정 묶음"이다. Sensitivity(WACC × g 두 값만 바꿔 같은 FCFF 를 다시 할인)와 달리
// 영업 가정(성장률·마진·CAPEX)과 할인 가정(위험 프리미엄 → WACC, 영구성장률)을 함께 바꿔 전체 Valuation 을 다시 계산한다.
//
// 계산은 runValuation() 을 그대로 재사용한다 (별도의 DCF 계산식 없음). 이 파일은 base 입력을 복제해
// 시나리오 override 를 적용하는 일만 하며, base 입력은 변경하지 않는다.
import { runValuation } from './engine.ts';
import type { ValuationInput, ValuationResult } from './models.ts';
import { ValuationError } from './models.ts';

/** 덮어쓸 필드만 담는다. 없는 필드는 base 값을 그대로 쓴다. */
export type ScenarioOverrides = Partial<ValuationInput>;

/** base 입력을 복제하고 override 를 적용한 새 입력. base 와 override 는 변경하지 않는다. */
export function applyOverrides(base: ValuationInput, overrides: ScenarioOverrides): ValuationInput {
  const next = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) next[key] = Array.isArray(value) ? [...value] : value;
  }
  return next as unknown as ValuationInput;
}

/** 시나리오 하나를 실행한다: runValuation(base + overrides). 잘못된 입력은 runValuation 과 같은 ValuationError. */
export function runScenario(base: ValuationInput, overrides: ScenarioOverrides = {}): ValuationResult {
  return runValuation(applyOverrides(base, overrides));
}

// ---- 기본 Bear / Base / Bull 가정 묶음 ----

export type ScenarioId = 'bear' | 'base' | 'bull';

/** base 대비 조정량. 비율 조정은 %p(소수), CAPEX 는 배수. */
export interface ScenarioAdjustments {
  /** 연도별 매출성장률에 더하는 값 (-0.02 = -2%p) */
  revenueGrowthDelta: number;
  /** 연도별 영업이익률에 더하는 값 */
  operatingMarginDelta: number;
  /** CAPEX 에 곱하는 값 (1.1 = 10% 상향, 1 = 유지) */
  capexMultiplier: number;
  /** 시장 위험 프리미엄에 더하는 값 — WACC 는 이 입력을 바꿔 엔진이 계산한다 (+ → WACC ↑) */
  marketRiskPremiumDelta: number;
  /** 영구성장률에 더하는 값 */
  terminalGrowthDelta: number;
}

export const DEFAULT_SCENARIO_ADJUSTMENTS: Record<'bear' | 'bull', ScenarioAdjustments> = {
  // Bear: 성장·마진 하향, CAPEX 상향, 위험 프리미엄 상향(WACC ↑), 영구성장률 하향
  bear: { revenueGrowthDelta: -0.02, operatingMarginDelta: -0.02, capexMultiplier: 1.1, marketRiskPremiumDelta: 0.01, terminalGrowthDelta: -0.005 },
  // Bull: 성장·마진 상향, CAPEX 유지, 위험 프리미엄 하향(WACC ↓), 영구성장률 상향
  bull: { revenueGrowthDelta: 0.02, operatingMarginDelta: 0.02, capexMultiplier: 1, marketRiskPremiumDelta: -0.005, terminalGrowthDelta: 0.005 },
};

/** 부동소수 잡음(0.08 − 0.02 = 0.06000000000000001 등)을 12자리에서 정리한다. */
const tidy = (x: number) => Number(x.toFixed(12));

/** base 와 조정량으로 절대 override 값을 만든다. */
export function buildScenarioOverrides(base: ValuationInput, adj: ScenarioAdjustments): ScenarioOverrides {
  return {
    revenueGrowth: base.revenueGrowth.map((g) => tidy(g + adj.revenueGrowthDelta)),
    operatingMargin: base.operatingMargin.map((m) => tidy(m + adj.operatingMarginDelta)),
    capex: base.capex.map((c) => tidy(c * adj.capexMultiplier)),
    marketRiskPremium: tidy(base.marketRiskPremium + adj.marketRiskPremiumDelta),
    terminalGrowth: tidy(base.terminalGrowth + adj.terminalGrowthDelta),
  };
}

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  /** 이 시나리오가 어떤 가정 묶음인지 */
  description: string;
  overrides: ScenarioOverrides;
}

/** [Bear, Base, Bull]. Base 는 override 없이 현재 가정 그대로다. */
export function buildDefaultScenarios(base: ValuationInput): ScenarioDefinition[] {
  return [
    { id: 'bear', label: 'Bear', description: '성장률·영업이익률 하향, CAPEX 상향, 위험 프리미엄 상향(WACC ↑), 영구성장률 하향', overrides: buildScenarioOverrides(base, DEFAULT_SCENARIO_ADJUSTMENTS.bear) },
    { id: 'base', label: 'Base', description: '현재 입력한 가정 그대로', overrides: {} },
    { id: 'bull', label: 'Bull', description: '성장률·영업이익률 상향, CAPEX 유지, 위험 프리미엄 하향(WACC ↓), 영구성장률 상향', overrides: buildScenarioOverrides(base, DEFAULT_SCENARIO_ADJUSTMENTS.bull) },
  ];
}

export type ScenarioOutcome =
  | (ScenarioDefinition & { ok: true; result: ValuationResult })
  | (ScenarioDefinition & { ok: false; error: string });

/**
 * 시나리오를 모두 실행한다. 한 시나리오가 계산 불가(예: Bull 의 g 가 WACC 이상)여도
 * 다른 시나리오 결과는 유지되도록 시나리오별로 오류를 담는다.
 */
export function runScenarios(base: ValuationInput, definitions: ScenarioDefinition[] = buildDefaultScenarios(base)): ScenarioOutcome[] {
  return definitions.map((def): ScenarioOutcome => {
    try {
      return { ...def, ok: true, result: runScenario(base, def.overrides) };
    } catch (e) {
      if (e instanceof ValuationError) return { ...def, ok: false, error: e.message };
      throw e;
    }
  });
}
