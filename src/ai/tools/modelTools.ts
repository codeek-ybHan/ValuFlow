// Forecast · Valuation · Sensitivity · Scenario · Relative Tool. 엔진이 계산한 결과를 구조화해서 전달한다 (AI 가 다시 계산하지 않는다).
// 엔진 / valuation 은 공개 API 와 engine 의 표시 모델(validationView)만 사용한다.
import type { AiValuationContext } from '../context.ts';
import { assumptionCompleteness } from '../../store/assumptions.ts';
import { DIRECTION_NOTES, RANGE_DISCLAIMER } from '../../engine/validationView.ts';
import { dedupeWarnings, missing, ok, unavailable, type ToolResult, type ToolWarning } from './result.ts';
import { assumptionSource, assumptionWarnings, calculatedSource, historicalSource, qualityWarnings, validationOf } from './shared.ts';

const NO_RESULT = 'Valuation has not been run (assumptions incomplete or Run Valuation not executed).';

const delta = (forecast: number[], base: number | null): (number | null)[] => forecast.map((v) => (base === null ? null : v - base));

export function getForecastAssumptions(ctx: AiValuationContext): ToolResult<unknown> {
  const a = ctx.valuationAssumptions;
  if (!a) return unavailable('getForecastAssumptions', 'No valuation assumptions have been entered.');
  const c = assumptionCompleteness(a);
  const an = ctx.historicalAnalysis;
  // Tool 결과는 context 와 독립된 복사본이다 (호출자가 바꿔도 context 는 그대로)
  const pick = <K extends keyof typeof a>(...keys: K[]) => Object.fromEntries(keys.map((k) => [k, a[k] === undefined ? missing('Not entered.') : structuredClone(a[k])]));

  // 과거 대비 비교: 마지막 Actual 값과의 차이를 Tool 이 계산해 전달한다 (AI 는 해석만 한다)
  const latest = (values: (number | null)[] | undefined) => {
    const v = values?.filter((x): x is number => x !== null);
    return v && v.length > 0 ? v[v.length - 1] : null;
  };
  const growthHist = an ? latest(an.metrics.revenueGrowth.values) : null;
  const marginHist = an ? latest(an.metrics.operatingMargin.values) : null;
  const historicalComparison = {
    basis: 'Actual (Historical Analysis) 의 최근 값 대비 Forecast 가정. Forecast 는 Actual 이 아니다.',
    revenueGrowth: a.revenueGrowth ? { historicalLatest: growthHist, forecast: [...a.revenueGrowth], forecastMinusLatest: delta(a.revenueGrowth, growthHist) } : missing('Revenue growth assumption not entered.'),
    operatingMargin: a.operatingMargin ? { historicalLatest: marginHist, forecast: [...a.operatingMargin], forecastMinusLatest: delta(a.operatingMargin, marginHist) } : missing('Operating margin assumption not entered.'),
    historicalAvailable: an !== null,
    depreciationHistory: an && an.metrics.depreciation.quality.status !== 'missing' && !an.metrics.depreciation.values.every((v) => v === null)
      ? { status: 'available', values: [...an.metrics.depreciation.values] } : missing('Historical D&A is not available; the forecast D&A is the user\'s assumption.'),
  };
  const data = {
    basis: ctx.dataKinds.assumptions,
    complete: c.complete,
    missingInputs: { forecast: [...c.missing.forecast], wacc: [...c.missing.wacc], dcf: [...c.missing.dcf] },
    forecast: pick('currentRevenue', 'revenueGrowth', 'operatingMargin', 'taxRate', 'depreciation', 'capex', 'deltaNwc'),
    wacc: pick('riskFreeRate', 'beta', 'marketRiskPremium', 'preTaxCostOfDebt', 'equityMarketValue', 'debtMarketValue'),
    dcf: pick('terminalGrowth', 'interestBearingDebt', 'cash', 'sharesOutstanding'),
    units: { amounts: '억원', ratios: '소수 (8% = 0.08)', sharesOutstanding: '주' },
    historicalComparison,
  };
  const sources = [assumptionSource(ctx), ...(an ? [historicalSource(ctx)] : [])];
  return ok('getForecastAssumptions', data, sources, dedupeWarnings([...assumptionWarnings(ctx), ...(an ? qualityWarnings(ctx) : [])]));
}

