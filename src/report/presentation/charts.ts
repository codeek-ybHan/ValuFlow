// ChartModel 빌더. 특정 chart library 에 종속되지 않고, series 의 값은 ReportModel Cell 의 value 를 그대로 옮긴다 (파생 값 · 평균 · 중앙값을 만들지 않는다).
import type { Cell } from '../types.ts';
import type { SectionContentMap } from '../templates/types.ts';
import { markersOf } from '../templates/footnotes.ts';
import type { ValuationRangeSection } from '../model.ts';
import { describeSeries, point, type Ctx } from './helpers.ts';
import { orderScenarios } from './tables.ts';
import type { ChartModel, ChartSeries, RangeItem, WaterfallStep } from './types.ts';

const ids = (cells: Cell[]): string[] => [...new Set(cells.map((c) => c.sourceId).filter((x): x is string => !!x))];

function make(ctx: Ctx, base: Pick<ChartModel, 'id' | 'type' | 'title' | 'categories' | 'series' | 'unit'> & Partial<ChartModel>, cells: Cell[]): ChartModel {
  const sourceIds = ids(cells);
  return { sourceIds, markers: markersOf(ctx.index, sourceIds), accessibleDescription: describeSeries(base.title, base.categories, base.series), ...base };
}

const series = (key: string, label: string, cells: Cell[]): ChartSeries => ({ key, label, kind: cells[0]?.kind ?? 'calculated', unit: cells[0]?.unit ?? 'eok', points: cells.map((c) => point(c)) });
const row = (rows: { key: string; cells: Cell[] }[], key: string) => rows.find((r) => r.key === key);

export function historicalCharts(ctx: Ctx, h: SectionContentMap['historicalPerformance']): ChartModel[] {
  const cats = h.periods.map((p) => p.label);
  const all = [...h.coreRows, ...h.additionalRows];
  const out: ChartModel[] = [];
  const rev = row(all, 'revenue'), op = row(all, 'operatingProfit');
  if (rev && op) out.push(make(ctx, { id: 'chart-historical-revenue-profit', type: 'grouped-bar', title: 'Revenue and Operating Profit (Actual, 억원)', categories: cats, unit: 'eok', series: [series('revenue', 'Revenue', rev.cells), series('operatingProfit', 'Operating Profit', op.cells)] }, [...rev.cells, ...op.cells]));
  const margins = ['operatingMargin', 'netMargin', 'grossMargin'].map((k) => row(all, k)).filter((r): r is NonNullable<typeof r> => !!r);
  if (margins.length > 0) out.push(make(ctx, { id: 'chart-historical-margin', type: 'line', title: 'Margins (Actual-derived, %)', categories: cats, unit: 'ratio', series: margins.map((m) => series(m.key, (all.find((r) => r.key === m.key) as { label: string }).label, m.cells)) }, margins.flatMap((m) => m.cells)));
  return out;
}

export function forecastCharts(ctx: Ctx, f: SectionContentMap['forecast']): ChartModel[] {
  const g = row(f.assumptions, 'revenueGrowth'), m = row(f.assumptions, 'operatingMargin');
  if (!g || !m) return [];
  return [make(ctx, { id: 'chart-forecast-growth-margin', type: 'line', title: 'Forecast Revenue Growth and Operating Margin (Estimate, %)', categories: f.periods.map((p) => p.label), unit: 'ratio', series: [series('revenueGrowth', 'Revenue Growth', g.cells), series('operatingMargin', 'Operating Margin', m.cells)] }, [...g.cells, ...m.cells])];
}

