// Validation 화면의 표시용 모델. 입력은 Valuation 결과 · Sensitivity · Scenario · 상대가치이며 엔진 결과를 바꾸지 않는다.
// 새로 계산하는 것은 검토용 지표(범위, 비율, 경고)뿐이고, Scenario / 상대가치 계산은 valuation 공개 API 를 호출한다.
//
// Valuation Range 는 방법별 결과의 "범위"를 보여 줄 뿐이다. 평균이나 중앙값으로 하나의 "정답 가치"를 만들지 않는다.
import {
  applyOverrides, calculateRelativeValuation, runScenarios,
} from '../valuation/index.ts';
import type {
  RelativeBridge, RelativeInput, RelativeOutcome, ScenarioOutcome, SensitivityResult, ValuationInput, ValuationResult,
} from '../valuation/index.ts';
import { TV_HIGH_THRESHOLD, terminalValueContribution } from './dcfView.ts';

// ---- 경고 기준 (검토용) ----
export const TV_WARNING_THRESHOLD = TV_HIGH_THRESHOLD; // PV(TV)/EV 80% 초과
export const SPREAD_NARROW_THRESHOLD = 0.03; // WACC − g 3%p 미만
export const SENSITIVITY_WIDE_THRESHOLD = 0.5; // (max EV − min EV) / Base EV 50% 초과
export const SCENARIO_WIDE_THRESHOLD = 0.6; // (Bull − Bear) / Base Equity 60% 초과
export const RELATIVE_DIVERGENCE_THRESHOLD = 0.5; // 상대가치 Equity 가 DCF 와 50% 넘게 다름

export const RANGE_DISCLAIMER = '각 방법의 가정과 기준이 다르므로, 범위와 차이를 검토해야 합니다.';
export const DIRECTION_NOTES = ['WACC ↑ → Value ↓', 'Terminal Growth ↑ → Value ↑'] as const;

const widthRatio = (min: number, max: number, base: number): number | null => (base > 0 ? (max - min) / base : null);

// ---------------------------------------------------------------------------
// A. Sensitivity
// ---------------------------------------------------------------------------

export interface SensitivityCellView {
  wacc: number;
  enterpriseValue: number;
  equityValue: number;
  perShareValue: number;
  isBaseCase: boolean;
}

export interface SensitivityView {
  waccValues: number[];
  terminalGrowthValues: number[];
  /** Base 값: 입력(가정)에서 나온 값. 분석 범위와 별개의 개념이다. */
  base: { wacc: number; terminalGrowth: number; inGrid: boolean };
  /** 분석 범위: 매트릭스의 축이 걸치는 구간 */
  range: { waccMin: number; waccMax: number; terminalGrowthMin: number; terminalGrowthMax: number };
  /** 행 = Terminal Growth, 열 = WACC */
  rows: { terminalGrowth: number; cells: SensitivityCellView[] }[];
  enterpriseValueRange: { min: number; max: number; widthRatio: number | null };
  equityValueRange: { min: number; max: number };
}

export function buildSensitivityView(s: SensitivityResult, baseEnterpriseValue: number): SensitivityView {
  const flat = s.cells.flat();
  const ev = flat.map((c) => c.enterpriseValue);
  const eq = flat.map((c) => c.equityValue);
  const [evMin, evMax] = [Math.min(...ev), Math.max(...ev)];
  return {
    waccValues: [...s.waccValues],
    terminalGrowthValues: [...s.terminalGrowthValues],
    base: { wacc: s.baseWacc, terminalGrowth: s.baseTerminalGrowth, inGrid: flat.some((c) => c.isBaseCase) },
    range: { waccMin: Math.min(...s.waccValues), waccMax: Math.max(...s.waccValues), terminalGrowthMin: Math.min(...s.terminalGrowthValues), terminalGrowthMax: Math.max(...s.terminalGrowthValues) },
    rows: s.terminalGrowthValues.map((g, j) => ({
      terminalGrowth: g,
      cells: s.waccValues.map((_, i) => {
        const c = s.cells[i][j];
        return { wacc: c.wacc, enterpriseValue: c.enterpriseValue, equityValue: c.equityValue, perShareValue: c.perShareValue, isBaseCase: c.isBaseCase };
      }),
    })),
    enterpriseValueRange: { min: evMin, max: evMax, widthRatio: widthRatio(evMin, evMax, baseEnterpriseValue) },
    equityValueRange: { min: Math.min(...eq), max: Math.max(...eq) },
  };
}

