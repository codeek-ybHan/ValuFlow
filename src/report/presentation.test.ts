// STEP 09-3: Tables & Charts — Renderer 와 무관한 TableModel / ChartModel. 숫자를 계산하지 않고 ReportModel Cell 을 그대로 옮긴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildPresentation, buildReport, buildReportDocument, buildReportInput, type ReportInput } from './index.ts';
import { buildScenario } from '../ai/eval/scenarios.ts';
import type { ReportModel } from './model.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const NOW = () => new Date('2026-10-08T01:02:03Z');
const inputOf = (p = structuredClone(buildScenario('full', golden).project)): ReportInput => buildReportInput(p, { now: NOW });
const modelOf = (i: ReportInput): ReportModel => { const r = buildReport(i); assert.equal(r.status, 'ok'); return r.model!; };
const pres = (m: ReportModel = modelOf(inputOf())) => ({ m, doc: buildReportDocument(m), p: buildPresentation(buildReportDocument(m)) });
const values = (o: unknown, out: number[] = []): number[] => { if (Array.isArray(o)) o.forEach((x) => values(x, out)); else if (o && typeof o === 'object') { const r = o as Record<string, unknown>; if (typeof r.state === 'string' && 'sourceId' in r) { if (r.state === 'ok') out.push(r.value as number); } else Object.values(r).forEach((v) => values(v, out)); } return out; };

test('KPI: Enterprise Value · Equity · 주당 · WACC · Terminal Growth (원본 값 · 표시 문자열 · kind 유지)', () => {
  const { m, p } = pres();
  assert.deepEqual(p.kpis.map((k) => k.key), ['enterpriseValue', 'equityValue', 'perShareValue', 'wacc', 'terminalGrowth']);
  const h = m.executiveSummary.headline;
  assert.deepEqual(p.kpis.map((k) => [k.cell.value, k.cell.text]), [h.enterpriseValue, h.equityValue, h.perShareValue, h.wacc, h.terminalGrowth].map((c) => [c.value, c.text]));
  assert.deepEqual(p.kpis.map((k) => k.cell.kind), ['calculated', 'calculated', 'calculated', 'calculated', 'estimate']);
  assert.ok(p.kpis.every((k) => k.cell.markers.length > 0 && /^S\d+$/.test(k.cell.markers[0]!)));
});

test('Historical: 표 6행(Actual · 2023A–2025A · 출처 marker) + Revenue/Operating Profit · Margin 차트', () => {
  const { m, p } = pres();
  const t = p.tables['historical-core']!;
  assert.deepEqual(t.columns.map((c) => c.label), ['항목', '2023A', '2024A', '2025A']);
  assert.deepEqual(t.rows.map((r) => r.key), ['revenue', 'operatingProfit', 'operatingMargin', 'netIncome', 'cfo', 'capex']);
  assert.ok(t.rows[0]!.cells.every((c) => c.kind === 'actual' && c.markers[0] === 'S1'));
  assert.deepEqual(t.columns.slice(1).map((c) => c.kind), ['actual', 'actual', 'actual']);
  assert.deepEqual(t.markers, ['S1']);
  const rev = m.historicalPerformance.rows.find((r) => r.key === 'revenue')!;
  assert.deepEqual(t.rows[0]!.cells.map((c) => [c.value, c.text]), rev.cells.map((c) => [c.value, c.text]), '표는 모델의 Cell 을 그대로 옮긴다');
  const c1 = p.charts['chart-historical-revenue-profit']!;
  assert.deepEqual([c1.type, c1.unit, c1.categories, c1.series.map((s) => s.key)], ['grouped-bar', 'eok', ['2023A', '2024A', '2025A'], ['revenue', 'operatingProfit']]);
  assert.deepEqual(c1.series[0]!.points.map((x) => x.value), rev.cells.map((c) => c.value));
  const c2 = p.charts['chart-historical-margin']!;
  assert.deepEqual([c2.type, c2.unit], ['line', 'ratio']);
  assert.ok(c2.series.some((s) => s.key === 'operatingMargin'));
  assert.ok(c2.series[0]!.points[0]!.state === 'not-applicable' || c2.series[0]!.points[0]!.value !== null);
  assert.ok(p.tables['historical-additional']!.rows.some((r) => r.key === 'depreciation' && r.cells[0]!.state === 'unavailable' && r.cells[0]!.text === null && r.cells[0]!.reason), '값이 없는 셀은 state · reason 을 유지한다');
});