export function dcfCharts(ctx: Ctx, d: SectionContentMap['dcf']): ChartModel[] {
  const fcff = row(d.rows, 'fcff'), pv = row(d.rows, 'pvFcff');
  const out: ChartModel[] = [];
  if (fcff && pv) out.push(make(ctx, { id: 'chart-dcf-fcff-pv', type: 'grouped-bar', title: 'FCFF vs PV of FCFF (Calculated, 억원)', categories: d.periods.map((p) => p.label), unit: 'eok', series: [series('fcff', 'FCFF', fcff.cells), series('pvFcff', 'PV of FCFF', pv.cells)] }, [...fcff.cells, ...pv.cells]));
  // Equity Bridge waterfall: EV → (− Net Debt | + Net Cash) → Equity Value. 연산자를 명시한다.
  const steps: WaterfallStep[] = d.equityBridge.lines.map((l, i) => ({ key: l.key, label: l.label, operator: l.operator, role: i === 0 ? 'start' : l.operator === '=' ? 'total' : 'delta', point: point(l.cell, l.operator === '=' ? 'total' : null) }));
  const cells = d.equityBridge.lines.map((l) => l.cell);
  out.push(make(ctx, {
    id: 'chart-equity-bridge', type: 'waterfall', title: d.equityBridge.kind === 'net-cash' ? 'Equity Bridge (EV + Net Cash = Equity Value, 억원)' : 'Equity Bridge (EV − Net Debt = Equity Value, 억원)',
    categories: steps.map((s) => s.label), unit: 'eok', series: [{ key: 'bridge', label: 'Equity Bridge', kind: 'calculated', unit: 'eok', points: steps.map((s) => s.point) }], waterfall: steps,
    accessibleDescription: `Equity Bridge. ${steps.map((s) => `${s.operator ? `${s.operator} ` : ''}${s.label} ${s.point.text ?? '값 없음'}`).join(' ')}.`,
  }, cells));
  return out;
}

export function sensitivityChart(ctx: Ctx, s: SectionContentMap['sensitivity']): ChartModel {
  const cells = s.rows.flatMap((r) => r.cells.map((c) => c.enterpriseValue));
  return make(ctx, {
    id: 'chart-sensitivity-heatmap', type: 'heatmap', title: 'Enterprise Value Sensitivity (WACC × Terminal Growth, 억원)', categories: s.waccAxis.map((w) => w.text ?? '—'), unit: 'eok', series: [],
    heatmap: { rowLabels: s.rows.map((r) => r.terminalGrowth.text ?? '—'), colLabels: s.waccAxis.map((w) => w.text ?? '—'), cells: s.rows.map((r) => r.cells.map((c) => ({ value: c.enterpriseValue.value, text: c.enterpriseValue.text, flag: !c.valid ? 'invalid' as const : c.isBaseCase ? 'base' as const : null, valid: c.valid, isBaseCase: c.isBaseCase }))) },
    accessibleDescription: `WACC 와 영구성장률 조합별 Enterprise Value ${s.rows.length}×${s.waccAxis.length} 표. 값은 표의 텍스트와 같고 Base case 는 별도 표시된다. ${s.rows.map((r) => `g ${r.terminalGrowth.text}: ${r.cells.map((c) => `${c.wacc.text} → ${c.enterpriseValue.text ?? '값 없음'}${c.isBaseCase ? ' (Base)' : ''}${!c.valid ? ' (invalid)' : ''}`).join(', ')}`).join('. ')}.`,
  }, cells);
}

export function scenarioChart(ctx: Ctx, s: SectionContentMap['scenario']): ChartModel {
  const cols = orderScenarios(s.columns);
  const ev = cols.map((c) => c.enterpriseValue), eq = cols.map((c) => c.equityValue);
  return make(ctx, { id: 'chart-scenario-values', type: 'grouped-bar', title: 'Scenario Values: Enterprise Value and Equity Value (Calculated, 억원)', categories: cols.map((c) => c.label), unit: 'eok', series: [series('enterpriseValue', 'Enterprise Value', ev), series('equityValue', 'Equity Value', eq)] }, [...ev, ...eq]);
}

export function rangeChart(ctx: Ctx, r: ValuationRangeSection): ChartModel {
  const items: RangeItem[] = [{ label: 'Overall (Low · Base · High)', low: point(r.low.equityValue), base: point(r.base.equityValue), high: point(r.high.equityValue) }, ...r.spans.map((s) => ({ label: s.source, low: point(s.low), base: null, high: point(s.high) }))];
  const cells = [r.low.equityValue, r.base.equityValue, r.high.equityValue, ...r.spans.flatMap((s) => [s.low, s.high])];
  return make(ctx, {
    id: 'chart-valuation-range', type: 'range', title: 'Valuation Range (Equity Value, 억원; 평균 · 중앙값 없음)', categories: items.map((i) => i.label), unit: 'eok',
    series: [{ key: 'low', label: 'Low', kind: 'calculated', unit: 'eok', points: items.map((i) => i.low) }, { key: 'high', label: 'High', kind: 'calculated', unit: 'eok', points: items.map((i) => i.high) }], range: items,
    accessibleDescription: `Valuation Range. ${items.map((i) => `${i.label}: ${i.low.text ?? '값 없음'} ~ ${i.high.text ?? '값 없음'}${i.base ? ` (Base ${i.base.text})` : ''}`).join('. ')}.`,
  }, cells);
}
