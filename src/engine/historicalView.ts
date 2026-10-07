// Historical View 의 표시용 모델. 입력은 historicalData 하나뿐이며 Forecast / Result 와 섞지 않는다.
// 지표는 deriveHistoricalMetrics 를 재사용하고, 추세 요약은 숫자 기반 규칙(rule-based)으로만 만든다 (AI 문장 아님).
// 원본 historicalData 값은 변경하지 않는다. 표시용 변환(조원 환산 등)은 chart 필드에만 적용한다.
import type { HistoricalData } from '../data/types';
import { analyzeHistorical, type HistoricalAnalysis } from './historicalAnalysis.ts';
import type { DataQuality } from '../data/normalization/quality.ts';
import { depreciationUnavailableNote, historicalDepreciation } from './depreciation.ts';

export interface HistoricalHeader {
  name: string;
  ticker: string;
  basis: string;
  currency: string;
  /** 'KRW million' */
  unitLabel: string;
  /** Actual 표기가 붙은 기간 라벨 (2023A …) */
  periods: string[];
  /** '2023A – 2025A' */
  periodRange: string;
}

export interface HistoricalRow {
  key: string;
  label: string;
  values: (number | null)[];
  kind: 'amount' | 'percent';
  /** 행 아래에 보여줄 설명 (CAPEX 기준, FCFF 아님 등) */
  note?: string;
}

export interface TrendItem {
  key: 'revenueGrowth' | 'operatingMargin' | 'nwc' | 'cashGeneration';
  title: string;
  lines: string[];
  verdict: string;
}

export interface HistoricalChartData {
  labels: string[];
  /** 조원 (KRW million ÷ 1,000,000). 차트 표시용 환산이며 원본 값은 그대로다. */
  revenueTrillion: number[];
  operatingProfitTrillion: number[];
  /** % (소수 × 100) */
  operatingMarginPct: (number | null)[];
  revenueGrowthPct: (number | null)[];
}

export interface HistoricalView {
  header: HistoricalHeader;
  keyFinancials: HistoricalRow[];
  metrics: HistoricalRow[];
  trends: TrendItem[];
  chart: HistoricalChartData;
}

const MILLION_PER_TRILLION = 1_000_000;

const signedPct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const present = (x: number | null): x is number => x !== null && Number.isFinite(x);

function noteText(a: HistoricalAnalysis, ...keys: (keyof HistoricalAnalysis['metrics'])[]): string | undefined {
  const notes = keys.flatMap((k) => {
    const q = a.metrics[k].quality;
    return q.status === 'available' ? [] : q.notes.length > 0 ? q.notes : [`${a.metrics[k].label}: ${q.status}`];
  });
  return notes.length > 0 ? [...new Set(notes)].join(' ') : undefined;
}

// 추세 방향은 historicalAnalysis 의 Trend engine 이 판정하고, 여기서는 화면 문구로만 바꾼다.
function buildTrends(a: HistoricalAnalysis): TrendItem[] {
  const { periods, metrics: m, trends: t } = a;
  const growthLines = m.revenueGrowth.values.flatMap((g, i) => (present(g) ? [`${periods[i]}: ${signedPct(g)}`] : []));
  const g = t.revenueGrowth;
  const growthVerdict = g.direction === 'insufficient-data' ? '추세 판단에는 2개 이상의 성장률 구간이 필요합니다.'
    : g.direction === 'stable' ? '성장률 유지'
    : g.direction === 'accelerating' ? '성장률 가속'
    : g.to!.value > 0 ? '성장률 둔화 (매출은 증가세 유지)' : '매출 감소';

  const marginLines = m.operatingMargin.values.flatMap((v, i) => (present(v) ? [`${periods[i]}: ${pct(v)}`] : []));
  const mg = t.operatingMargin;
  const marginVerdict = mg.direction === 'insufficient-data' ? '비교할 기간이 부족합니다.'
    : mg.direction === 'stable' ? '유지'
    : mg.direction === 'improving' ? `개선 (${mg.from!.period} → ${mg.to!.period}: +${mg.change!.toFixed(1)}%p)`
    : `악화 (${mg.from!.period} → ${mg.to!.period}: ${mg.change!.toFixed(1)}%p)`;

  const nwcLines = m.nwc.values.map((v, i) => `${periods[i]}: ${present(v) ? v.toLocaleString('ko-KR') : '—'}`);
  const n = t.nwc;
  const nwcVerdict = n.direction === 'insufficient-data' ? '비교할 기간이 부족합니다.'
    : `${n.from!.period} → ${n.to!.period} ${n.direction === 'increasing' ? '증가' : n.direction === 'decreasing' ? '감소' : '유지'} (${signedPct(n.change!)})`;

  const cashLines = m.cfoMinusCapex.values.map((v, i) => {
    const ratio = m.cfoToCapex.values[i];
    return `${periods[i]}: ${present(v) ? v.toLocaleString('ko-KR') : '—'}${present(ratio) ? ` · CFO/CAPEX ${ratio.toFixed(2)}x` : ''}`;
  });
  const c = t.cashGeneration;
  const cashVerdict = c.direction === 'insufficient-data' ? '비교할 기간이 부족합니다.'
    : c.direction === 'improving' ? '개선 (CFO − CAPEX 증가)' : c.direction === 'deteriorating' ? '악화 (CFO − CAPEX 감소)' : '유지';

  return [
    { key: 'revenueGrowth', title: 'Revenue Growth', lines: growthLines, verdict: growthVerdict },
    { key: 'operatingMargin', title: 'Operating Margin', lines: marginLines, verdict: marginVerdict },
    { key: 'nwc', title: 'NWC', lines: nwcLines, verdict: nwcVerdict },
    { key: 'cashGeneration', title: 'CFO − CAPEX (Cash generation)', lines: cashLines, verdict: cashVerdict },
  ];
}

