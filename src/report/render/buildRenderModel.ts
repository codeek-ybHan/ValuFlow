// ReportDocument + Presentation → RenderModel. 값은 그대로 옮기고 계산하지 않는다 (표시 문자열은 Cell.text).
import type { Presentation, PCell, TableModel } from '../presentation/types.ts';
import { markersOf } from '../templates/footnotes.ts';
import type { ReportDocument, ResolvedSection, SectionContentMap, SectionId } from '../templates/types.ts';
import type { Cell, DataKind, Narrative, SectionState } from '../types.ts';
import { RENDER_MODEL_VERSION, type RCell, type RenderBlock, type RenderModel, type RKv, type RNarrativeItem, type RRow } from './types.ts';

const KIND_LABEL: Record<DataKind, string> = { actual: 'Actual', estimate: 'Estimate', calculated: 'Calculated', reference: 'Reference' };
const CONF: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const TYPE_LABEL: Record<string, string> = { fact: 'Fact', calculation: 'Calculation', interpretation: 'Interpretation', risk: 'Risk', recommendation: 'Consideration' };

const rc = (c: PCell): RCell => ({ text: c.state === 'ok' ? c.text : null, alt: c.state === 'ok' ? c.altText : null, reason: c.state === 'ok' ? null : c.reason, markers: c.markers, flag: c.flag });
const plainCell = (index: Record<string, string>, c: Cell): RCell => ({ text: c.state === 'ok' ? c.text : null, alt: c.state === 'ok' ? c.largeText : null, reason: c.state === 'ok' ? null : c.reason, markers: markersOf(index, c.sourceId), flag: null });

export const reportFilename = (company: string, valuationDate: string | null, createdAt: string, ext = 'pdf'): string =>
  `ValuFlow_${company.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'Company'}_Valuation_${(valuationDate ?? createdAt).slice(0, 10)}.${ext}`;

/** 같은 항목이 여러 기간에서 비어 있으면 한 줄로 묶는다 (예: D&A × 3개 기간). */
function collapseMissing(list: { sectionId: SectionId; label: string; state: string; reason: string | null }[], titleOf: (id: SectionId) => string): { label: string; state: string; reason: string | null }[] {
  const groups = new Map<string, { label: string; state: string; reason: string | null; n: number }>();
  for (const m of list) {
    const key = `${m.sectionId}|${m.label}|${m.state}|${m.reason}`;
    const g = groups.get(key);
    if (g) g.n += 1; else groups.set(key, { label: `${titleOf(m.sectionId)} · ${m.label}`, state: m.state, reason: m.reason, n: 1 });
  }
  return [...groups.values()].map((g) => ({ label: g.n > 1 ? `${g.label} (${g.n}개 기간)` : g.label, state: g.state, reason: g.reason }));
}

