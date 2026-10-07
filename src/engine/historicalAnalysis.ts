// Historical Analysis Engine — Historical 지표 계산의 단일 source of truth.
//   HistoricalData (+ DataQuality) → 지표(Metrics) → 추세(Trend) → Forecast 참고 모델(ForecastReferenceModel)
// 원칙
//   - 과거 값은 미래 Forecast 값을 결정하지 않는다. 이 모듈은 사용자가 가정을 판단할 근거만 구조화하며, Forecast 자동 입력은 하지 않는다.
//   - 계산 불가(첫 해 성장률, 입력 누락 등)는 null 이다. missing 을 0 이나 추정값으로 채우지 않는다 (D&A 포함).
//   - 파생지표는 입력 계정의 품질을 상속한다: 하나라도 missing 이면 missing, partial → partial, ambiguous → ambiguous.
//   - UI 는 이 결과만 렌더링한다 (화면에 계산식을 두지 않는다). 원본 HistoricalData 는 변경하지 않는다.
//   - 추세 판정 기준은 아래 TREND_THRESHOLDS 이며, 공식 회계 기준이 아니라 화면 분석용 heuristic 이다. AI 해설이 아니라 규칙 기반이다.
import type { HistoricalData } from '../data/types';
import { ACCOUNT_RULES, type CanonicalField } from '../data/normalization/accounts.ts';
import type { DataQuality, FieldStatus } from '../data/normalization/quality.ts';
import type { NormalizeFailureCode, NormalizeResult } from '../data/normalization/normalizeFinancials.ts';
import type { HistoricalFinancialsResult } from '../data/repository/financialRepository.ts';
import { CAPEX_BASIS_LABELS, DEFAULT_CAPEX_BASIS, type CapexBasis } from '../data/normalization/derived.ts';
import { cagr, growth, grossMargin, netDebt, netMargin, operatingMargin, safeDiv } from './analysis.ts';

// ---- 추세 판정 기준 (UI 분석용 heuristic, 회계 기준 아님) ----
export const TREND_THRESHOLDS = {
  /** 매출 성장률: 마지막 두 구간의 차이가 0.5%p 미만이면 stable */
  growthChange: 0.005,
  /** 마진(영업 · 순 · 매출총): 처음 → 마지막 변화가 0.5%p 미만이면 stable */
  marginChangePp: 0.5,
  /** NWC: 처음 → 마지막 변화율이 3% 미만이면 stable */
  nwcChange: 0.03,
  /** CFO − CAPEX: 처음 → 마지막 변화가 두 값 중 큰 절댓값의 5% 미만이면 stable */
  cashGenerationChange: 0.05,
} as const;

export const UNSUPPORTED_MESSAGE = 'This company is not supported by the current generic analysis model.';

export type MetricStatus = FieldStatus;

export interface MetricQuality {
  status: MetricStatus;
  /** 이 지표가 쓴 canonical 입력과 각각의 상태 */
  inputs: { field: CanonicalField; status: FieldStatus }[];
  /** 입력 품질에서 온 warning (예: weak 매핑 안내) */
  notes: string[];
}

export type MetricUnit = 'ratio' | 'krwMillion';

export interface MetricSeries {
  key: string;
  label: string;
  unit: MetricUnit;
  /** 기간별 값. 계산 불가는 null (0 이 아니다). */
  values: (number | null)[];
  quality: MetricQuality;
  /** 기준 설명 (CAPEX 기준, Net Debt 기준 등) */
  basis?: string;
}

export type GrowthTrend = 'accelerating' | 'decelerating' | 'stable' | 'insufficient-data';
export type MarginTrend = 'improving' | 'deteriorating' | 'stable' | 'insufficient-data';
export type LevelTrend = 'increasing' | 'decreasing' | 'stable' | 'insufficient-data';
export type CashTrend = 'improving' | 'deteriorating' | 'stable' | 'insufficient-data';

export interface TrendPoint { period: string; value: number }

export interface TrendResult<D extends string = string> {
  direction: D;
  /** 비교에 쓴 시작 / 끝 값 (insufficient-data 면 없음) */
  from?: TrendPoint;
  to?: TrendPoint;
  /** growth: 두 성장률의 차(소수) · margin: %p · nwc: 변화율 · cash: 변화량(KRW million) */
  change?: number;
  /** 입력 품질을 상속 */
  quality: MetricStatus;
}

