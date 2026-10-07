// Section Registry: sectionId → "ReportModel 에서 이 section 의 내용을 꺼내는 함수". 데이터를 새로 만들거나 계산하지 않고 모델의 값을 section 구조로 옮긴다.
// (Template 은 순서 · 제목 · 가시성 · 번호만 정하고, 이 registry 는 각 section 이 무엇을 담는지를 정한다.)
import type { ReportModel, TableRow } from '../model.ts';
import { collectSourceIds, sourceEntries, buildFootnoteIndex } from './footnotes.ts';
import type { AppendixContent, MissingDataEntry, ReportTemplate, SectionContentMap, SectionId } from './types.ts';

export const LEARNING_TITLE = 'Learning / Demonstration Data';
export const LEARNING_ASSUMPTION_NOTICE = `${LEARNING_TITLE}: 가정이 STEP 04 학습용 가상값입니다. 이 결과를 해당 기업의 가치평가로 해석하면 안 됩니다.`;
export const LEARNING_HISTORICAL_NOTICE = `${LEARNING_TITLE}: Historical 은 학습용 fixture 이며 실제 공시 조회 결과가 아닙니다.`;

export type Availability = { status: 'ok' } | { status: 'unavailable' | 'not-applicable'; reason: string };
export interface Resolution<K extends SectionId> { availability: Availability; content: SectionContentMap[K] | null; notices: string[] }
export interface ResolveContext { template: ReportTemplate; missingData: MissingDataEntry[] }

const OK: Availability = { status: 'ok' };
const find = (m: ReportModel, id: string) => m.sources.find((s) => s.id === id);
const learningAssumptions = (m: ReportModel) => m.metadata.dataBasis.assumptions === 'learning';
const fixtureHistorical = (m: ReportModel) => m.metadata.dataBasis.historical === 'fixture';
const noticesFor = (m: ReportModel, uses: { assumptions?: boolean; historical?: boolean }): string[] => [
  ...(uses.assumptions && learningAssumptions(m) ? [LEARNING_ASSUMPTION_NOTICE] : []),
  ...(uses.historical && fixtureHistorical(m) ? [LEARNING_HISTORICAL_NOTICE] : []),
];
const ok = <K extends SectionId>(content: SectionContentMap[K], notices: string[] = []): Resolution<K> => ({ availability: OK, content, notices });
const na = <K extends SectionId>(status: 'unavailable' | 'not-applicable', reason: string): Resolution<K> => ({ availability: { status, reason }, content: null, notices: [] });

const CORE_HISTORICAL = ['revenue', 'operatingProfit', 'operatingMargin', 'netIncome', 'cfo', 'capex'];
const TREND_LABEL: Record<string, string> = { revenueGrowth: 'Revenue Growth', grossMargin: 'Gross Margin', operatingMargin: 'Operating Margin', netMargin: 'Net Margin', nwc: 'NWC', cashGeneration: 'Cash Generation (CFO − CAPEX)', depreciation: 'D&A' };
const DIRECTION_LABEL: Record<string, string> = { improving: '개선', deteriorating: '악화', stable: '보합', accelerating: '가속', decelerating: '둔화', increasing: '증가', decreasing: '감소', 'insufficient-data': '데이터 부족', unavailable: '값 없음' };

const pickRows = (rows: TableRow[], keys: string[]) => keys.map((k) => rows.find((r) => r.key === k)).filter((r): r is TableRow => !!r);

