// Historical Performance section: HistoricalData(Actual) + HistoricalAnalysis(ValuFlow 가 계산한 지표)를 옮긴다. 지표를 다시 계산하지 않는다.
import type { MetricSeries } from '../../engine/historicalAnalysis.ts';
import type { ReportInput } from '../input.ts';
import type { HistoricalPerformance, TableRow } from '../model.ts';
import { SRC_HISTORICAL } from '../sources.ts';
import type { Cell, DataKind, PeriodLabel, SectionState, Narrative } from '../types.ts';
import { cell, eokFromKrwMillion, missingCell } from '../units.ts';

export const periodLabels = (periods: string[]): PeriodLabel[] => periods.map((p) => ({ label: p, kind: /E$/i.test(p) ? 'estimate' : 'actual' }));

/** Actual 금액 항목(재무제표 계정)과 엔진이 계산한 파생 지표를 구분한다. */
const METRICS: { key: keyof ReportInputMetrics; kind: DataKind }[] = [
  { key: 'revenueGrowth', kind: 'calculated' }, { key: 'grossMargin', kind: 'calculated' }, { key: 'operatingMargin', kind: 'calculated' }, { key: 'netMargin', kind: 'calculated' },
  { key: 'cfo', kind: 'actual' }, { key: 'capex', kind: 'actual' }, { key: 'cfoMinusCapex', kind: 'calculated' }, { key: 'depreciation', kind: 'actual' },
  { key: 'cash', kind: 'actual' }, { key: 'interestBearingDebt', kind: 'actual' }, { key: 'netDebtExLease', kind: 'calculated' },
];
type ReportInputMetrics = NonNullable<ReportInput['historicalAnalysis']>['metrics'];

const FIRST_PERIOD_NA = new Set(['revenueGrowth', 'deltaNwc']);

function metricRow(s: MetricSeries, kind: DataKind): TableRow {
  const cells: Cell[] = s.values.map((v, i) => {
    const ifMissing = s.quality.status === 'missing'
      ? { state: 'unavailable' as const, reason: '필요한 입력 계정이 공시 데이터에 없어 계산하지 않았습니다.' }
      : i === 0 && FIRST_PERIOD_NA.has(s.key)
        ? { state: 'not-applicable' as const, reason: '첫 기간은 비교할 직전 연도가 없습니다.' }
        : { state: 'missing' as const, reason: '이 기간의 값이 없습니다.' };
    return s.unit === 'ratio' ? cell(v, 'ratio', kind, SRC_HISTORICAL, ifMissing) : eokFromKrwMillion(v, kind, SRC_HISTORICAL, ifMissing);
  });
  return { key: s.key, label: s.label, unit: s.unit === 'ratio' ? 'ratio' : 'eok', note: s.basis ?? (s.quality.notes[0] ?? null), cells };
}

export function buildHistorical(input: ReportInput, narrative: SectionState<Narrative>): HistoricalPerformance {
  const h = input.historical!;
  const a = input.historicalAnalysis!;
  const stmt = (key: string, label: string, arr: number[]): TableRow => ({ key, label, unit: 'eok', note: 'KRW million → 억원', cells: h.company.period.map((_, i) => eokFromKrwMillion(arr[i], 'actual', SRC_HISTORICAL)) });
  const rows: TableRow[] = [
    stmt('revenue', 'Revenue', h.incomeStatement.revenue),
    stmt('operatingProfit', 'Operating Profit', h.incomeStatement.operatingProfit),
    stmt('netIncome', 'Net Income', h.incomeStatement.netIncome),
    ...METRICS.map((m) => metricRow(a.metrics[m.key], m.kind)),
  ];
  const trends = Object.entries(a.trends).map(([key, t]) => ({ key, direction: t.direction, fromPeriod: t.from?.period ?? null, toPeriod: t.to?.period ?? null }));
  return {
    periods: periodLabels(a.periods), rows, trends,
    revenueCagr: cell(a.revenueCagr, 'ratio', 'calculated', SRC_HISTORICAL, { state: 'not-applicable', reason: '매출 CAGR 을 계산할 수 없습니다 (기간 부족 또는 값 없음).' }),
    notes: [...a.warnings, ...a.forecastReference.unavailable],
    narrative,
  };
}

export { missingCell };