export interface HistoricalTrends {
  revenueGrowth: TrendResult<GrowthTrend>;
  grossMargin: TrendResult<MarginTrend>;
  operatingMargin: TrendResult<MarginTrend>;
  netMargin: TrendResult<MarginTrend>;
  nwc: TrendResult<LevelTrend>;
  cashGeneration: TrendResult<CashTrend>;
  /** D&A 는 값이 없으면 추세를 만들지 않는다. */
  depreciation: TrendResult<'unavailable' | LevelTrend>;
}

export interface HistoryRow {
  label: string;
  unit: MetricUnit;
  periods: string[];
  values: (number | null)[];
  quality: MetricQuality;
  basis?: string;
}

/** Forecast Workspace 가 읽는 과거 참고 모델. Forecast 값은 만들지 않는다. */
export interface ForecastReferenceModel {
  periods: string[];
  revenueGrowthHistory: HistoryRow;
  operatingMarginHistory: HistoryRow;
  capexHistory: HistoryRow;
  deltaNwcHistory: HistoryRow;
  /** D&A 가 missing 이면 undefined */
  depreciationHistory?: HistoryRow;
  /** HistoricalData 에 법인세 정보가 없어 현재는 항상 undefined */
  taxRateHistory?: HistoryRow;
  /** 'Historical D&A unavailable' 처럼 화면에 보여 줄 부재 안내 */
  unavailable: string[];
  /** 최근 Actual 매출 (KRW million) */
  latestRevenue: { period: string; value: number };
}

export interface HistoricalAnalysis {
  periods: string[];
  /** 'KRW million' */
  unitLabel: string;
  metrics: {
    revenueGrowth: MetricSeries;
    grossMargin: MetricSeries;
    operatingMargin: MetricSeries;
    netMargin: MetricSeries;
    nwc: MetricSeries;
    deltaNwc: MetricSeries;
    nwcToRevenue: MetricSeries;
    cfo: MetricSeries;
    capex: MetricSeries;
    /** 참고지표. FCFF 가 아니다. */
    cfoMinusCapex: MetricSeries;
    cfoToCapex: MetricSeries;
    depreciation: MetricSeries;
    cash: MetricSeries;
    interestBearingDebt: MetricSeries;
    leaseLiabilities: MetricSeries;
    /** 이자부부채 − 현금. 리스부채는 포함하지 않는다. */
    netDebtExLease: MetricSeries;
  };
  /** 매출 CAGR (첫 해 → 마지막 해). 계산 불가면 null */
  revenueCagr: number | null;
  capexBasis: CapexBasis;
  capexBasisLabel: string;
  trends: HistoricalTrends;
  forecastReference: ForecastReferenceModel;
  /** 입력 데이터 품질 (있을 때) */
  dataQuality: DataQuality | null;
  warnings: string[];
}

// ---- 품질 상속 ----
const FIELD_LABEL = new Map(ACCOUNT_RULES.map((r) => [r.field, r.label]));

function presenceStatus(h: HistoricalData, f: CanonicalField): FieldStatus {
  const n = h.company.period.length;
  const arr = (h.incomeStatement as Record<string, number[] | undefined>)[f] ?? (h.balanceSheet as Record<string, number[] | undefined>)[f] ?? (h.cashFlow as Record<string, number[] | undefined>)[f];
  return arr === undefined ? 'missing' : arr.length === n ? 'available' : 'partial';
}

/** 입력 상태를 합친다: missing > partial > ambiguous > available. */
function combine(inputs: FieldStatus[]): MetricStatus {
  if (inputs.includes('missing')) return 'missing';
  if (inputs.includes('partial')) return 'partial';
  if (inputs.includes('ambiguous')) return 'ambiguous';
  return 'available';
}

function qualityOf(h: HistoricalData, q: DataQuality | null, fields: CanonicalField[]): MetricQuality {
  const inputs = fields.map((field) => ({ field, status: q?.fields[field]?.status ?? presenceStatus(h, field) }));
  const labels = fields.map((f) => FIELD_LABEL.get(f)).filter((l): l is string => !!l);
  const notes = (q?.warnings ?? []).filter((w) => labels.some((l) => w.includes(l)));
  return { status: combine(inputs.map((i) => i.status)), inputs, notes: [...new Set(notes)] };
}

const blanks = (n: number): null[] => Array.from({ length: n }, () => null);