/** historicalData 가 없으면 null (Empty State). 그 외 값은 사용하지 않는다. */
export function buildHistoricalView(h: HistoricalData | null, quality: DataQuality | null = null): HistoricalView | null {
  if (!h) return null;
  const a = analyzeHistorical(h, quality);
  const m = a.metrics;
  const periods = h.company.period;
  const { incomeStatement: is, cashFlow: cf } = h;
  const da = historicalDepreciation(h);

  return {
    header: {
      name: h.company.name,
      ticker: h.company.ticker,
      basis: h.company.basis,
      currency: h.company.currency,
      unitLabel: `${h.company.currency} ${h.company.unit}`,
      periods,
      periodRange: `${periods[0]} – ${periods[periods.length - 1]}`,
    },
    keyFinancials: [
      { key: 'revenue', label: 'Revenue', values: is.revenue, kind: 'amount' },
      { key: 'operatingProfit', label: 'Operating Profit', values: is.operatingProfit, kind: 'amount' },
      { key: 'netIncome', label: 'Net Income', values: is.netIncome, kind: 'amount' },
      { key: 'cfo', label: 'CFO', values: cf.cfo, kind: 'amount' },
      da
        ? { key: 'depreciationAmortization', label: 'D&A', values: da, kind: 'amount' }
        : { key: 'depreciationAmortization', label: 'D&A', values: periods.map(() => null), kind: 'amount', note: depreciationUnavailableNote(h) },
      { key: 'capex', label: 'CAPEX (PPE acquisition basis)', values: m.capex.values, kind: 'amount', note: '유형자산 취득액 기준의 학습용 CAPEX 입니다. 무형자산 취득 등을 반영한 실무 조정치가 아닙니다.' },
    ],
    metrics: [
      { key: 'revenueGrowth', label: 'Revenue Growth (YoY)', values: m.revenueGrowth.values, kind: 'percent', note: noteText(a, 'revenueGrowth') },
      { key: 'operatingMargin', label: 'Operating Margin', values: m.operatingMargin.values, kind: 'percent', note: noteText(a, 'operatingMargin') },
      { key: 'netMargin', label: 'Net Margin', values: m.netMargin.values, kind: 'percent', note: noteText(a, 'netMargin') },
      { key: 'nwc', label: 'NWC (AR + Inventory − AP)', values: m.nwc.values, kind: 'amount', note: noteText(a, 'nwc') },
      { key: 'deltaNwc', label: 'ΔNWC', values: m.deltaNwc.values, kind: 'amount', note: noteText(a, 'deltaNwc') },
      { key: 'nwcToRevenue', label: 'NWC / Revenue', values: m.nwcToRevenue.values, kind: 'percent', note: noteText(a, 'nwcToRevenue') },
      { key: 'cfoMinusCapex', label: 'CFO − CAPEX (Reference)', values: m.cfoMinusCapex.values, kind: 'amount', note: ['현금창출력을 가늠하는 참고지표이며 FCFF 가 아닙니다.', noteText(a, 'cfoMinusCapex')].filter(Boolean).join(' ') },
      ...(m.netDebtExLease.quality.status === 'missing' ? [] : [{ key: 'netDebtExLease', label: m.netDebtExLease.label, values: m.netDebtExLease.values, kind: 'amount' as const, note: noteText(a, 'netDebtExLease') }]),
    ],
    trends: buildTrends(a),
    chart: {
      labels: periods,
      revenueTrillion: is.revenue.map((v) => v / MILLION_PER_TRILLION),
      operatingProfitTrillion: is.operatingProfit.map((v) => v / MILLION_PER_TRILLION),
      operatingMarginPct: m.operatingMargin.values.map((v) => (v === null ? null : v * 100)),
      revenueGrowthPct: m.revenueGrowth.values.map((v) => (v === null ? null : v * 100)),
    },
  };
}
