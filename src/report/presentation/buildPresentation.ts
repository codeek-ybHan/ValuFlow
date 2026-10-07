// ReportDocument → Presentation (TableModel / ChartModel / KPI). Renderer(HTML · PDF)와 UI 가 같은 Presentation 을 쓴다.
import type { ReportDocument } from '../templates/types.ts';
import { dcfCharts, forecastCharts, historicalCharts, rangeChart, scenarioChart, sensitivityChart } from './charts.ts';
import { pcell, sectionOf, type Ctx } from './helpers.ts';
import { dcfTables, forecastTables, historicalTables, marketReferenceTable, rangeTable, relativeTables, scenarioTable, sensitivityTables, waccTables } from './tables.ts';
import type { ChartModel, KpiModel, Presentation, TableModel } from './types.ts';

export function buildPresentation(doc: ReportDocument): Presentation {
  const ctx: Ctx = { index: doc.footnoteIndex };
  const tables: Record<string, TableModel> = {};
  const charts: Record<string, ChartModel> = {};
  const bySection: Presentation['bySection'] = {};
  const add = (section: string, t: TableModel[], c: ChartModel[]) => {
    for (const x of t) tables[x.id] = x;
    for (const x of c) charts[x.id] = x;
    bySection[section] = { tables: [...(bySection[section]?.tables ?? []), ...t.map((x) => x.id)], charts: [...(bySection[section]?.charts ?? []), ...c.map((x) => x.id)] };
  };

  const es = sectionOf(doc, 'executiveSummary');
  const kpis: KpiModel[] = [];
  if (es?.content) {
    const h = (es.content as { headline: Record<string, Parameters<typeof pcell>[1]> }).headline;
    for (const [key, label] of [['enterpriseValue', 'Enterprise Value'], ['equityValue', 'Equity Value'], ['perShareValue', 'Value per Share'], ['wacc', 'WACC'], ['terminalGrowth', 'Terminal Growth']] as const) kpis.push({ key, label, cell: pcell(ctx, h[key]!) });
  }

  const hist = sectionOf(doc, 'historicalPerformance');
  if (hist?.content) add('historicalPerformance', historicalTables(ctx, hist.content as never, hist.notices), historicalCharts(ctx, hist.content as never));
  const fc = sectionOf(doc, 'forecast');
  if (fc?.content) add('forecast', forecastTables(ctx, fc.content as never, fc.notices), forecastCharts(ctx, fc.content as never));
  const w = sectionOf(doc, 'wacc');
  if (w?.content) add('wacc', waccTables(ctx, w.content as never, w.notices), []);
  const d = sectionOf(doc, 'dcf');
  if (d?.content) add('dcf', dcfTables(ctx, d.content as never, d.notices), dcfCharts(ctx, d.content as never));
  const s = sectionOf(doc, 'sensitivity');
  if (s?.content) add('sensitivity', sensitivityTables(ctx, s.content as never, s.notices), [sensitivityChart(ctx, s.content as never)]);
  const sc = sectionOf(doc, 'scenario');
  if (sc?.content) {
    const periods = ((fc?.content as { periods?: { label: string }[] } | null)?.periods ?? []).map((p) => p.label);
    add('scenario', [scenarioTable(ctx, sc.content as never, periods, sc.notices)], [scenarioChart(ctx, sc.content as never)]);
  }
  const rel = sectionOf(doc, 'relativeValuation');
  if (rel?.content) add('relativeValuation', relativeTables(ctx, rel.content as never, rel.notices), []);
  const mr = sectionOf(doc, 'marketReference');
  if (mr?.content) add('marketReference', [marketReferenceTable(ctx, mr.content as never, mr.notices)], []);
  const conc = sectionOf(doc, 'conclusion');
  const range = (conc?.content as { range?: { status: string; data?: never } } | null)?.range;
  if (conc?.content && range?.status === 'ok') add('conclusion', [rangeTable(ctx, range.data!)], [rangeChart(ctx, range.data!)]);

  return { version: '1.0', kpis, tables, charts, bySection };
}