// ---- 분석 ----
export function analyzeHistorical(h: HistoricalData, quality: DataQuality | null = null, capexBasis: CapexBasis = DEFAULT_CAPEX_BASIS): HistoricalAnalysis {
  const periods = h.company.period;
  const n = periods.length;
  const { revenue, grossProfit, operatingProfit, netIncome } = h.incomeStatement;
  const { accountsReceivable: ar, inventory: inv, accountsPayable: ap } = h.balanceSheet;
  const q = (...f: CanonicalField[]) => qualityOf(h, quality, f);

  const series = (key: string, label: string, unit: MetricUnit, qual: MetricQuality, compute: () => (number | null)[], basis?: string): MetricSeries => ({
    key, label, unit, quality: qual, values: qual.status === 'missing' ? blanks(n) : compute(), ...(basis ? { basis } : {}),
  });

  const nwcValues = () => ar.map((v, i) => v + inv[i] - ap[i]);
  const capexFields: CanonicalField[] = capexBasis === 'ppe' ? ['ppeAcquisition'] : ['ppeAcquisition', 'intangibleAcquisition'];
  const capexValues = () => h.cashFlow.ppeAcquisition.map((v, i) => (capexBasis === 'ppe' ? v : v + h.cashFlow.intangibleAcquisition[i]));
  const nwcQ = q('accountsReceivable', 'inventory', 'accountsPayable');
  const nwcRevQ = q('accountsReceivable', 'inventory', 'accountsPayable', 'revenue');
  const capexQ = q(...capexFields);
  const cashGenQ = q('cfo', ...capexFields);
  const daSeries = h.cashFlow.depreciationAmortization;
  const daQ = q('depreciationAmortization');
  // 선택 계정: 품질 정보가 available 이라고 해도 실제 시리즈가 없거나 길이가 다르면 missing 으로 본다 (값을 지어내지 않는다).
  const optional = (key: string, label: string, f: 'cash' | 'interestBearingDebt' | 'leaseLiabilities', arr: number[] | undefined): MetricSeries => {
    const qual = q(f);
    if (arr === undefined || arr.length !== n) {
      const inputs = qual.inputs.map((i) => ({ ...i, status: 'missing' as FieldStatus }));
      return { key, label, unit: 'krwMillion', quality: { ...qual, status: 'missing', inputs }, values: blanks(n) };
    }
    return series(key, label, 'krwMillion', qual, () => [...arr]);
  };

  const cash = optional('cash', 'Cash', 'cash', h.balanceSheet.cash);
  const debt = optional('interestBearingDebt', 'Interest-bearing Debt', 'interestBearingDebt', h.balanceSheet.interestBearingDebt);
  const lease = optional('leaseLiabilities', 'Lease Liabilities', 'leaseLiabilities', h.balanceSheet.leaseLiabilities);
  const NET_DEBT_BASIS = 'Net Debt (excluding lease liabilities)';
  // 순부채 품질은 실제로 만들어진 cash / debt 시리즈의 품질을 합친다
  const netDebtQ: MetricQuality = { status: combine([cash.quality.status, debt.quality.status]), inputs: [...cash.quality.inputs, ...debt.quality.inputs], notes: [...new Set([...cash.quality.notes, ...debt.quality.notes])] };

  const metrics: HistoricalAnalysis['metrics'] = {
    revenueGrowth: series('revenueGrowth', 'Revenue Growth (YoY)', 'ratio', q('revenue'), () => revenue.map((v, i) => (i === 0 ? null : growth(v, revenue[i - 1])))),
    grossMargin: series('grossMargin', 'Gross Margin', 'ratio', q('revenue', 'grossProfit'), () => revenue.map((v, i) => grossMargin(grossProfit[i], v))),
    operatingMargin: series('operatingMargin', 'Operating Margin', 'ratio', q('revenue', 'operatingProfit'), () => revenue.map((v, i) => operatingMargin(operatingProfit[i], v))),
    netMargin: series('netMargin', 'Net Margin', 'ratio', q('revenue', 'netIncome'), () => revenue.map((v, i) => netMargin(netIncome[i], v))),
    nwc: series('nwc', 'NWC (AR + Inventory − AP)', 'krwMillion', nwcQ, nwcValues),
    deltaNwc: series('deltaNwc', 'ΔNWC', 'krwMillion', nwcQ, () => nwcValues().map((v, i, a) => (i === 0 ? null : v - a[i - 1]))),
    nwcToRevenue: series('nwcToRevenue', 'NWC / Revenue', 'ratio', nwcRevQ, () => nwcValues().map((v, i) => safeDiv(v, revenue[i]))),
    cfo: series('cfo', 'CFO', 'krwMillion', q('cfo'), () => [...h.cashFlow.cfo]),
    capex: series('capex', 'CAPEX', 'krwMillion', capexQ, capexValues, CAPEX_BASIS_LABELS[capexBasis]),
    cfoMinusCapex: series('cfoMinusCapex', 'CFO − CAPEX (Reference)', 'krwMillion', cashGenQ, () => h.cashFlow.cfo.map((v, i) => v - capexValues()[i]), `${CAPEX_BASIS_LABELS[capexBasis]} · 현금창출력 참고지표이며 FCFF 가 아닙니다.`),
    cfoToCapex: series('cfoToCapex', 'CFO / CAPEX', 'ratio', cashGenQ, () => h.cashFlow.cfo.map((v, i) => safeDiv(v, capexValues()[i]))),
    depreciation: { key: 'depreciation', label: 'D&A', unit: 'krwMillion', quality: daQ, values: daSeries && daQ.status !== 'missing' && daSeries.length === n ? [...daSeries] : blanks(n) },
    cash, interestBearingDebt: debt, leaseLiabilities: lease,
    netDebtExLease: series('netDebtExLease', NET_DEBT_BASIS, 'krwMillion', netDebtQ, () => debt.values.map((d, i) => netDebt(d, cash.values[i])), NET_DEBT_BASIS),
  };
  // 입력이 없는 선택 필드 시리즈는 값이 모두 null 이어야 한다 (optional 헬퍼가 arr 가 없을 때 계산하지 않도록 status 로 보장됨)

  const trends = buildTrends(periods, metrics);
  const row = (m: MetricSeries): HistoryRow => ({ label: m.label, unit: m.unit, periods, values: m.values, quality: m.quality, ...(m.basis ? { basis: m.basis } : {}) });
  const unavailable: string[] = [];
  const depreciationHistory = metrics.depreciation.quality.status === 'missing' || metrics.depreciation.values.every((v) => v === null) ? undefined : row(metrics.depreciation);
  if (!depreciationHistory) unavailable.push('Historical D&A unavailable');
  unavailable.push('Historical tax rate unavailable');

  const last = n - 1;
  return {
    periods,
    unitLabel: `${h.company.currency} ${h.company.unit}`,
    metrics,
    revenueCagr: n >= 2 ? cagr(revenue[0], revenue[last], n - 1) : null,
    capexBasis,
    capexBasisLabel: CAPEX_BASIS_LABELS[capexBasis],
    trends,
    forecastReference: {
      periods,
      revenueGrowthHistory: row(metrics.revenueGrowth),
      operatingMarginHistory: row(metrics.operatingMargin),
      capexHistory: row(metrics.capex),
      deltaNwcHistory: row(metrics.deltaNwc),
      ...(depreciationHistory ? { depreciationHistory } : {}),
      unavailable,
      latestRevenue: { period: periods[last], value: revenue[last] },
    },
    dataQuality: quality,
    warnings: quality?.warnings ?? [],
  };
}