// ---------------------------------------------------------------------------
// B. Scenario
// ---------------------------------------------------------------------------

export interface ScenarioColumn {
  id: string;
  label: string;
  description: string;
  ok: boolean;
  error: string | null;
  /** 이 시나리오에서 실제로 쓰인 가정 */
  assumptions: { revenueGrowth: number[]; operatingMargin: number[]; capex: number[]; marketRiskPremium: number; terminalGrowth: number };
  /** 결과 (계산 불가이면 null) */
  wacc: number | null;
  enterpriseValue: number | null;
  equityValue: number | null;
  perShareValue: number | null;
}

export interface ScenarioView {
  columns: ScenarioColumn[];
  /** Bear ~ Bull 의 Equity Value 범위 (계산된 시나리오만) */
  equityRange: { min: number; max: number; widthRatio: number | null } | null;
}

export function buildScenarioView(base: ValuationInput, outcomes: ScenarioOutcome[]): ScenarioView {
  const columns = outcomes.map((o): ScenarioColumn => {
    const a = applyOverrides(base, o.overrides);
    return {
      id: o.id,
      label: o.label,
      description: o.description,
      ok: o.ok,
      error: o.ok ? null : o.error,
      assumptions: { revenueGrowth: a.revenueGrowth, operatingMargin: a.operatingMargin, capex: a.capex, marketRiskPremium: a.marketRiskPremium, terminalGrowth: a.terminalGrowth },
      wacc: o.ok ? o.result.wacc : null,
      enterpriseValue: o.ok ? o.result.enterpriseValue : null,
      equityValue: o.ok ? o.result.equityValue : null,
      perShareValue: o.ok ? o.result.perShareValue : null,
    };
  });
  const eq = columns.map((c) => c.equityValue).filter((v): v is number => v !== null);
  const baseEq = columns.find((c) => c.id === 'base')?.equityValue ?? null;
  return {
    columns,
    equityRange: eq.length >= 2 ? { min: Math.min(...eq), max: Math.max(...eq), widthRatio: baseEq !== null ? widthRatio(Math.min(...eq), Math.max(...eq), baseEq) : null } : null,
  };
}

// ---------------------------------------------------------------------------
// C. Relative Valuation
// ---------------------------------------------------------------------------

export interface MethodRow {
  method: 'DCF' | 'PER' | 'PBR' | 'EV/EBITDA';
  status: 'ok' | 'incomplete' | 'invalid';
  enterpriseValue: number | null;
  equityValue: number | null;
  perShareValue: number | null;
  /** PER / PBR 의 EV 는 Net Debt 를 더해 환산한 참고값 */
  evDerived: boolean;
  /** 입력 부족 / 오류 / 보충 안내 */
  message: string | null;
}

export interface RelativeView {
  rows: MethodRow[];
  /** 계산된 상대가치 방법들의 Equity Value 범위 */
  equityRange: { min: number; max: number } | null;
  /** 상대가치 Equity 가 DCF Equity 와 가장 크게 다른 정도 (|상대가치 / DCF − 1| 의 최댓값) */
  maxDivergence: number | null;
}