test('Forecast: 가정 표(Estimate) · Tax Rate · 투영 · 차트', () => {
  const { p } = pres();
  const t = p.tables['forecast-assumptions']!;
  assert.deepEqual(t.rows.map((r) => r.key), ['revenueGrowth', 'operatingMargin', 'depreciation', 'capex', 'deltaNwc']);
  assert.ok(t.columns.slice(1).every((c) => c.kind === 'estimate' && /^20\d\dE$/.test(c.label)));
  assert.ok(t.rows.every((r) => r.kind === 'estimate'));
  assert.ok(p.tables['forecast-scalars']!.rows.some((r) => r.key === 'taxRate' && r.cells[0]!.kind === 'estimate'));
  assert.deepEqual(p.tables['forecast-projections']!.rows.map((r) => r.key), ['revenue', 'ebit']);
  const ch = p.charts['chart-forecast-growth-margin']!;
  assert.deepEqual([ch.type, ch.series.map((s) => s.kind)], ['line', ['estimate', 'estimate']]);
});

test('WACC: Inputs 와 Calculated 를 분리하고 WACC 는 결과 표의 total', () => {
  const { p } = pres();
  assert.deepEqual(p.tables['wacc-inputs']!.rows.map((r) => r.key), ['riskFreeRate', 'beta', 'marketRiskPremium', 'preTaxCostOfDebt', 'taxRate', 'equityWeight', 'debtWeight']);
  assert.deepEqual(p.tables['wacc-calculated']!.rows.map((r) => r.key), ['costOfEquity', 'afterTaxCostOfDebt', 'wacc']);
  assert.equal(p.tables['wacc-calculated']!.rows[2]!.cells[0]!.flag, 'total');
  assert.ok(!p.tables['wacc-inputs']!.rows.some((r) => r.key === 'wacc'));
  // 자본 가중치는 시장가치 입력에서 엔진이 계산한 값이라 kind 가 Calculated 로 남는다
  assert.equal(p.tables['wacc-inputs']!.rows.find((r) => r.key === 'equityWeight')!.kind, 'calculated');
  assert.equal(p.tables['wacc-inputs']!.rows.find((r) => r.key === 'beta')!.cells[0]!.unit, 'factor');
});

test('DCF: 9행 표 · Terminal 블록 · FCFF vs PV 차트', () => {
  const { m, p } = pres();
  const t = p.tables['dcf-projection']!;
  assert.deepEqual(t.rows.map((r) => r.key), ['revenue', 'ebit', 'nopat', 'depreciation', 'capex', 'deltaNwc', 'fcff', 'discountFactor', 'pvFcff']);
  assert.ok(t.columns.slice(1).every((c) => c.kind === 'estimate'));
  const term = p.tables['dcf-terminal']!;
  assert.deepEqual(term.rows.map((r) => r.key), ['terminalGrowth', 'terminalFcff', 'terminalValue', 'pvTerminalValue', 'tvContribution', 'enterpriseValue']);
  assert.equal(term.rows.at(-1)!.cells[0]!.flag, 'total');
  const c = p.charts['chart-dcf-fcff-pv']!;
  assert.deepEqual([c.type, c.series.map((s) => s.key)], ['grouped-bar', ['fcff', 'pvFcff']]);
  assert.deepEqual(c.series[0]!.points.map((x) => x.value), m.dcf.rows.find((r) => r.key === 'fcff')!.cells.map((x) => x.value));
});

test('Equity Bridge: waterfall contract — 순부채는 −, 순현금은 +, 마지막은 Equity Value', () => {
  const { m, p } = pres();
  const w = p.charts['chart-equity-bridge']!;
  assert.equal(w.type, 'waterfall');
  assert.deepEqual(w.waterfall!.map((s) => [s.key, s.operator, s.role]), [['enterpriseValue', null, 'start'], ['netDebt', '-', 'delta'], ['equityValue', '=', 'total']]);
  assert.match(w.title, /EV − Net Debt = Equity Value/);
  assert.deepEqual(p.tables['equity-bridge']!.rows.map((r) => r.operator), [null, '-', '=', undefined, undefined].slice(0, 3).concat([undefined, undefined]));
  assert.equal(w.waterfall![2]!.point.value, m.dcf.equityBridge.lines[2]!.cell.value);
  // 순현금
  const input = structuredClone(inputOf());
  input.valuationResult!.netDebt = -150; input.valuationResult!.equityValue = input.valuationResult!.enterpriseValue + 150;
  const nc = pres(modelOf(input)).p;
  assert.deepEqual(nc.charts['chart-equity-bridge']!.waterfall!.map((s) => [s.key, s.operator]), [['enterpriseValue', null], ['netCash', '+'], ['equityValue', '=']]);
  assert.match(nc.charts['chart-equity-bridge']!.title, /EV \+ Net Cash/);
  assert.equal(nc.charts['chart-equity-bridge']!.waterfall![1]!.point.value, 150);
  assert.match(nc.charts['chart-equity-bridge']!.accessibleDescription, /\+ Net Cash 150/);
});