// ---- Trend engine (규칙 기반) ----
const present = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function firstLast(periods: string[], values: (number | null)[]): { from: TrendPoint; to: TrendPoint } | null {
  const last = values.length - 1;
  if (last < 1 || !present(values[0]) || !present(values[last])) return null;
  return { from: { period: periods[0], value: values[0] }, to: { period: periods[last], value: values[last] } };
}

function marginTrend(periods: string[], m: MetricSeries): TrendResult<MarginTrend> {
  const fl = m.quality.status === 'missing' ? null : firstLast(periods, m.values);
  if (!fl) return { direction: 'insufficient-data', quality: m.quality.status };
  const pp = (fl.to.value - fl.from.value) * 100;
  const direction: MarginTrend = Math.abs(pp) < TREND_THRESHOLDS.marginChangePp ? 'stable' : pp > 0 ? 'improving' : 'deteriorating';
  return { direction, ...fl, change: pp, quality: m.quality.status };
}

function buildTrends(periods: string[], m: HistoricalAnalysis['metrics']): HistoricalTrends {
  // 매출 성장률: 마지막 두 성장률 구간
  const gv = m.revenueGrowth.values.map((v, i) => ({ v, i })).filter((x) => present(x.v)) as { v: number; i: number }[];
  let revenueGrowth: TrendResult<GrowthTrend> = { direction: 'insufficient-data', quality: m.revenueGrowth.quality.status };
  if (m.revenueGrowth.quality.status !== 'missing' && gv.length >= 2) {
    const cur = gv[gv.length - 1], prev = gv[gv.length - 2];
    const diff = cur.v - prev.v;
    revenueGrowth = {
      direction: Math.abs(diff) < TREND_THRESHOLDS.growthChange ? 'stable' : diff < 0 ? 'decelerating' : 'accelerating',
      from: { period: periods[prev.i], value: prev.v }, to: { period: periods[cur.i], value: cur.v }, change: diff, quality: m.revenueGrowth.quality.status,
    };
  }

  const level = (s: MetricSeries): TrendResult<LevelTrend> => {
    const fl = s.quality.status === 'missing' ? null : firstLast(periods, s.values);
    if (!fl || fl.from.value === 0) return { direction: 'insufficient-data', quality: s.quality.status };
    const chg = fl.to.value / fl.from.value - 1;
    return { direction: Math.abs(chg) < TREND_THRESHOLDS.nwcChange ? 'stable' : chg > 0 ? 'increasing' : 'decreasing', ...fl, change: chg, quality: s.quality.status };
  };

  const cg = m.cfoMinusCapex;
  const cgl = cg.quality.status === 'missing' ? null : firstLast(periods, cg.values);
  const cashGeneration: TrendResult<CashTrend> = cgl
    ? (() => {
        const d = cgl.to.value - cgl.from.value;
        const scale = Math.max(Math.abs(cgl.from.value), Math.abs(cgl.to.value), 1);
        return { direction: (Math.abs(d) / scale < TREND_THRESHOLDS.cashGenerationChange ? 'stable' : d > 0 ? 'improving' : 'deteriorating') as CashTrend, ...cgl, change: d, quality: cg.quality.status };
      })()
    : { direction: 'insufficient-data', quality: cg.quality.status };

  const depreciation: HistoricalTrends['depreciation'] = m.depreciation.quality.status === 'missing' || m.depreciation.values.every((v) => v === null)
    ? { direction: 'unavailable', quality: 'missing' }
    : level(m.depreciation);

  return {
    revenueGrowth, grossMargin: marginTrend(periods, m.grossMargin), operatingMargin: marginTrend(periods, m.operatingMargin), netMargin: marginTrend(periods, m.netMargin),
    nwc: level(m.nwc), cashGeneration, depreciation,
  };
}

