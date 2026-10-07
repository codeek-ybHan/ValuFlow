// TableModel 빌더: 각 section 의 content(Cell 표)를 표 구조로 옮긴다. 값은 그대로이고 계산하지 않는다.
import type { ValuationRangeSection } from '../model.ts';
import type { Cell } from '../types.ts';
import type { SectionContentMap } from '../templates/types.ts';
import { labelColumn, pcell, periodColumns, rowKind, tableOf, valueRow, type Ctx } from './helpers.ts';
import type { TableColumn, TableModel, TableRowModel } from './types.ts';

const kvColumns: TableColumn[] = [labelColumn(), { key: 'value', label: '값', align: 'right', kind: null }];

/** 항목 목록(key · label · Cell) → key-value 표 */
export function keyValueTable(ctx: Ctx, id: string, title: string, items: { key: string; label: string; cell: Cell }[], opts: { totalKey?: string; notices?: string[] } = {}): TableModel {
  const rows: TableRowModel[] = items.map((i) => valueRow(ctx, i.key, i.label, [i.cell], null, i.key === opts.totalKey));
  return tableOf(ctx, id, title, kvColumns, rows, opts.notices ?? []);
}

export function historicalTables(ctx: Ctx, h: SectionContentMap['historicalPerformance'], notices: string[]): TableModel[] {
  const cols = [labelColumn(), ...periodColumns(h.periods)];
  const out = [tableOf(ctx, 'historical-core', 'Historical Financial Performance (Actual)', cols, h.coreRows.map((r) => valueRow(ctx, r.key, r.label, r.cells, r.note)), notices)];
  if (h.additionalRows.length > 0) out.push(tableOf(ctx, 'historical-additional', 'Additional Historical Metrics', cols, h.additionalRows.map((r) => valueRow(ctx, r.key, r.label, r.cells, r.note))));
  return out;
}

export function forecastTables(ctx: Ctx, f: SectionContentMap['forecast'], notices: string[]): TableModel[] {
  const cols = [labelColumn(), ...periodColumns(f.periods)];
  return [
    tableOf(ctx, 'forecast-assumptions', 'Forecast Assumptions (Estimate)', cols, f.assumptions.map((r) => valueRow(ctx, r.key, r.label, r.cells, r.note)), notices),
    tableOf(ctx, 'forecast-projections', 'Projected Revenue and EBIT (Estimate)', cols, f.projections.map((r) => valueRow(ctx, r.key, r.label, r.cells, r.note))),
    keyValueTable(ctx, 'forecast-scalars', 'Other Assumptions', f.scalars),
  ];
}

/** WACC: 입력(Inputs)과 계산 결과(Calculated)를 분리한다. 자본 가중치는 시장가치 입력에서 엔진이 계산한 값이라 Inputs 표에 두되 kind(Calculated)를 그대로 표시한다. */
export function waccTables(ctx: Ctx, w: SectionContentMap['wacc'], notices: string[]): TableModel[] {
  const all = [...w.inputs, ...w.derived];
  const by = (keys: string[]) => keys.map((k) => all.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c);
  return [
    keyValueTable(ctx, 'wacc-inputs', 'WACC Inputs', by(['riskFreeRate', 'beta', 'marketRiskPremium', 'preTaxCostOfDebt', 'taxRate', 'equityWeight', 'debtWeight']), { notices }),
    keyValueTable(ctx, 'wacc-calculated', 'WACC Calculated', [...by(['costOfEquity', 'afterTaxCostOfDebt']), { key: 'wacc', label: 'WACC', cell: w.wacc }], { totalKey: 'wacc' }),
  ];
}

const DCF_ORDER = ['revenue', 'ebit', 'nopat', 'depreciation', 'capex', 'deltaNwc', 'fcff', 'discountFactor', 'pvFcff'];