export const SECTION_REGISTRY: { [K in SectionId]: (m: ReportModel, ctx: ResolveContext) => Resolution<K> } = {
  cover: (m, ctx) => ok({
    company: m.metadata.company.name, ticker: m.metadata.company.ticker, title: m.metadata.reportTitle,
    subtitle: m.metadata.valuationDate ? `As of ${m.metadata.valuationDate}` : null, valuationDate: m.metadata.valuationDate, createdAt: m.metadata.createdAt,
    currency: m.metadata.currency, monetaryUnit: m.metadata.monetaryUnit, perShareUnit: m.metadata.perShareUnit, reportVersion: { schema: m.schemaVersion, template: ctx.template.version },
  }),

  executiveSummary: (m) => ok(m.executiveSummary, noticesFor(m, { assumptions: true, historical: true })),

  companyOverview: (m) => {
    const o = m.companyOverview;
    const src = find(m, o.historicalSourceId);
    return ok({
      companyName: o.name, corpCode: o.corpCode, stockCode: o.ticker, reportingBasis: o.basis,
      historicalPeriod: o.periods.length > 0 ? `${o.periods[0]!.label} – ${o.periods[o.periods.length - 1]!.label}` : '',
      periods: o.periods, dataSource: { sourceId: o.historicalSourceId, label: src?.label ?? o.historicalSourceId, origin: src?.origin ?? 'unknown' }, dataKind: o.historicalKind,
    });
  },

  historicalPerformance: (m) => {
    const h = m.historicalPerformance;
    const src = find(m, 'src-historical');
    return ok({
      periods: h.periods,
      coreRows: pickRows(h.rows, CORE_HISTORICAL),
      additionalRows: h.rows.filter((r) => !CORE_HISTORICAL.includes(r.key)),
      trendSummary: h.trends.map((t) => ({ key: t.key, label: TREND_LABEL[t.key] ?? t.key, direction: t.direction, directionLabel: DIRECTION_LABEL[t.direction] ?? t.direction, fromPeriod: t.fromPeriod, toPeriod: t.toPeriod })),
      revenueCagr: h.revenueCagr, notes: h.notes, narrative: h.narrative, dataSource: { sourceId: 'src-historical', label: src?.label ?? 'src-historical' },
    }, noticesFor(m, { historical: true }));
  },

  forecast: (m) => {
    const f = m.forecast;
    const src = find(m, 'src-assumptions');
    return ok({ periods: f.periods, assumptions: f.assumptions, projections: f.projections, scalars: f.scalars, basisNote: f.basisNote, narrative: f.narrative, assumptionSource: { sourceId: 'src-assumptions', label: src?.label ?? 'src-assumptions', origin: src?.origin ?? 'unknown' } }, noticesFor(m, { assumptions: true }));
  },

  wacc: (m) => ok({
    inputs: m.wacc.components.filter((c) => c.cell.kind === 'estimate'), derived: m.wacc.components.filter((c) => c.cell.kind === 'calculated'), wacc: m.wacc.wacc, note: m.wacc.note,
  }, noticesFor(m, { assumptions: true })),

  dcf: (m) => ok(m.dcf, noticesFor(m, { assumptions: true })),

  sensitivity: (m) => (m.sensitivity.status === 'ok' ? ok(m.sensitivity.data, noticesFor(m, { assumptions: true })) : na(m.sensitivity.status === 'not-applicable' ? 'not-applicable' : 'unavailable', m.sensitivity.reason)),

  scenario: (m) => (m.scenario.status === 'ok' ? ok(m.scenario.data, noticesFor(m, { assumptions: true })) : na(m.scenario.status === 'not-applicable' ? 'not-applicable' : 'unavailable', m.scenario.reason)),

  relativeValuation: (m) => {
    if (m.relativeValuation.status !== 'ok') return na(m.relativeValuation.status === 'not-applicable' ? 'not-applicable' : 'unavailable', m.relativeValuation.reason);
    const src = find(m, 'src-relative-inputs');
    return ok({
      ...m.relativeValuation.data, inputSource: src ? { sourceId: src.id, label: src.label } : null,
      note: '멀티플 · 이익 기준은 사용자가 입력한 값이며 Peer 데이터 · 평균이 아닙니다. 입력되지 않은 값은 비어 있는 그대로 표시합니다.',
    }, noticesFor(m, { assumptions: true }));
  },

  marketReference: (m) => (m.externalReference.status === 'ok' ? ok(m.externalReference.data) : na(m.externalReference.status === 'not-applicable' ? 'not-applicable' : 'unavailable', m.externalReference.reason)),

  keyRisks: (m) => {
    const k = m.keyRisks;
    return k.items.length > 0 || k.narrative.status === 'ok' ? ok(k) : na('unavailable', '표시할 위험 항목이 없습니다 (엔진 검토 경고 · 데이터 품질 검토 · AI risk claim 없음).');
  },

  conclusion: (m) => ok({ headline: m.executiveSummary.headline, range: m.conclusion.range, narrative: m.conclusion.narrative, disclaimers: m.conclusion.disclaimers }, noticesFor(m, { assumptions: true, historical: true })),

  sources: (m) => ok({ entries: sourceEntries(m.sources, buildFootnoteIndex(m.sources)) }),

  appendix: (m, ctx) => {
    const hist = find(m, 'src-historical');
    const labelOf = (id: string | null) => (id ? find(m, id)?.label ?? id : '-');
    const content: AppendixContent = {
      dataQuality: m.appendix.dataQualityNotes,
      provenance: hist ? { sourceId: hist.id, label: hist.label, origin: hist.origin, basis: hist.basis, asOf: hist.asOf, kind: m.metadata.dataBasis.historical } : null,
      missingData: ctx.missingData,
      validationWarnings: m.appendix.validation.warnings,
      assumptionSources: m.appendix.inputAssumptions.map((a) => ({ key: a.key, label: a.label, cell: a.cell, sourceLabel: labelOf(a.cell.sourceId) })),
      unitPolicy: m.appendix.unitPolicy, kindLegend: m.appendix.kindLegend, narrativeRejected: m.appendix.narrativeRejected, narrativeOmitted: m.appendix.narrativeOmitted,
      technical: { schemaVersion: m.schemaVersion, templateId: ctx.template.id, templateVersion: ctx.template.version, reportId: m.metadata.reportId, inputHash: m.metadata.snapshot.inputHash, contextSnapshotId: m.metadata.snapshot.contextSnapshotId, valuationSnapshotId: m.metadata.snapshot.valuationSnapshotId },
    };
    return ok(content);
  },
};

// ---- 공통 helper ----
/** content 안의 Cell 중 ok 가 아닌 것을 (가장 가까운 label 과 함께) 모은다. */
export function collectMissing(sectionId: SectionId, content: unknown): MissingDataEntry[] {
  const out: MissingDataEntry[] = [];
  const walk = (o: unknown, label: string): void => {
    if (Array.isArray(o)) { o.forEach((x) => walk(x, label)); return; }
    if (!o || typeof o !== 'object') return;
    const r = o as Record<string, unknown>;
    if (typeof r.state === 'string' && typeof r.unit === 'string' && 'sourceId' in r) {
      if (r.state !== 'ok') out.push({ sectionId, label, state: r.state as MissingDataEntry['state'], reason: (r.reason as string | null) ?? null });
      return;
    }
    const here = typeof r.label === 'string' ? r.label : label;
    for (const v of Object.values(r)) walk(v, here);
  };
  walk(content, sectionId);
  return out;
}

export { collectSourceIds };