export function buildRenderModel(doc: ReportDocument, pres: Presentation): RenderModel {
  const titleOf = (id: SectionId) => doc.sections.find((s) => s.sectionId === id)?.title ?? id;
  const idx = doc.footnoteIndex;
  const meta = doc.metadata;
  const blocks: RenderBlock[] = [];
  const push = (b: RenderBlock) => { blocks.push(b); };

  const table = (t: TableModel | undefined) => {
    if (!t) return;
    push({
      type: 'table', id: t.id, title: t.title, notices: t.notices.filter((n) => !shownNotices.has(n)), markers: t.markers,
      columns: t.columns.map((c) => ({ label: c.label, align: c.align, kindLabel: c.kind ? KIND_LABEL[c.kind] : null })),
      rows: t.rows.map((r): RRow => ({ label: r.label, kindLabel: r.kind ? KIND_LABEL[r.kind] : null, operator: r.operator ?? null, note: r.note, cells: r.cells.map(rc), emphasis: r.cells.some((c) => c.flag === 'total') })),
    });
  };
  const tablesOf = (id: string, only?: string[]) => (pres.bySection[id]?.tables ?? []).filter((x) => !only || only.includes(x)).forEach((x) => table(pres.tables[x]));
  const chartsOf = (id: string) => (pres.bySection[id]?.charts ?? []).forEach((x) => { const chart = pres.charts[x]; if (chart) push({ type: 'chart', id: x, chart }); });
  const narrative = (title: string, s: SectionState<Narrative> | undefined) => {
    if (!s || s.status !== 'ok') return;
    const items: RNarrativeItem[] = s.data.items.map((i) => ({ label: i.basis === 'objective' ? 'Fact' : 'Judgment', type: TYPE_LABEL[i.claimType] ?? i.claimType, text: i.text, confidence: i.confidence ? CONF[i.confidence] ?? i.confidence : null, markers: markersOf(idx, i.sourceIds) }));
    push({ type: 'narrative', title, items, note: s.data.excludedClaims > 0 ? `검증을 통과하지 못한 AI claim ${s.data.excludedClaims}건은 서술에서 제외했습니다.` : null });
  };
  const kv = (title: string | null, items: { label: string; cell: Cell; note?: string | null; emphasis?: boolean }[]) => push({ type: 'keyvalues', title, items: items.map((i): RKv => ({ label: i.label, value: plainCell(idx, i.cell), kindLabel: KIND_LABEL[i.cell.kind], note: i.note ?? null, emphasis: i.emphasis ?? false })) });
  const head = (s: ResolvedSection) => push({ type: 'heading', id: `sec-${s.sectionId}`, level: 1, number: s.number, text: s.title, status: s.status, pageBreakBefore: s.layout.pageBreakBefore === true });
  let shownNotices = new Set<string>();
  const notices = (s: ResolvedSection) => {
    shownNotices = new Set(s.notices);   // section 상단에 이미 보인 고지는 그 section 의 표에서 다시 반복하지 않는다
    for (const n of s.notices) push({ type: 'notice', text: n, kind: 'learning' });
    if (s.status === 'warning' && s.notices.length === 0 && s.reason) push({ type: 'notice', text: s.reason, kind: 'warning' });
  };
  const text = (value: string, markers: string[] = [], muted = false) => push({ type: 'paragraph', text: value, markers, muted });

  for (const s of doc.sections) {
    if (s.sectionId === 'cover') {
      const c = s.content as SectionContentMap['cover'];
      push({ type: 'cover', title: c.title, subtitle: c.subtitle, company: c.company, ticker: c.ticker, createdAt: c.createdAt, valuationDate: c.valuationDate, currency: c.currency, monetaryUnit: c.monetaryUnit, perShareUnit: c.perShareUnit, version: `schema ${c.reportVersion.schema} / template ${c.reportVersion.template}` });
      for (const b of doc.banners) push({ type: 'banner', title: b.title, text: b.text });
      continue;
    }
    head(s);
    if (!s.content) { text(s.reason ?? '이 section 은 표시할 데이터가 없습니다.', [], true); continue; }
    notices(s);
    const id: SectionId = s.sectionId;

    if (id === 'executiveSummary') {
      const c = s.content as SectionContentMap['executiveSummary'];
      push({ type: 'kpis', items: pres.kpis.map((k) => ({ label: k.label, value: rc(k.cell), kindLabel: KIND_LABEL[k.cell.kind] })) });
      const groups: [string, typeof c.highlights.conclusion][] = [['Key Conclusion', c.highlights.conclusion], ['Key Judgment', c.highlights.judgment], ['Key Risk', c.highlights.risk]];
      const any = groups.some(([, g]) => g.length > 0);
      for (const [title, g] of groups) if (g.length > 0) push({ type: 'narrative', title, items: g.map((i) => ({ label: i.basis === 'objective' ? 'Fact' : 'Judgment', type: TYPE_LABEL[i.claimType] ?? i.claimType, text: i.text, confidence: i.confidence ? CONF[i.confidence] ?? i.confidence : null, markers: markersOf(idx, i.sourceIds) })), note: null });
      if (!any) text('AI 분석(Grounded Claim)이 선택되지 않았거나 사용할 수 있는 claim 이 없어 숫자 중심 요약만 제공합니다.', [], true);
    } else if (id === 'companyOverview') {
      const c = s.content as SectionContentMap['companyOverview'];
      const v = (t: string | null): RCell => ({ text: t, alt: null, reason: t === null ? '값이 없습니다.' : null, markers: [], flag: null });
      const src = markersOf(idx, c.dataSource.sourceId);
      push({ type: 'keyvalues', title: null, items: [
        { label: 'Company Name', value: v(c.companyName), kindLabel: null, note: null, emphasis: false }, { label: 'Corp Code', value: v(c.corpCode), kindLabel: null, note: null, emphasis: false },
        { label: 'Stock Code', value: v(c.stockCode), kindLabel: null, note: null, emphasis: false }, { label: 'Reporting Basis', value: v(c.reportingBasis), kindLabel: null, note: null, emphasis: false },
        { label: 'Historical Period', value: v(c.historicalPeriod), kindLabel: 'Actual', note: null, emphasis: false },
        { label: 'Data Source', value: { ...v(`${c.dataSource.label}${c.dataKind === 'fixture' ? ' (학습용 fixture)' : ''}`), markers: src }, kindLabel: null, note: null, emphasis: false },
      ] });
    } else if (id === 'historicalPerformance') {
      const c = s.content as SectionContentMap['historicalPerformance'];
      tablesOf(id, ['historical-core']);
      chartsOf(id);
      tablesOf(id, ['historical-additional']);
      if (c.trendSummary.length > 0) push({ type: 'list', title: 'Historical Trend Summary (분석 엔진 결과)', items: c.trendSummary.map((t) => ({ text: `${t.label}: ${t.directionLabel}${t.fromPeriod ? ` (${t.fromPeriod} → ${t.toPeriod})` : ''}`, markers: markersOf(idx, 'src-historical'), note: null })) });
      if (c.revenueCagr.state === 'ok') text(`Revenue CAGR (Calculated): ${c.revenueCagr.text}`, markersOf(idx, c.revenueCagr.sourceId));
      if (c.notes.length > 0) push({ type: 'list', title: '데이터 노트', items: c.notes.map((n) => ({ text: n, markers: [], note: null })) });
      narrative('Historical Commentary', c.narrative);
    } else if (id === 'forecast') {
      const c = s.content as SectionContentMap['forecast'];
      tablesOf(id, ['forecast-assumptions']);
      chartsOf(id);
      tablesOf(id, ['forecast-projections', 'forecast-scalars']);
      text(`가정 출처: ${c.assumptionSource.label} (${c.assumptionSource.origin})`, markersOf(idx, c.assumptionSource.sourceId));
      text(c.basisNote, [], true);
      narrative('Forecast Commentary', c.narrative);
    } else if (id === 'wacc') {
      const c = s.content as SectionContentMap['wacc'];
      tablesOf(id);
      text(c.note, [], true);
    } else if (id === 'dcf') {
      const c = s.content as SectionContentMap['dcf'];
      tablesOf(id, ['dcf-projection']);
      (pres.bySection.dcf?.charts ?? []).filter((x) => x === 'chart-dcf-fcff-pv').forEach((x) => push({ type: 'chart', id: x, chart: pres.charts[x]! }));
      tablesOf(id, ['dcf-terminal', 'equity-bridge']);
      (pres.bySection.dcf?.charts ?? []).filter((x) => x === 'chart-equity-bridge').forEach((x) => push({ type: 'chart', id: x, chart: pres.charts[x]! }));
      narrative('Valuation Commentary', c.narrative);
    } else if (id === 'sensitivity') {
      const c = s.content as SectionContentMap['sensitivity'];
      chartsOf(id);
      tablesOf(id, ['sensitivity-pershare']);
      text(c.directionNotes.join(' · '), [], true);
      text('Base case 는 "Base" 표시로 구분합니다. 색상에 의미를 두지 않으며 값은 표의 텍스트와 같습니다.', [], true);
    } else if (id === 'scenario') {
      const c = s.content as SectionContentMap['scenario'];
      tablesOf(id);
      chartsOf(id);
      text(c.note, [], true);
      text('Scenario 범위(Bear ~ Bull)와 Sensitivity 범위(WACC × g)는 서로 다른 분석이며 합치지 않았습니다.', [], true);
    } else if (id === 'relativeValuation') {
      const c = s.content as SectionContentMap['relativeValuation'];
      tablesOf(id);
      text(c.note, c.inputSource ? markersOf(idx, c.inputSource.sourceId) : [], true);
      text(c.disclaimer, [], true);
    } else if (id === 'marketReference') {
      tablesOf(id);
    } else if (id === 'keyRisks') {
      const c = s.content as SectionContentMap['keyRisks'];
      if (c.items.length > 0) push({ type: 'list', title: 'Model Review (엔진 검토 · 데이터 품질)', items: c.items.map((i) => ({ text: i.text, markers: markersOf(idx, i.sourceIds), note: i.basis })) });
      narrative('Key Risks (AI, Grounded)', c.narrative);
    } else if (id === 'conclusion') {
      const c = s.content as SectionContentMap['conclusion'];
      kv('Headline (Calculated)', [{ label: 'Enterprise Value', cell: c.headline.enterpriseValue }, { label: 'Equity Value', cell: c.headline.equityValue }, { label: 'Value per Share', cell: c.headline.perShareValue, emphasis: true }]);
      tablesOf(id);
      chartsOf(id);
      narrative('Conclusion (AI, Grounded)', c.narrative);
      push({ type: 'list', title: '고지', items: c.disclaimers.map((d) => ({ text: d, markers: [], note: null })) });
    } else if (id === 'sources') {
      push({ type: 'sources', entries: (s.content as SectionContentMap['sources']).entries });
    } else if (id === 'appendix') {
      const c = s.content as SectionContentMap['appendix'];
      if (c.dataQuality.length > 0) push({ type: 'list', title: 'A.1 Data Quality', items: c.dataQuality.map((d) => ({ text: d, markers: [], note: null })) });
      if (c.provenance) push({ type: 'list', title: 'A.2 Provenance', items: [{ text: `${c.provenance.label} (${c.provenance.origin}${c.provenance.basis ? `, ${c.provenance.basis}` : ''}${c.provenance.asOf ? `, ${c.provenance.asOf}` : ''})${c.provenance.kind === 'fixture' ? ' — 학습용 fixture' : ''}`, markers: markersOf(idx, c.provenance.sourceId), note: null }] });
      push({ type: 'table', id: 'appendix-missing', title: 'A.3 Missing Data', notices: [], markers: [], columns: [{ label: 'Section · 항목', align: 'left', kindLabel: null }, { label: '상태', align: 'left', kindLabel: null }, { label: '사유', align: 'left', kindLabel: null }],
        rows: c.missingData.length > 0
          ? collapseMissing(c.missingData, titleOf).map((m): RRow => ({ label: m.label, kindLabel: null, operator: null, note: null, emphasis: false, cells: [{ text: m.state, alt: null, reason: null, markers: [], flag: null }, { text: m.reason ?? '-', alt: null, reason: null, markers: [], flag: null }] }))
          : [{ label: '없음', kindLabel: null, operator: null, note: null, emphasis: false, cells: [{ text: '-', alt: null, reason: null, markers: [], flag: null }, { text: '-', alt: null, reason: null, markers: [], flag: null }] }] });
      if (c.validationWarnings.length > 0) push({ type: 'list', title: 'A.4 Report Validation Warnings', items: c.validationWarnings.map((w) => ({ text: `[${w.code}] ${w.message}`, markers: [], note: null })) });
      push({ type: 'table', id: 'appendix-assumption-sources', title: 'A.5 Assumption Source', notices: [], markers: [], columns: [{ label: '항목', align: 'left', kindLabel: null }, { label: '값', align: 'right', kindLabel: 'Estimate' }, { label: '출처', align: 'left', kindLabel: null }],
        rows: c.assumptionSources.map((a) => ({ label: a.label, kindLabel: 'Estimate', operator: null, note: null, emphasis: false, cells: [plainCell(idx, a.cell), { text: a.sourceLabel, alt: null, reason: null, markers: markersOf(idx, a.cell.sourceId), flag: null }] })) });
      if (c.narrativeRejected.length > 0) push({ type: 'list', title: 'A.6 사용하지 않은 AI claim', items: c.narrativeRejected.map((r) => ({ text: `${r.claimId}: ${r.reason}`, markers: [], note: null })) });
      push({ type: 'keyvalues', title: 'A.7 단위 정책 · 범례 · 기술 정보', items: [
        ...c.unitPolicy.map((u) => ({ label: u.key, value: { text: u.value, alt: null, reason: null, markers: [], flag: null }, kindLabel: null, note: null, emphasis: false })),
        ...c.kindLegend.map((k) => ({ label: KIND_LABEL[k.kind], value: { text: k.meaning, alt: null, reason: null, markers: [], flag: null }, kindLabel: null, note: null, emphasis: false })),
        ...Object.entries({ schemaVersion: c.technical.schemaVersion, template: `${c.technical.templateId} v${c.technical.templateVersion}`, reportId: c.technical.reportId, inputHash: c.technical.inputHash, contextSnapshotId: c.technical.contextSnapshotId, valuationSnapshotId: c.technical.valuationSnapshotId ?? '-' }).map(([label, v]) => ({ label, value: { text: v, alt: null, reason: null, markers: [], flag: null }, kindLabel: null, note: null, emphasis: false })),
      ] });
    }
  }

  const company = meta.company.name;
  return {
    version: RENDER_MODEL_VERSION,
    meta: {
      title: meta.reportTitle, company, ticker: meta.company.ticker, createdAt: meta.createdAt, valuationDate: meta.valuationDate, reportId: meta.reportId, schemaVersion: meta.schemaVersion,
      templateId: doc.template.id, templateVersion: doc.template.version, currency: meta.currency, monetaryUnit: meta.monetaryUnit, language: 'ko',
      filename: reportFilename(company, meta.valuationDate, meta.createdAt), footer: `${meta.reportTitle} · ${doc.template.id} v${doc.template.version} · schema ${meta.schemaVersion}`,
    },
    banners: doc.banners.map((b) => ({ title: b.title, text: b.text })),
    blocks,
  };
}