export function dcfTables(ctx: Ctx, d: SectionContentMap['dcf'], notices: string[]): TableModel[] {
  const cols = [labelColumn(), ...periodColumns(d.periods)];
  const rows = DCF_ORDER.map((k) => d.rows.find((r) => r.key === k)).filter((r): r is NonNullable<typeof r> => !!r);
  const bridgeRows: TableRowModel[] = d.equityBridge.lines.map((l) => ({ ...valueRow(ctx, l.key, l.label, [l.cell], null, l.operator === '='), operator: l.operator }));
  bridgeRows.push(valueRow(ctx, 'sharesOutstanding', 'Shares Outstanding', [d.equityBridge.sharesOutstanding]), valueRow(ctx, 'perShareValue', 'Value per Share', [d.equityBridge.perShareValue], null, true));
  return [
    tableOf(ctx, 'dcf-projection', 'DCF Projection', cols, rows.map((r) => valueRow(ctx, r.key, r.label, r.cells, r.note)), notices),
    keyValueTable(ctx, 'dcf-terminal', 'Terminal Value', [...d.terminal, { key: 'tvContribution', label: 'PV(TV) / EV', cell: d.tvContribution }, { key: 'enterpriseValue', label: 'Enterprise Value', cell: d.bridge.find((b) => b.key === 'enterpriseValue')!.cell }], { totalKey: 'enterpriseValue' }),
    tableOf(ctx, 'equity-bridge', d.equityBridge.kind === 'net-cash' ? 'Equity Bridge (EV + Net Cash = Equity Value)' : 'Equity Bridge (EV − Net Debt = Equity Value)', kvColumns, bridgeRows),
  ];
}

/** 5×5 matrix(행 = Terminal Growth, 열 = WACC) 표. 두 표: Enterprise Value · 주당 가치. Base cell 은 flag 로만 표시한다. */
export function sensitivityTables(ctx: Ctx, s: SectionContentMap['sensitivity'], notices: string[]): TableModel[] {
  const cols: TableColumn[] = [{ key: 'g', label: 'g \\ WACC', align: 'left', kind: null }, ...s.waccAxis.map((w, i) => ({ key: `w${i}`, label: w.text ?? '—', align: 'right' as const, kind: 'estimate' as const }))];
  const make = (id: string, title: string, pick: 'enterpriseValue' | 'perShareValue'): TableModel => tableOf(ctx, id, title, cols, s.rows.map((r, i) => ({
    key: `g${i}`, label: r.terminalGrowth.text ?? '—', note: null, kind: 'calculated' as const,
    cells: r.cells.map((c) => pcell(ctx, c[pick], !c.valid ? 'invalid' : c.isBaseCase ? 'base' : null)),
  })), id === 'sensitivity-ev' ? notices : []);
  return [make('sensitivity-ev', 'Sensitivity — Enterprise Value (억원)', 'enterpriseValue'), make('sensitivity-pershare', 'Sensitivity — Value per Share (원)', 'perShareValue')];
}

export const SCENARIO_ORDER = ['bear', 'base', 'bull'];
const rank = (id: string) => { const i = SCENARIO_ORDER.indexOf(id); return i < 0 ? 99 : i; };
/** Bear → Base → Bull 고정 순서 (엔진이 돌려준 순서에 의존하지 않는다) */
export const orderScenarios = <T extends { id: string }>(cols: T[]): T[] => [...cols].sort((a, b) => rank(a.id) - rank(b.id));