// ---- 정규화 결과 연결: 지원하지 않는 기업은 분석하지 않는다 ----
export type HistoricalAnalysisOutcome =
  | { status: 'ok'; analysis: HistoricalAnalysis }
  | { status: 'unsupported'; code: Extract<NormalizeFailureCode, 'unsupported-industry' | 'unsupported-structure'>; reason: string; message: string; quality: DataQuality }
  | { status: 'incomplete'; reason: string; quality: DataQuality | null }
  | { status: 'unavailable'; reason: string };

/** normalizeFinancials 결과 → 분석. unsupported 면 빈 지표를 만들지 않고 사유를 돌려준다. */
export function analyzeNormalized(result: NormalizeResult, capexBasis: CapexBasis = DEFAULT_CAPEX_BASIS): HistoricalAnalysisOutcome {
  if (result.ok) return { status: 'ok', analysis: analyzeHistorical(result.data, result.quality, capexBasis) };
  if (result.code === 'unsupported-industry' || result.code === 'unsupported-structure') {
    return { status: 'unsupported', code: result.code, reason: result.reason, message: UNSUPPORTED_MESSAGE, quality: result.quality };
  }
  return { status: 'incomplete', reason: result.reason, quality: result.quality };
}


/** repository 결과 → 분석. 성공한 데이터만 분석하고, 미지원 / 불완전 / 조회 실패는 사유를 그대로 전달한다 (fixture 로 대체하지 않는다). */
export function analyzeRepositoryResult(result: HistoricalFinancialsResult, capexBasis: CapexBasis = DEFAULT_CAPEX_BASIS): HistoricalAnalysisOutcome {
  if (result.ok) return { status: 'ok', analysis: analyzeHistorical(result.data, result.quality, capexBasis) };
  if (result.reason === 'unsupported' && result.quality) {
    return { status: 'unsupported', code: result.code ?? 'unsupported-structure', reason: result.message, message: UNSUPPORTED_MESSAGE, quality: result.quality };
  }
  if (result.reason === 'incomplete') return { status: 'incomplete', reason: result.message, quality: result.quality ?? null };
  return { status: 'unavailable', reason: result.message };
}