test('Sensitivity: 5×5 heatmap contract — valid · isBaseCase · 텍스트, 색에 의미를 두지 않는다', () => {
  const { m, p } = pres();
  const h = p.charts['chart-sensitivity-heatmap']!;
  assert.equal(h.type, 'heatmap');
  assert.deepEqual([h.heatmap!.rowLabels.length, h.heatmap!.colLabels.length, h.heatmap!.cells.flat().length], [5, 5, 25]);
  assert.ok(h.heatmap!.cells.flat().every((c) => c.text !== null && c.valid));
  assert.equal(h.heatmap!.cells.flat().filter((c) => c.isBaseCase).length, 1);
  assert.equal(h.heatmap!.cells.flat().filter((c) => c.flag === 'base').length, 1);
  assert.ok(!JSON.stringify(h).match(/#[0-9a-f]{3,6}|rgb\(|color/i), 'chart model 에는 색상 값이 없다');
  assert.match(h.accessibleDescription, /Base/);
  const base = m.sensitivity.status === 'ok' ? m.sensitivity.data.rows.flatMap((r) => r.cells).find((c) => c.isBaseCase)! : null;
  assert.equal(h.heatmap!.cells.flat().find((c) => c.isBaseCase)!.value, base!.enterpriseValue.value);
  const ev = p.tables['sensitivity-ev']!;
  assert.deepEqual([ev.columns.length, ev.rows.length], [6, 5]);
  assert.equal(ev.rows.flatMap((r) => r.cells).filter((c) => c.flag === 'base').length, 1);
  assert.ok(p.tables['sensitivity-pershare']!.rows.flatMap((r) => r.cells).every((c) => c.unit === 'won'));
  // invalid(WACC <= g) 조합은 flag 로 구분되고 값은 비어 있어도 된다
  const bad = structuredClone(m);
  const data = (bad.sensitivity as { data: { rows: { cells: { valid: boolean }[] }[] } }).data;
  data.rows[0]!.cells[0]!.valid = false;
  const q = buildPresentation(buildReportDocument(bad));
  assert.equal(q.charts['chart-sensitivity-heatmap']!.heatmap!.cells[0]![0]!.flag, 'invalid');
  assert.equal(q.tables['sensitivity-ev']!.rows[0]!.cells[0]!.flag, 'invalid');
});

test('Scenario: Bear → Base → Bull 고정 순서(엔진 순서와 무관) · 표 + 값 비교 차트', () => {
  const m = structuredClone(modelOf(inputOf()));
  const cols = (m.scenario as { data: { columns: { id: string }[] } }).data.columns;
  cols.reverse();   // 엔진이 다른 순서로 돌려줘도
  assert.deepEqual(cols.map((c) => c.id), ['bull', 'base', 'bear']);
  const p = buildPresentation(buildReportDocument(m));
  const t = p.tables['scenario-comparison']!;
  assert.deepEqual(t.columns.map((c) => c.label), ['항목', 'Bear', 'Base', 'Bull']);
  assert.ok(t.rows.some((r) => r.key === 'growth0') && t.rows.some((r) => r.key === 'margin0') && t.rows.some((r) => r.key === 'wacc'));
  assert.match(t.rows.find((r) => r.key === 'growth0')!.label, /Revenue Growth 2026E/);
  const c = p.charts['chart-scenario-values']!;
  assert.deepEqual([c.categories, c.series.map((s) => s.key)], [['Bear', 'Base', 'Bull'], ['enterpriseValue', 'equityValue']]);
  assert.ok(c.series[1]!.points[0]!.value! < c.series[1]!.points[2]!.value!);
});

test('Relative: 입력된 값만, missing 은 그대로, 평균 · 중앙값 없음', () => {
  const p0 = structuredClone(buildScenario('full', golden).project);
  const { p } = pres(modelOf(inputOf({ ...p0, relativeInputs: { netIncome: 150, per: 12 } })));
  const t = p.tables['relative-methods']!;
  assert.deepEqual(t.rows.map((r) => r.key), ['DCF', 'PER', 'PBR', 'EV/EBITDA']);
  const pbr = t.rows.find((r) => r.key === 'PBR')!;
  assert.ok(pbr.cells.every((c) => c.state === 'unavailable' && c.value === null && c.text === null));
  assert.ok(!JSON.stringify(t).match(/average|mean|median|평균|중앙/));
  assert.deepEqual(p.tables['relative-inputs']!.rows.map((r) => r.key).sort(), ['netIncome', 'per']);
});

test('Valuation Range: Low / Base / High 와 방법별 범위만 — 새 midpoint 없음', () => {
  const { m, p } = pres();
  const range = (m.conclusion.range as { status: 'ok'; data: { low: { equityValue: { value: number } }; base: { equityValue: { value: number } }; high: { equityValue: { value: number } } } }).data;
  const t = p.tables['valuation-range']!;
  assert.deepEqual(t.rows.map((r) => r.key), ['low', 'base', 'high']);
  assert.deepEqual(t.rows.map((r) => r.cells[0]!.value), [range.low.equityValue.value, range.base.equityValue.value, range.high.equityValue.value]);
  const c = p.charts['chart-valuation-range']!;
  assert.equal(c.type, 'range');
  assert.deepEqual([c.range![0]!.low.value, c.range![0]!.base!.value, c.range![0]!.high.value], t.rows.map((r) => r.cells[0]!.value));
  assert.ok(c.range!.slice(1).every((r) => r.base === null), '방법별 범위에는 Base 가 없다');
});

test('No recalculation: 표 · 차트의 모든 숫자는 ReportModel 에 있던 값이고 presentation 코드에 계산 함수가 없다', () => {
  const { m, p } = pres();
  const modelVals = new Set(values(m));
  const presVals: number[] = [];
  for (const t of Object.values(p.tables)) for (const r of t.rows) for (const c of r.cells) if (c.state === 'ok') presVals.push(c.value!);
  for (const c of Object.values(p.charts)) {
    for (const s of c.series) for (const x of s.points) if (x.state === 'ok') presVals.push(x.value!);
    for (const s of c.waterfall ?? []) if (s.point.state === 'ok') presVals.push(s.point.value!);
    for (const row of c.heatmap?.cells ?? []) for (const x of row) if (x.value !== null) presVals.push(x.value);
  }
  for (const k of p.kpis) presVals.push(k.cell.value!);
  assert.ok(presVals.length > 150);
  const foreign = presVals.filter((v) => !modelVals.has(v));
  assert.deepEqual(foreign, [], '모델에 없던 숫자가 있다');
  const FORBIDDEN = /\b(runValuation|runSensitivity|runScenarios?|calculateWacc|calculateRelativeValuation|analyzeHistorical|buildValidationView|Math\.(sum|max|min)|reduce\()/;
  const dir = new URL('./presentation/', import.meta.url).pathname;
  for (const f of readdirSync(dir)) assert.ok(!FORBIDDEN.test(readFileSync(`${dir}${f}`, 'utf8').replace(/\/\/.*$/gm, '')), `${f} 에 계산이 있다`);
});

test('접근성 · 독립성: 모든 차트에 설명이 있고 JSON 직렬화가 가능하며 같은 입력이면 같은 결과', () => {
  const { p, doc } = pres();
  for (const c of Object.values(p.charts)) assert.ok(c.accessibleDescription.length > 20 && c.title && c.sourceIds.length > 0, c.id);
  assert.ok(Object.values(p.charts).every((c) => ['line', 'bar', 'grouped-bar', 'stacked-bar', 'waterfall', 'heatmap', 'range'].includes(c.type)));
  assert.equal(JSON.stringify(buildPresentation(doc)), JSON.stringify(p));
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
  assert.deepEqual(Object.keys(p.bySection).sort(), ['conclusion', 'dcf', 'forecast', 'historicalPerformance', 'relativeValuation', 'scenario', 'sensitivity', 'wacc']);
  assert.match(p.charts['chart-historical-revenue-profit']!.accessibleDescription, /2025A/);
});