export function scenarioTable(ctx: Ctx, s: SectionContentMap['scenario'], periods: string[], notices: string[]): TableModel {
  const cols = orderScenarios(s.columns);
  const columns: TableColumn[] = [labelColumn(), ...cols.map((c) => ({ key: c.id, label: c.label, align: 'right' as const, kind: null }))];
  const n = cols[0]?.assumptions.revenueGrowth.length ?? 0;   // 연도 수 (모든 시나리오가 같은 기간을 쓴다)
  const growth: TableRowModel[] = Array.from({ length: n }, (_, i) => ({ key: `growth${i}`, label: `Revenue Growth ${periods[i] ?? `Y${i + 1}E`}`, note: null, kind: 'estimate' as const, cells: cols.map((c) => pcell(ctx, c.assumptions.revenueGrowth[i]!)) }));
  const margin: TableRowModel[] = Array.from({ length: n }, (_, i) => ({ key: `margin${i}`, label: `Operating Margin ${periods[i] ?? `Y${i + 1}E`}`, note: null, kind: 'estimate' as const, cells: cols.map((c) => pcell(ctx, c.assumptions.operatingMargin[i]!)) }));
  const one = (key: string, label: string, pick: (c: (typeof cols)[number]) => Cell, total = false): TableRowModel => ({ key, label, note: null, kind: rowKind(cols.map(pick)), cells: cols.map((c) => pcell(ctx, pick(c), total ? 'total' : null)) });
  return tableOf(ctx, 'scenario-comparison', 'Scenario Comparison (Bear → Base → Bull)', columns, [
    ...growth, ...margin, one('mrp', 'Market Risk Premium', (c) => c.assumptions.marketRiskPremium), one('g', 'Terminal Growth (g)', (c) => c.assumptions.terminalGrowth),
    one('wacc', 'WACC', (c) => c.wacc), one('ev', 'Enterprise Value', (c) => c.enterpriseValue, true), one('equity', 'Equity Value', (c) => c.equityValue, true), one('perShare', 'Value per Share', (c) => c.perShareValue, true),
  ], notices);
}

export function relativeTables(ctx: Ctx, r: SectionContentMap['relativeValuation'], notices: string[]): TableModel[] {
  const cols: TableColumn[] = [labelColumn('방법'), { key: 'ev', label: 'Enterprise Value', align: 'right', kind: 'calculated' }, { key: 'equity', label: 'Equity Value', align: 'right', kind: 'calculated' }, { key: 'ps', label: 'Value per Share', align: 'right', kind: 'calculated' }];
  const rows: TableRowModel[] = r.rows.map((x) => ({ key: x.method, label: `${x.method}${x.evDerived ? ' (EV 환산 참고값)' : ''}`, note: x.message, kind: 'calculated' as const, cells: [pcell(ctx, x.enterpriseValue), pcell(ctx, x.equityValue), pcell(ctx, x.perShareValue)] }));
  return [tableOf(ctx, 'relative-methods', 'Relative Valuation', cols, rows, notices), keyValueTable(ctx, 'relative-inputs', 'Relative Valuation Inputs (user-input)', r.inputs)];
}

export function rangeTable(ctx: Ctx, range: ValuationRangeSection): TableModel {
  const cols: TableColumn[] = [labelColumn(), { key: 'equity', label: 'Equity Value', align: 'right', kind: 'calculated' }, { key: 'ps', label: 'Value per Share', align: 'right', kind: 'calculated' }];
  const row = (key: string, label: string, p: { label: string; equityValue: Cell; perShareValue: Cell }, total = false): TableRowModel => ({ key, label: `${label} (${p.label})`, note: null, kind: 'calculated', cells: [pcell(ctx, p.equityValue, total ? 'total' : null), pcell(ctx, p.perShareValue)] });
  return tableOf(ctx, 'valuation-range', 'Valuation Range (평균 · 중앙값 없음)', cols, [row('low', 'Low', range.low), row('base', 'Base', range.base, true), row('high', 'High', range.high)]);
}

export function marketReferenceTable(ctx: Ctx, r: SectionContentMap['marketReference'], notices: string[] = []): TableModel {
  const rows: TableRowModel[] = r.items.map((i) => ({
    key: i.key, label: `${i.group === 'peer' ? 'Peer' : 'Market'} · ${i.label}`, kind: 'reference' as const,
    note: [i.toolLabel, `as of ${i.asOf ? i.asOf.slice(0, 10) : '-'}`, i.providerLabel, i.development ? 'Development Source' : null].filter(Boolean).join(' · '),
    cells: [pcell(ctx, i.cell)],
  }));
  return tableOf(ctx, 'market-reference', 'Market & Peer Reference (참고값 · Valuation 미사용)', kvColumns, rows, [r.notice, ...notices]);
}