export function buildRelativeView(dcf: ValuationResult, outcomes: RelativeOutcome[]): RelativeView {
  const rows: MethodRow[] = [
    { method: 'DCF', status: 'ok', enterpriseValue: dcf.enterpriseValue, equityValue: dcf.equityValue, perShareValue: dcf.perShareValue, evDerived: false, message: null },
    ...outcomes.map((o): MethodRow => {
      if (o.status === 'ok') return { method: o.method, status: 'ok', enterpriseValue: o.enterpriseValue, equityValue: o.equityValue, perShareValue: o.perShareValue, evDerived: o.evDerived, message: o.notes.join(' ') || null };
      if (o.status === 'incomplete') return { method: o.method, status: 'incomplete', enterpriseValue: null, equityValue: null, perShareValue: null, evDerived: false, message: '입력이 필요합니다' };
      return { method: o.method, status: 'invalid', enterpriseValue: null, equityValue: null, perShareValue: null, evDerived: false, message: o.error };
    }),
  ];
  const eq = rows.filter((r) => r.method !== 'DCF' && r.equityValue !== null).map((r) => r.equityValue as number);
  return {
    rows,
    equityRange: eq.length > 0 ? { min: Math.min(...eq), max: Math.max(...eq) } : null,
    maxDivergence: eq.length > 0 && dcf.equityValue > 0 ? Math.max(...eq.map((v) => Math.abs(v / dcf.equityValue - 1))) : null,
  };
}

// ---------------------------------------------------------------------------
// Valuation Range (평균을 내지 않는다)
// ---------------------------------------------------------------------------

export type RangeSource = 'Base DCF' | 'Sensitivity' | 'Scenario' | 'Relative';

export interface RangePoint {
  source: RangeSource;
  label: string;
  equityValue: number;
  perShareValue: number | null;
}

export interface SourceSpan {
  source: RangeSource;
  low: RangePoint;
  high: RangePoint;
}

export interface ValuationRange {
  low: RangePoint;
  base: RangePoint;
  high: RangePoint;
  spans: SourceSpan[];
  disclaimer: string;
}

const pick = (points: RangePoint[], dir: 'min' | 'max') =>
  points.reduce((best, p) => ((dir === 'min' ? p.equityValue < best.equityValue : p.equityValue > best.equityValue) ? p : best));

export function buildValuationRange(
  dcf: ValuationResult,
  sensitivity: SensitivityResult | null,
  scenarios: ScenarioOutcome[],
  relative: RelativeOutcome[],
  sharesOutstanding: number | null,
): ValuationRange {
  const perShare = (equity: number) => (sharesOutstanding && sharesOutstanding > 0 ? (equity * 100_000_000) / sharesOutstanding : null);
  const base: RangePoint = { source: 'Base DCF', label: 'Base DCF', equityValue: dcf.equityValue, perShareValue: dcf.perShareValue };

  const groups: Record<'Sensitivity' | 'Scenario' | 'Relative', RangePoint[]> = { Sensitivity: [], Scenario: [], Relative: [] };
  if (sensitivity) {
    for (const row of sensitivity.cells) for (const c of row) {
      groups.Sensitivity.push({ source: 'Sensitivity', label: `WACC ${(c.wacc * 100).toFixed(4).replace(/\.?0+$/, '')}% × g ${(c.terminalGrowth * 100).toFixed(2).replace(/\.?0+$/, '')}%`, equityValue: c.equityValue, perShareValue: c.perShareValue });
    }
  }
  for (const o of scenarios) if (o.ok) groups.Scenario.push({ source: 'Scenario', label: o.label, equityValue: o.result.equityValue, perShareValue: o.result.perShareValue });
  for (const o of relative) if (o.status === 'ok' && o.equityValue !== null) groups.Relative.push({ source: 'Relative', label: o.method, equityValue: o.equityValue, perShareValue: o.perShareValue ?? perShare(o.equityValue) });

  const spans: SourceSpan[] = (['Sensitivity', 'Scenario', 'Relative'] as const)
    .filter((s) => groups[s].length > 0)
    .map((s) => ({ source: s, low: pick(groups[s], 'min'), high: pick(groups[s], 'max') }));

  const all = [base, ...groups.Sensitivity, ...groups.Scenario, ...groups.Relative];
  return { low: pick(all, 'min'), base, high: pick(all, 'max'), spans, disclaimer: RANGE_DISCLAIMER };
}

// ---------------------------------------------------------------------------
// 검토 지표와 경고
// ---------------------------------------------------------------------------

export interface ReviewMetrics {
  /** PV(TV) / EV */
  terminalValueContribution: number | null;
  /** Base WACC − Base g */
  spread: number;
  sensitivityRange: { min: number; max: number; widthRatio: number | null } | null;
  scenarioRange: { min: number; max: number; widthRatio: number | null } | null;
  relativeRange: { min: number; max: number } | null;
  relativeDivergence: number | null;
}

