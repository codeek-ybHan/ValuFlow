// Historical 영역 Tool: 기업 개요 · Historical Analysis. context 만 읽고 계산은 Historical Analysis Engine 의 결과를 전달한다.
import type { AiValuationContext } from '../context.ts';
import { assumptionCompleteness } from '../../store/assumptions.ts';
import { HISTORICAL_METRIC_KEYS } from './definitions.ts';
import { dedupeWarnings, missing, ok, unavailable, type Missing, type ToolResult } from './result.ts';
import { assumptionSource, historicalSource, qualityWarnings } from './shared.ts';
import type { MetricSeries } from '../../engine/historicalAnalysis.ts';

type MetricOut = { label: string; unit: string; values: (number | null)[]; status: string; notes: string[]; basis?: string; missing?: Missing };

const D_A_REASON = 'Not available from current OpenDART financial statement source.';

export function getCompanyOverview(ctx: AiValuationContext) {
  const completeness = assumptionCompleteness(ctx.valuationAssumptions);
  const data = {
    company: ctx.company ? { name: ctx.company.name, ...(ctx.company.corpCode ? { corpCode: ctx.company.corpCode } : {}), ...(ctx.company.stockCode ? { stockCode: ctx.company.stockCode } : {}), ...(ctx.company.basis ? { basis: ctx.company.basis } : {}) } : null,
    support: ctx.support,
    dataKinds: ctx.dataKinds,
    periods: ctx.historicalData ? ctx.historicalData.company.period : null,
    availability: {
      historical: ctx.historicalData !== null,
      dataQuality: ctx.historicalQuality !== null,
      assumptionsComplete: completeness.complete,
      valuationResult: ctx.valuationResult !== null,
      sensitivity: ctx.sensitivityResult !== null,
      relativeInputs: Object.keys(ctx.relativeInputs).length > 0,
    },
  };
  const sources = [
    ...(ctx.historicalData ? [historicalSource(ctx)] : []),
    ...(ctx.valuationAssumptions ? [assumptionSource(ctx)] : []),
  ];
  const warnings = ctx.support.status === 'unsupported'
    ? [{ code: 'unsupported-company', text: ctx.support.message, level: 'review' as const }]
    : [];
  return ok('getCompanyOverview', data, sources, warnings);
}

function metricOut(m: MetricSeries): MetricOut {
  const out: MetricOut = { label: m.label, unit: m.unit === 'ratio' ? 'ratio (소수)' : 'KRW million', values: [...m.values], status: m.quality.status, notes: [...m.quality.notes] };
  if (m.basis) out.basis = m.basis;
  if (m.quality.status === 'missing') out.missing = missing('Required input accounts are missing, so this metric is not computed.');
  return out;
}

export function getHistoricalAnalysis(ctx: AiValuationContext, input: { metrics?: string[] } = {}): ToolResult<unknown> {
  const a = ctx.historicalAnalysis;
  if (!a || !ctx.historicalData) return unavailable('getHistoricalAnalysis', 'Historical data has not been loaded.');
  const wanted = (input.metrics && input.metrics.length > 0 ? input.metrics : [...HISTORICAL_METRIC_KEYS]) as (typeof HISTORICAL_METRIC_KEYS)[number][];
  const metrics: Record<string, MetricOut> = {};
  for (const k of wanted) metrics[k] = metricOut(a.metrics[k]);

  const trends: Record<string, unknown> = {};
  for (const [k, t] of Object.entries(a.trends)) {
    trends[k] = { direction: t.direction, quality: t.quality, ...(t.from ? { from: { ...t.from } } : {}), ...(t.to ? { to: { ...t.to } } : {}), ...(t.change !== undefined ? { change: t.change } : {}) };
  }
  const daMissing = a.metrics.depreciation.quality.status === 'missing' || a.metrics.depreciation.values.every((v) => v === null);
  const data = {
    periods: [...a.periods],
    unit: 'KRW million (비율 제외)',
    metrics,
    trends,
    revenueCagr: a.revenueCagr,
    capexBasis: a.capexBasisLabel,
    // D&A: 값이 없으면 채우지 않고 사유와 함께 missing 으로 전달한다
    depreciation: daMissing ? missing(D_A_REASON) : { status: 'available' as const, values: [...a.metrics.depreciation.values] },
    trendThresholds: { note: 'UI 분석용 heuristic 이며 공식 회계 기준이 아닙니다.', growthChangePp: 0.5, marginChangePp: 0.5, nwcChange: 0.03, cashGenerationChange: 0.05 },
  };
  return ok('getHistoricalAnalysis', data, [historicalSource(ctx)], dedupeWarnings(qualityWarnings(ctx)));
}
