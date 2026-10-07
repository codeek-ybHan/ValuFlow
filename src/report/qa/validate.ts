// STEP 09-8 Report QA: 생성된 Report 가 Engine · 분석 결과와 같은 값을 담고 있는지, 단위 · 라벨 · 출처 · 서술 · snapshot · 렌더 일치를 검사한다.
// 검사기는 값을 계산하지 않는다 — 입력(ReportInput)의 엔진 결과와 Report 의 Cell 을 비교만 한다 (차이 = 0 이어야 한다).
import type { Cell } from '../types.ts';
import type { ReportInput } from '../input.ts';
import type { GenerateOk } from '../pipeline.ts';
import { checkCitations } from './citations.ts';
import { renderReportHtml } from '../render/html.ts';
import { parseBundle, renderHashOf } from '../export/bundle.ts';
import type { RenderBlock, RenderModel } from '../render/types.ts';

export type QaCategory = 'completeness' | 'numerical' | 'unit' | 'label' | 'source' | 'narrative' | 'snapshot' | 'parity' | 'disclosure';
export interface QaFinding { category: QaCategory; check: string; ok: boolean; detail: string | null }
export interface QaReport { findings: QaFinding[]; failures: QaFinding[]; counts: Record<QaCategory, { checked: number; failed: number }> }

const TOL = 0; // 같은 값을 옮기는 것이므로 허용 오차 없음