export type WarningCode = 'tv-dependence' | 'narrow-spread' | 'wide-sensitivity' | 'wide-scenario' | 'relative-divergence';
export interface ValidationWarning { code: WarningCode; message: string }

export function buildValidationWarnings(m: Pick<ReviewMetrics, 'terminalValueContribution' | 'spread' | 'relativeDivergence'> & { sensitivityWidth: number | null; scenarioWidth: number | null }): ValidationWarning[] {
  const w: ValidationWarning[] = [];
  if (m.terminalValueContribution !== null && m.terminalValueContribution > TV_WARNING_THRESHOLD) {
    w.push({ code: 'tv-dependence', message: 'DCF 가치가 Terminal Value에 크게 의존합니다.' });
  }
  if (m.spread < SPREAD_NARROW_THRESHOLD) {
    w.push({ code: 'narrow-spread', message: 'WACC와 영구성장률의 차이가 작아 Terminal Value가 가정 변화에 매우 민감합니다.' });
  }
  if (m.sensitivityWidth !== null && m.sensitivityWidth > SENSITIVITY_WIDE_THRESHOLD) {
    w.push({ code: 'wide-sensitivity', message: '가정 변화에 따른 가치 변동성이 큽니다.' });
  }
  if (m.scenarioWidth !== null && m.scenarioWidth > SCENARIO_WIDE_THRESHOLD) {
    w.push({ code: 'wide-scenario', message: '시나리오에 따른 가치 차이가 큽니다. 영업 가정의 불확실성을 검토하세요.' });
  }
  if (m.relativeDivergence !== null && m.relativeDivergence > RELATIVE_DIVERGENCE_THRESHOLD) {
    w.push({ code: 'relative-divergence', message: '상대가치 결과와 DCF의 차이가 큽니다. 멀티플과 이익 기준을 확인하세요.' });
  }
  return w;
}

// ---------------------------------------------------------------------------
// 전체 Validation 모델
// ---------------------------------------------------------------------------

export interface ValidationInput {
  assumptions: ValuationInput;
  result: ValuationResult;
  sensitivity: SensitivityResult | null;
  relativeInput: RelativeInput;
}

export interface ValidationView {
  sensitivity: SensitivityView | null;
  scenarios: ScenarioView;
  relative: RelativeView;
  range: ValuationRange;
  metrics: ReviewMetrics;
  warnings: ValidationWarning[];
}

export function buildValidationView({ assumptions, result, sensitivity, relativeInput }: ValidationInput): ValidationView {
  const bridge: RelativeBridge = { interestBearingDebt: assumptions.interestBearingDebt, cash: assumptions.cash, sharesOutstanding: assumptions.sharesOutstanding };
  const scenarioOutcomes = runScenarios(assumptions);
  const relativeOutcomes = calculateRelativeValuation(relativeInput, bridge);

  const sensitivityView = sensitivity ? buildSensitivityView(sensitivity, result.enterpriseValue) : null;
  const scenarios = buildScenarioView(assumptions, scenarioOutcomes);
  const relative = buildRelativeView(result, relativeOutcomes);
  const range = buildValuationRange(result, sensitivity, scenarioOutcomes, relativeOutcomes, assumptions.sharesOutstanding);

  const metrics: ReviewMetrics = {
    terminalValueContribution: terminalValueContribution(result),
    spread: result.wacc - assumptions.terminalGrowth,
    sensitivityRange: sensitivityView ? sensitivityView.enterpriseValueRange : null,
    scenarioRange: scenarios.equityRange,
    relativeRange: relative.equityRange,
    relativeDivergence: relative.maxDivergence,
  };
  const warnings = buildValidationWarnings({
    terminalValueContribution: metrics.terminalValueContribution,
    spread: metrics.spread,
    relativeDivergence: metrics.relativeDivergence,
    sensitivityWidth: metrics.sensitivityRange?.widthRatio ?? null,
    scenarioWidth: metrics.scenarioRange?.widthRatio ?? null,
  });
  return { sensitivity: sensitivityView, scenarios, relative, range, metrics, warnings };
}
