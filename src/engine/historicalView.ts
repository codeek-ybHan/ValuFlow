// Historical View 의 표시용 모델. 입력은 historicalData 하나뿐이며 Forecast / Result 와 섞지 않는다.
// 지표는 deriveHistoricalMetrics 를 재사용하고, 추세 요약은 숫자 기반 규칙(rule-based)으로만 만든다 (AI 문장 아님).
// 원본 historicalData 값은 변경하지 않는다. 표시용 변환(조원 환산 등)은 chart 필드에만 적용한다.
import type { HistoricalData } from '../data/types';
import { deriveHistoricalMetrics } from './historical.ts';

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

function buildTrends(periods: string[], h: HistoricalData, m: ReturnType<typeof deriveHistoricalMetrics>): TrendItem[] {
  const last = periods.length - 1;
  const first = periods[0];
  const end = periods[last];

  // Revenue Growth: 마지막 두 구간 비교
  const growthLines = m.revenueGrowth.flatMap((g, i) => (present(g) ? [`${periods[i]}: ${signedPct(g)}`] : []));
  const growthVals = m.revenueGrowth.filter(present);
  let growthVerdict = '추세 판단에는 2개 이상의 성장률 구간이 필요합니다.';
  if (growthVals.length >= 2) {
    const cur = growthVals[growthVals.length - 1];
    const prev = growthVals[growthVals.length - 2];
    if (Math.abs(cur - prev) < 0.005) growthVerdict = '성장률 유지';
    else if (cur < prev) growthVerdict = cur > 0 ? '성장률 둔화 (매출은 증가세 유지)' : '매출 감소';
    else growthVerdict = '성장률 가속';
  }

  // Operating Margin: 처음 → 마지막
  const marginLines = m.operatingMargin.flatMap((v, i) => (present(v) ? [`${periods[i]}: ${pct(v)}`] : []));
  let marginVerdict = '비교할 기간이 부족합니다.';
  const m0 = m.operatingMargin[0];
  const m1 = m.operatingMargin[last];
  if (last >= 1 && present(m0) && present(m1)) {
    const pp = (m1 - m0) * 100;
    marginVerdict = Math.abs(pp) < 0.5 ? '유지' : pp > 0 ? `개선 (${first} → ${end}: +${pp.toFixed(1)}%p)` : `악화 (${first} → ${end}: ${pp.toFixed(1)}%p)`;
  }

  // NWC: 처음 → 마지막
  const nwcLines = m.nwc.map((v, i) => `${periods[i]}: ${v.toLocaleString('ko-KR')}`);
  let nwcVerdict = '비교할 기간이 부족합니다.';
  if (last >= 1 && m.nwc[0] !== 0) {
    const chg = m.nwc[last] / m.nwc[0] - 1;
    nwcVerdict = `${first} → ${end} ${chg >= 0 ? '증가' : '감소'} (${signedPct(chg)})`;
  }

  // Cash generation: CFO − CAPEX 와 CFO / CAPEX
  const cfo = h.cashFlow.cfo;
  const cashLines = m.cfoMinusCapex.map((v, i) => {
    const ratio = m.capex[i] > 0 ? ` · CFO/CAPEX ${(cfo[i] / m.capex[i]).toFixed(2)}x` : '';
    return `${periods[i]}: ${v.toLocaleString('ko-KR')}${ratio}`;
  });
  let cashVerdict = '비교할 기간이 부족합니다.';
  if (last >= 1) {
    const d = m.cfoMinusCapex[last] - m.cfoMinusCapex[0];
    cashVerdict = d > 0 ? '개선 (CFO − CAPEX 증가)' : d < 0 ? '악화 (CFO − CAPEX 감소)' : '유지';
  }

  return [
    { key: 'revenueGrowth', title: 'Revenue Growth', lines: growthLines, verdict: growthVerdict },
    { key: 'operatingMargin', title: 'Operating Margin', lines: marginLines, verdict: marginVerdict },
    { key: 'nwc', title: 'NWC', lines: nwcLines, verdict: nwcVerdict },
    { key: 'cashGeneration', title: 'CFO − CAPEX (Cash generation)', lines: cashLines, verdict: cashVerdict },
  ];
}

/** historicalData 가 없으면 null (Empty State). 그 외 값은 사용하지 않는다. */
export function buildHistoricalView(h: HistoricalData | null): HistoricalView | null {
  if (!h) return null;
  const m = deriveHistoricalMetrics(h);
  const periods = h.company.period;
  const { incomeStatement: is, cashFlow: cf } = h;

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
      { key: 'capex', label: 'CAPEX (PPE acquisition basis)', values: m.capex, kind: 'amount', note: '유형자산 취득액 기준의 학습용 CAPEX 입니다. 무형자산 취득 등을 반영한 실무 조정치가 아닙니다.' },
    ],
    metrics: [
      { key: 'revenueGrowth', label: 'Revenue Growth (YoY)', values: m.revenueGrowth, kind: 'percent' },
      { key: 'operatingMargin', label: 'Operating Margin', values: m.operatingMargin, kind: 'percent' },
      { key: 'nwc', label: 'NWC (AR + Inventory − AP)', values: m.nwc, kind: 'amount' },
      { key: 'deltaNwc', label: 'ΔNWC', values: m.deltaNwc, kind: 'amount' },
      { key: 'cfoMinusCapex', label: 'CFO − CAPEX (Reference)', values: m.cfoMinusCapex, kind: 'amount', note: '현금창출력을 가늠하는 참고지표이며 FCFF 가 아닙니다.' },
    ],
    trends: buildTrends(periods, h, m),
    chart: {
      labels: periods,
      revenueTrillion: is.revenue.map((v) => v / MILLION_PER_TRILLION),
      operatingProfitTrillion: is.operatingProfit.map((v) => v / MILLION_PER_TRILLION),
      operatingMarginPct: m.operatingMargin.map((v) => (v === null ? null : v * 100)),
      revenueGrowthPct: m.revenueGrowth.map((v) => (v === null ? null : v * 100)),
    },
  };
}