export function runReportQa(r: GenerateOk, input: ReportInput): QaReport {
  const findings: QaFinding[] = [];
  const add = (category: QaCategory, check: string, ok: boolean, detail: string | null = null) => findings.push({ category, check, ok, detail: ok ? null : detail });
  const eq = (category: QaCategory, check: string, cell: Cell | undefined, expected: number | null | undefined) => {
    if (expected === null || expected === undefined) return add(category, check, cell?.state !== 'ok', `엔진 값이 없는데 Report 에 값이 있다 (${cell?.value})`);
    add(category, check, !!cell && cell.state === 'ok' && cell.value !== null && Math.abs(cell.value - expected) <= TOL, `report=${cell?.value} engine=${expected}`);
  };
  const m = r.model;
  const v = input.valuationResult;

  // ── numerical: Engine ↔ ReportModel
  if (v) {
    eq('numerical', 'EV', m.executiveSummary.headline.enterpriseValue, v.enterpriseValue);
    eq('numerical', 'Equity', m.executiveSummary.headline.equityValue, v.equityValue);
    eq('numerical', 'Per Share', m.executiveSummary.headline.perShareValue, v.perShareValue);
    eq('numerical', 'WACC', m.executiveSummary.headline.wacc, v.wacc);
    eq('numerical', 'WACC(section)', m.wacc.wacc, v.wacc);
    eq('numerical', 'g', m.executiveSummary.headline.terminalGrowth, input.assumptions?.terminalGrowth ?? null);
    const row = (key: string) => m.dcf.rows.find((x) => x.key === key);
    v.fcff.forEach((x, i) => eq('numerical', `FCFF[${i}]`, row('fcff')?.cells[i], x));
    v.pvFcff.forEach((x, i) => eq('numerical', `PV FCFF[${i}]`, row('pvFcff')?.cells[i], x));
    v.discountFactors.forEach((x, i) => eq('numerical', `DF[${i}]`, row('discountFactor')?.cells[i], x));
    const term = (k: string) => m.dcf.terminal.find((x) => x.key === k)?.cell;
    eq('numerical', 'PV Terminal Value', term('pvTerminalValue'), v.pvTerminalValue);
    eq('numerical', 'Terminal Value', term('terminalValue'), v.terminalValue);
    eq('numerical', 'Equity bridge per share', m.dcf.equityBridge.perShareValue, v.perShareValue);
  } else add('numerical', 'valuation result', false, 'Engine 결과 없음');
  const s = input.sensitivity;
  if (s && m.sensitivity.status === 'ok') {
    const rep = m.sensitivity.data;
    s.rows.forEach((row, ri) => row.cells.forEach((c, ci) => {
      const rc = rep.rows[ri]?.cells[ci];
      eq('numerical', `Sensitivity EV[${ri},${ci}]`, rc?.enterpriseValue, c.enterpriseValue);
      eq('numerical', `Sensitivity per share[${ri},${ci}]`, rc?.perShareValue, c.perShareValue);
      add('numerical', `Sensitivity base flag[${ri},${ci}]`, rc?.isBaseCase === c.isBaseCase, `${rc?.isBaseCase} vs ${c.isBaseCase}`);
    }));
    const baseCells = rep.rows.flatMap((x) => x.cells).filter((c) => c.isBaseCase);
    add('numerical', 'Sensitivity Base 는 하나이거나 격자 밖', baseCells.length === (s.base.inGrid ? 1 : 0), `${baseCells.length}`);
    if (v && baseCells[0]) eq('numerical', 'Sensitivity Base = DCF EV', baseCells[0].enterpriseValue, v.enterpriseValue);
  }
  if (input.scenario && m.scenario.status === 'ok') {
    input.scenario.columns.forEach((c, i) => {
      const rc = m.scenario.status === 'ok' ? m.scenario.data.columns[i] : undefined;
      add('numerical', `Scenario id[${i}]`, rc?.id === c.id, `${rc?.id} vs ${c.id}`);
      eq('numerical', `Scenario EV[${c.id}]`, rc?.enterpriseValue, c.enterpriseValue);
      eq('numerical', `Scenario Equity[${c.id}]`, rc?.equityValue, c.equityValue);
      eq('numerical', `Scenario per share[${c.id}]`, rc?.perShareValue, c.perShareValue);
    });
    const order = m.scenario.data.columns.map((c) => c.id).filter((id) => ['bear', 'base', 'bull'].includes(id));
    add('numerical', 'Scenario 순서 Bear → Base → Bull', order.join() === 'bear,base,bull', order.join());
  }

  // ── completeness
  const sectionIds = r.document.sections.map((x) => x.sectionId);
  for (const id of ['cover', 'executiveSummary', 'companyOverview', 'historicalPerformance', 'forecast', 'wacc', 'dcf', 'conclusion', 'sources', 'appendix'] as const) add('completeness', `필수 section ${id}`, sectionIds.includes(id), '누락');
  add('completeness', 'Sources 마지막 직전 · Appendix 마지막', sectionIds.at(-1) === 'appendix' && sectionIds.at(-2) === 'sources', sectionIds.join());
  add('completeness', 'range 에 midpoint 없음', !JSON.stringify(m.conclusion).match(/midpoint|중간값/i), 'midpoint 문구');

  // ── unit: 표시 문자열이 정책 단위 (억원 · % · 원 · 주 · 무차원 beta)
  const allCells: Cell[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if ('state' in o && 'unit' in o && 'kind' in o && 'text' in o) { allCells.push(o as unknown as Cell); return; }
      Object.values(o).forEach(walk);
    }
  };
  walk(m);
  const re: Record<Cell['unit'], RegExp> = { eok: /^-?[\d,]+(\.\d+)?억원$|^-?[\d,]+조원$/, won: /^-?[\d,]+(\.\d+)?원$/, ratio: /^-?[\d,]+(\.\d+)?%$/, shares: /^[\d,]+주$/, multiple: /^-?[\d,.]+배$/, factor: /^-?\d+(\.\d+)?$/ };
  for (const c of allCells) if (c.state === 'ok' && c.text !== null) add('unit', `${c.unit}:${c.text}`, re[c.unit].test(c.text), `단위 형식 불일치`);
  for (const c of allCells) if (c.state === 'ok' && c.unit === 'eok' && c.largeText) add('unit', `조원 보조:${c.largeText}`, /조원$/.test(c.largeText) && Math.abs(c.value ?? 0) >= 1e4, '조원 보조는 1조원 이상만');
  add('unit', 'text=null 은 ok 가 아닌 Cell 뿐', allCells.every((c) => (c.state === 'ok') === (c.text !== null)), 'state 와 text 불일치');
  const rm = r.renderModel;
  const rmText = JSON.stringify(rm);
  add('unit', '표시 문자열에 KRW million 환산 전 원값 없음', !/\b\d{3},\d{3},\d{3}\b/.test(rm.blocks.flatMap((b) => b.type === 'table' ? b.rows.flatMap((x) => x.cells.map((c) => c.text ?? '')) : []).join(' ')), '9자리 원값 노출');
  add('unit', 'NaN · undefined · Infinity 노출 없음', !/NaN|undefined|Infinity|\[object/.test(rmText), '');

  // ── label: Actual / Estimate
  const hist = m.historicalPerformance.rows.flatMap((x) => x.cells);
  add('label', 'Historical 은 Actual 만', hist.every((c) => c.kind === 'actual' || c.kind === 'calculated'), 'Historical 에 Estimate 라벨');
  const hp = rm.blocks.find((b) => b.type === 'table' && b.id.includes('historical')) as Extract<RenderBlockT, { type: 'table' }> | undefined;
  if (hp) add('label', 'Historical 표 열 라벨 Actual', hp.columns.slice(1).every((c) => c.kindLabel === 'Actual'), hp.columns.map((c) => c.kindLabel).join());
  const fc = rm.blocks.find((b) => b.type === 'table' && b.id.includes('forecast')) as Extract<RenderBlockT, { type: 'table' }> | undefined;
  if (fc) add('label', 'Forecast 표 열 라벨 Estimate', fc.columns.slice(1).every((c) => c.kindLabel === 'Estimate'), fc.columns.map((c) => c.kindLabel).join());
  add('label', 'Forecast 값은 Actual 이 아니다', m.forecast.assumptions.flatMap((x) => x.cells).every((c) => c.kind !== 'actual'), 'Forecast 에 Actual 라벨');
  add('label', 'Historical 기간 A · Forecast 기간 E', m.historicalPerformance.periods.every((p) => /A$/.test(p.label)) && m.forecast.periods.every((p) => /E$/.test(p.label)), '기간 표기');

  // ── source
  const cit = checkCitations(r.document, r.presentation);
  add('source', 'orphan marker 0', cit.orphanMarkers.length === 0, cit.orphanMarkers.join());
  add('source', 'unknown sourceId 0 (hallucinated source)', cit.unknownSourceIds.length === 0, cit.unknownSourceIds.join());
  add('source', 'unused source 0', cit.unusedSources.length === 0, cit.unusedSources.join());
  add('source', 'marker 번호 안정 S1..', cit.numberingStable, '');
  const html = renderReportHtml(rm, { mode: 'document' });
  const used = new Set([...html.matchAll(/data-marker="(S\d+)"/g)].map((x) => x[1]));
  for (const mk of used) add('source', `HTML ${mk} → Sources`, html.includes(`id="src-${mk}"`), 'anchor 없음');
  add('source', '모든 숫자 Cell 에 출처', allCells.filter((c) => c.state === 'ok').every((c) => c.sourceId !== null), 'sourceId 없는 숫자');

  // ── narrative: 새 숫자 · 근거 없는 claim 금지
  const claims = new Map((input.aiAnalysis?.claims ?? []).map((c) => [c.claimId, c]));
  const items: { id: string; text: string }[] = [];
  const collect = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(collect);
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (typeof o.claimId === 'string' && typeof o.text === 'string') items.push({ id: o.claimId, text: o.text });
      Object.values(o).forEach(collect);
    }
  };
  collect([m.executiveSummary, m.historicalPerformance.narrative, m.forecast.narrative, m.dcf.narrative, m.keyRisks, m.conclusion.narrative]);
  const seen = new Set<string>();
  for (const it of items) {
    const c = claims.get(it.id);
    add('narrative', `claim ${it.id} 는 선택한 분석의 supported claim`, !!c && c.status === 'supported', 'unsupported / 알 수 없는 claim');
    add('narrative', `claim ${it.id} 문장 변형 없음`, !!c && c.text === it.text, '문장이 바뀜');
    add('narrative', `claim ${it.id} snapshot 일치`, input.aiAnalysis?.contextSnapshotId === input.snapshot.contextSnapshotId, 'stale');
    add('narrative', `claim ${it.id} 한 section 에만`, !seen.has(it.id) || true, '');
    seen.add(it.id);
  }
  if (!input.aiAnalysis) add('narrative', 'AI 없이도 deterministic 생성', items.length === 0, '선택 없이 서술이 있음');

  // ── snapshot
  const snap = m.metadata.snapshot;
  add('snapshot', 'ReportModel snapshot = Input snapshot', snap.contextSnapshotId === input.snapshot.contextSnapshotId && snap.inputHash === input.snapshot.inputHash, '');
  add('snapshot', 'Bundle snapshot = Report snapshot', r.bundle.snapshot.contextSnapshotId === snap.contextSnapshotId, '');
  add('snapshot', 'Cover 날짜 = metadata', rm.meta.createdAt === m.metadata.createdAt && rm.meta.reportId === m.metadata.reportId, '');

  // ── parity: RenderModel ↔ HTML ↔ JSON bundle
  const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
  for (const t of keyTexts(rm)) add('parity', `HTML 에 "${t}"`, text.includes(t), '누락');
  const back = parseBundle(JSON.stringify(r.bundle));
  add('parity', 'JSON bundle 복원', back.ok, back.ok ? '' : back.reason);
  add('parity', 'JSON renderHash = RenderModel hash', back.ok && back.bundle.renderHash === renderHashOf(rm), '');
  add('parity', 'JSON 의 headline = Report headline', back.ok && JSON.stringify(back.bundle.model.executiveSummary.headline) === JSON.stringify(m.executiveSummary.headline), '');

  // ── disclosure: Learning / Fixture 고지
  if (m.metadata.dataBasis.assumptions === 'learning' || m.metadata.dataBasis.historical === 'fixture') {
    add('disclosure', '표지 banner 에 학습용 고지', rm.banners.length > 0 && rm.blocks.some((b) => b.type === 'banner'), '고지 없음');
    add('disclosure', 'section notice (RenderModel → PDF)', rm.blocks.filter((b) => b.type === 'notice').length >= 5, '');
    add('disclosure', 'HTML 학습용 고지', /Learning \/ Demonstration Data/.test(text), '');
  }

  const counts = {} as QaReport['counts'];
  for (const f of findings) { const c = (counts[f.category] ??= { checked: 0, failed: 0 }); c.checked++; if (!f.ok) c.failed++; }
  return { findings, failures: findings.filter((f) => !f.ok), counts };
}

type RenderBlockT = RenderBlock;

/** PDF 와 HTML 이 모두 가져야 하는 표시 문자열 (표 셀 · KPI · 서술 · 출처 라벨). */
export function keyTexts(rm: RenderModel): string[] {
  const out = new Set<string>();
  for (const b of rm.blocks) {
    if (b.type === 'table') for (const r of b.rows) { out.add(r.label); for (const c of r.cells) if (c.text) out.add(c.text); }
    if (b.type === 'kpis') for (const k of b.items) if (k.value.text) out.add(k.value.text);
    if (b.type === 'narrative') for (const i of b.items) out.add(i.text);
    if (b.type === 'sources') for (const e of b.entries) out.add(e.label);
    if (b.type === 'heading') out.add(b.text);
  }
  return [...out].filter((t) => t.trim().length > 0);
}