export function getValuationResult(ctx: AiValuationContext): ToolResult<unknown> {
  const r = ctx.valuationResult;
  if (!r) return unavailable('getValuationResult', ctx.valuationError ? `Valuation failed: ${ctx.valuationError}` : NO_RESULT);
  const v = validationOf(ctx);
  const warnings: ToolWarning[] = (v?.warnings ?? []).map((w) => ({ code: w.code, text: `${w.message} (${w.basis})`, level: 'review' as const }));
  const data = {
    enterpriseValue: r.enterpriseValue, equityValue: r.equityValue, perShareValue: r.perShareValue,
    wacc: r.wacc, terminalGrowth: ctx.valuationAssumptions?.terminalGrowth ?? null, spread: v?.metrics.spread ?? null,
    tvContribution: v?.metrics.terminalValueContribution ?? null, netDebt: r.netDebt,
    fcff: [...r.fcff], costOfEquity: r.costOfEquity, afterTaxCostOfDebt: r.afterTaxCostOfDebt, equityWeight: r.equityWeight, debtWeight: r.debtWeight,
    units: { amounts: '억원', perShareValue: '원', ratios: '소수' },
    validationWarnings: (v?.warnings ?? []).map((w) => ({ code: w.code, message: w.message, basis: w.basis })),
    disclaimer: '엔진이 가정으로 계산한 결과이며 보장된 적정가치가 아닙니다.',
  };
  return ok('getValuationResult', data, [calculatedSource(ctx), assumptionSource(ctx)], dedupeWarnings([...assumptionWarnings(ctx), ...warnings]));
}

export function getSensitivityAnalysis(ctx: AiValuationContext): ToolResult<unknown> {
  if (!ctx.sensitivityResult) return unavailable('getSensitivityAnalysis', ctx.sensitivityError ? `Sensitivity failed: ${ctx.sensitivityError}` : 'Sensitivity has not been calculated.');
  const v = validationOf(ctx)?.sensitivity;
  if (!v) return unavailable('getSensitivityAnalysis', NO_RESULT);
  const data = {
    // Base(입력에서 나온 값)와 분석 범위(축)는 다른 개념이다
    base: { wacc: v.base.wacc, terminalGrowth: v.base.terminalGrowth, inGrid: v.base.inGrid },
    range: { ...v.range },
    waccValues: [...v.waccValues], terminalGrowthValues: [...v.terminalGrowthValues],
    rows: v.rows.map((row) => ({ terminalGrowth: row.terminalGrowth, cells: row.cells.map((c) => ({ ...c })) })),
    enterpriseValueRange: { ...v.enterpriseValueRange }, equityValueRange: { ...v.equityValueRange },
    directionNotes: [...DIRECTION_NOTES],
    units: { amounts: '억원', perShareValue: '원', ratios: '소수' },
  };
  const warnings = (validationOf(ctx)?.warnings ?? []).filter((w) => w.code === 'wide-sensitivity' || w.code === 'narrow-spread' || w.code === 'tv-dependence').map((w) => ({ code: w.code, text: `${w.message} (${w.basis})`, level: 'review' as const }));
  return ok('getSensitivityAnalysis', data, [calculatedSource(ctx), assumptionSource(ctx)], dedupeWarnings([...assumptionWarnings(ctx), ...warnings]));
}

export function getScenarioAnalysis(ctx: AiValuationContext): ToolResult<unknown> {
  const v = validationOf(ctx);
  if (!v) return unavailable('getScenarioAnalysis', 'Scenarios need complete valuation assumptions and a valuation result.');
  const data = {
    columns: v.scenarios.columns.map((c) => ({ ...c, assumptions: { ...c.assumptions } })),
    equityRange: v.scenarios.equityRange ? { ...v.scenarios.equityRange } : null,
    units: { amounts: '억원', perShareValue: '원', ratios: '소수' },
    note: 'Bear / Bull 은 현재 가정에서 파생한 가정 묶음이며 예측이 아닙니다.',
  };
  const warnings = v.warnings.filter((w) => w.code === 'wide-scenario').map((w) => ({ code: w.code, text: `${w.message} (${w.basis})`, level: 'review' as const }));
  return ok('getScenarioAnalysis', data, [calculatedSource(ctx), assumptionSource(ctx)], dedupeWarnings([...assumptionWarnings(ctx), ...warnings]));
}

export function getRelativeValuation(ctx: AiValuationContext): ToolResult<unknown> {
  const v = validationOf(ctx);
  if (!v) return unavailable('getRelativeValuation', NO_RESULT);
  const data = {
    inputs: { ...ctx.relativeInputs },
    inputsSource: 'user-input (멀티플 · 이익 기준은 사용자가 입력한 가정)',
    rows: v.relative.rows.map((r) => ({ ...r })),
    equityRange: v.relative.equityRange ? { ...v.relative.equityRange } : null,
    maxDivergence: v.relative.maxDivergence,
    disclaimer: RANGE_DISCLAIMER,
    units: { amounts: '억원', perShareValue: '원' },
  };
  const warnings = v.warnings.filter((w) => w.code === 'relative-divergence').map((w) => ({ code: w.code, text: `${w.message} (${w.basis})`, level: 'review' as const }));
  return ok('getRelativeValuation', data, [calculatedSource(ctx), assumptionSource(ctx)], dedupeWarnings([...assumptionWarnings(ctx), ...warnings]));
}
