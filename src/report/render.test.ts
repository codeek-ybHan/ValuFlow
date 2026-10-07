// STEP 09-6: Renderer — RenderModel / HTML / SVG chart / JSON bundle. 같은 RenderModel 을 HTML 과 PDF 가 그리므로 숫자는 달라질 수 없고, 렌더러는 값을 계산하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildBundle, buildRenderModel, chartToSvg, generateReport, parseBundle, renderHashOf, renderReportHtml, reportFilename, buildReportInput, withHiddenOptionalSections, type AiAnalysisInput, type RenderModel } from './index.ts';
import { valuationStandardV1 } from './templates/index.ts';
import { buildScenario } from '../ai/eval/scenarios.ts';
import type { Evidence, GroundedClaim } from '../ai/grounding/types.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const NOW = () => new Date('2026-10-08T01:02:03Z');
const proj = () => structuredClone(buildScenario('full', golden).project);
const gen = (p = proj(), ai: AiAnalysisInput | null = null, hide: Parameters<typeof withHiddenOptionalSections>[1] = []) => {
  const r = generateReport(buildReportInput(p, { now: NOW, aiAnalysis: ai }), { hideOptional: hide });
  assert.equal(r.status, 'ok');
  return r as Extract<typeof r, { status: 'ok' }>;
};
const claim = (claimId: string, text: string, type: GroundedClaim['type'], evidenceIds: string[], basis: GroundedClaim['basis'] = 'objective'): GroundedClaim =>
  ({ claimId, text, type, basis, evidenceIds, status: 'supported', confidence: 'high', numbers: [], issues: [], confidenceNotes: [] });
const aiFor = (): AiAnalysisInput => {
  const base = buildReportInput(proj(), { now: NOW });
  const evidence: Evidence[] = [{ evidenceId: 'h', tool: 'getHistoricalAnalysis', sourceType: 'financial-data', sourceKind: 'actual' }, { evidenceId: 'm', tool: 'getMarketData', sourceType: 'market-data', sourceKind: 'external', origin: 'yahoo-finance', sourceLabel: '005930.KS', fieldPath: 'price.value', value: 268500, unit: 'KRW', asOf: '2026-10-07T03:00:00+00:00', provider: { name: 'Yahoo Finance', reliability: 'unofficial', tier: 'development', official: false, valuationGrade: false } }];
  return { analysisId: 'wf', question: 'q', workflowType: 'full-valuation-review', contextSnapshotId: base.snapshot.contextSnapshotId, createdAt: '2026-10-08T00:00:00Z', groundingLevel: 'claim-evidence', evidence, sources: [], limitations: [],
    claims: [claim('c1', '2025년 영업이익률은 13.07%이다.', 'fact', ['h']), claim('c2', '수익성 개선이 이어지고 있다.', 'interpretation', ['h'], 'judgment'), claim('c3', '주가는 268,500원이다.', 'fact', ['m']), claim('c4', 'DCF 가 TV 에 의존한다.', 'risk', ['h'], 'judgment')] };
};
const textOfHtml = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

test('RenderModel: cover → 번호 있는 section heading → 표 · 차트 · 서술, 학습용 banner 와 section 고지', () => {
  const { renderModel: rm } = gen();
  assert.equal(rm.version, '1.0');
  assert.equal(rm.blocks[0]!.type, 'cover');
  assert.equal(rm.blocks[1]!.type, 'banner');
  const heads = rm.blocks.filter((b) => b.type === 'heading') as Extract<RenderModel['blocks'][number], { type: 'heading' }>[];
  assert.deepEqual(heads.map((h) => [h.number, h.text]).slice(0, 4), [['1', 'Executive Summary'], ['2', 'Company Overview'], ['3', 'Historical Financial Performance'], ['4', 'Forecast Assumptions']]);
  assert.equal(heads.at(-1)!.number, 'A');
  assert.ok(heads.filter((h) => h.pageBreakBefore).length >= 3, 'page-break semantic hint');
  assert.ok(rm.blocks.filter((b) => b.type === 'notice').length >= 5, 'section 별 학습용 고지');
  assert.equal(rm.blocks.filter((b) => b.type === 'table' && b.title === 'Historical Financial Performance (Actual)').length, 1);
  assert.equal(rm.blocks.filter((b) => b.type === 'chart').length, 8);
  assert.deepEqual(rm.banners.map((b) => b.title), ['Learning / Demonstration Data']);
  assert.match(rm.meta.footer, /valuation-standard-v1 v1\.0 · schema 1\.0/);
  // 같은 section 고지가 표에서 반복되지 않는다
  const tables = rm.blocks.filter((b) => b.type === 'table') as Extract<RenderModel['blocks'][number], { type: 'table' }>[];
  assert.ok(tables.every((t) => !t.notices.some((n) => n.startsWith('Learning / Demonstration Data'))));
});

test('파일 이름: ValuFlow_{Company}_Valuation_{YYYY-MM-DD}.pdf (특수문자 정리, 날짜는 기준일)', () => {
  assert.equal(reportFilename('삼성전자', '2026-10-08', '2026-10-09T00:00:00Z'), 'ValuFlow_삼성전자_Valuation_2026-10-08.pdf');
  assert.equal(reportFilename('Samsung Electronics Co.,Ltd', null, '2026-10-09T00:00:00Z'), 'ValuFlow_Samsung_Electronics_Co_Ltd_Valuation_2026-10-09.pdf');
  assert.equal(reportFilename('../../etc/passwd', '2026-10-08', 'x'), 'ValuFlow_etc_passwd_Valuation_2026-10-08.pdf');
  assert.equal(reportFilename('***', '2026-10-08', 'x', 'html'), 'ValuFlow_Company_Valuation_2026-10-08.html');
  assert.match(gen().renderModel.meta.filename, /^ValuFlow_.+_Valuation_2026-10-08\.pdf$/);
});

test('HTML: cover · KPI · 표 · 차트 · footnote marker → Sources · appendix · A4 인쇄 설정', () => {
  const { renderModel: rm } = gen();
  const html = renderReportHtml(rm, { mode: 'document' });
  assert.match(html, /^<!doctype html><html lang="ko">/);
  assert.match(html, /@page\{size:A4;margin:18mm 16mm\}/);
  for (const s of ['class="cover"', 'class="kpis"', 'class="banner"', 'id="sec-executiveSummary"', 'id="sec-appendix"', 'class="sources"', 'class="page-break"']) assert.ok(html.includes(s), s);
  assert.equal((html.match(/<svg /g) ?? []).length, 8);
  assert.ok(html.includes('2,346억원') && html.includes('8.14%') && html.includes('214,556원'));
  assert.ok(html.includes('<small class="kind">Actual</small>') && html.includes('2025A') && html.includes('2026E'));
  // footnote: 본문 marker 의 링크 대상이 Sources 에 있다
  const markers = new Set([...html.matchAll(/data-marker="(S\d+)"/g)].map((m) => m[1]));
  for (const m of markers) assert.ok(html.includes(`id="src-${m}"`), `${m} 의 출처`);
  assert.ok(markers.size >= 3);
  assert.ok(!/NaN|undefined|\[object/.test(html));
  // fragment 모드(Preview)는 같은 본문이고 스타일 · doctype 이 없다
  const frag = renderReportHtml(rm, { mode: 'fragment' });
  assert.ok(frag.startsWith('<div class="valuflow-report"') && !frag.includes('<!doctype') && html.includes(frag));
  assert.equal(renderReportHtml(rm, { mode: 'document' }), html, 'deterministic');
});

test('HTML 은 텍스트를 escape 한다 (회사명 · claim 문장의 태그가 실행되지 않는다)', () => {
  const p = proj();
  p.historicalData!.company.name = '<script>alert(1)</script> & "회사"';
  const html = renderReportHtml(gen(p).renderModel, { mode: 'document' });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;회사&quot;'));
});

test('차트 SVG: 접근성 title/desc, 모든 type, 숫자 눈금 없음(값 표시는 point.text 뿐), NaN 없음', () => {
  const { presentation: pres } = gen();
  const types = new Set(Object.values(pres.charts).map((c) => c.type));
  for (const t of ['grouped-bar', 'line', 'waterfall', 'heatmap', 'range']) assert.ok(types.has(t as never), t);
  for (const c of Object.values(pres.charts)) {
    const svg = chartToSvg(c);
    assert.ok(svg.startsWith('<svg xmlns=') && svg.includes('role="img"') && svg.includes(`<title>`) && svg.includes('<desc>'), c.id);
    assert.ok(!/NaN|Infinity|undefined/.test(svg), c.id);
    // SVG 에 나온 숫자 문자열은 모두 ChartModel 의 표시 문자열(text)이나 카테고리/라벨이다 — 새 숫자를 만들지 않는다
    const allowed = new Set<string>([...c.categories, ...c.series.flatMap((s) => s.points.map((p) => p.text ?? '')), ...(c.waterfall ?? []).map((s) => s.point.text ?? ''), ...(c.heatmap ? [...c.heatmap.rowLabels, ...c.heatmap.colLabels, ...c.heatmap.cells.flat().map((x) => x.text ?? '')] : []), ...(c.range ?? []).flatMap((r) => [r.low.text ?? '', r.high.text ?? '', r.base?.text ?? ''])]);
    const texts = [...svg.replace(/<title>[\s\S]*?<\/title><desc>[\s\S]*?<\/desc>/, '').matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/^(Low|High|Base) /, '').replace(/^[-+=] /, ''));
    const numeric = texts.filter((t) => /\d/.test(t) && !/^g \\ WACC$/.test(t));
    for (const t of numeric) assert.ok(allowed.has(t) || [...allowed].some((a) => a === t), `${c.id}: 새 숫자 텍스트 "${t}"`);
  }
  // 값이 없는 점은 — 로 표시한다
  const empty = chartToSvg({ ...Object.values(pres.charts)[0]!, series: Object.values(pres.charts)[0]!.series.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, value: null, text: null, state: 'missing' as const })) })) });
  assert.match(empty, /표시할 값이 없습니다/);
  // Base 는 문구와 테두리로 구분 (색 아님)
  const heat = chartToSvg(pres.charts['chart-sensitivity-heatmap']!);
  assert.match(heat, /stroke-width="3"/);
  assert.match(heat, />Base</);
});

test('같은 RenderModel → HTML 의 표 · KPI 값이 모두 그대로 나온다 (PDF 도 같은 RenderModel 을 그린다)', () => {
  const { renderModel: rm } = gen(proj(), aiFor());
  const html = textOfHtml(renderReportHtml(rm, { mode: 'document' }));
  let checked = 0;
  for (const b of rm.blocks) {
    if (b.type === 'table') for (const r of b.rows) for (const c of r.cells) if (c.text) { assert.ok(html.includes(c.text), `${b.id}: ${c.text}`); checked++; }
    if (b.type === 'kpis') for (const k of b.items) { assert.ok(html.includes(k.value.text!), k.label); checked++; }
    if (b.type === 'narrative') for (const i of b.items) { assert.ok(html.includes(i.text), i.text); checked++; }
  }
  assert.ok(checked > 150);
  // 서술: Fact / Judgment 가 다르게 표시된다
  const raw = renderReportHtml(rm, { mode: 'fragment' });
  assert.ok(raw.includes('class="fact"') && raw.includes('class="judgment"') && raw.includes('>FACT<') && raw.includes('>JUDGMENT<'));
});

test('학습용 고지: 표지 banner · section notice 가 HTML 과 RenderModel(PDF 입력) 모두에 있다', () => {
  const { renderModel: rm } = gen();
  const html = renderReportHtml(rm, { mode: 'document' });
  assert.ok((html.match(/Learning \/ Demonstration Data/g) ?? []).length >= 6);
  assert.ok(rm.banners.length === 1 && rm.blocks.some((b) => b.type === 'banner'));
});

test('Market & Peer Reference · 출처 고지가 Renderer 입력에 그대로 들어간다 (Development Source)', () => {
  const { renderModel: rm, document: doc } = gen(proj(), aiFor());
  const t = rm.blocks.find((b) => b.type === 'table' && b.id === 'market-reference') as Extract<RenderModel['blocks'][number], { type: 'table' }>;
  assert.ok(t && t.rows.some((r) => r.note?.includes('Development Source')) && t.rows[0]!.kindLabel === 'Reference');
  const src = rm.blocks.find((b) => b.type === 'sources') as Extract<RenderModel['blocks'][number], { type: 'sources' }>;
  assert.ok(src.entries.some((e) => e.notice?.includes('Development Source')));
  assert.deepEqual(src.entries.map((e) => e.marker), doc.sources.map((s) => s.marker));
});

test('JSON bundle: snapshot · renderHash · 복원, 알 수 없는 형식은 거부', () => {
  const r = gen();
  const json = JSON.stringify(r.bundle);
  const back = parseBundle(json);
  assert.ok(back.ok && back.bundle.reportId === r.model.metadata.reportId);
  assert.equal(back.ok && back.bundle.renderHash, renderHashOf(r.renderModel));
  assert.equal(r.bundle.snapshot.contextSnapshotId, r.input.snapshot.contextSnapshotId);
  assert.equal(JSON.stringify(buildBundle(r.model, r.document, r.presentation, r.renderModel)), json, 'deterministic');
  assert.deepEqual(parseBundle('{bad'), { ok: false, reason: 'invalid-json' });
  assert.deepEqual(parseBundle('{"schema":"x"}'), { ok: false, reason: 'not-a-bundle' });
  assert.deepEqual(parseBundle(JSON.stringify({ ...r.bundle, bundleVersion: '9.9' })), { ok: false, reason: 'unsupported-version' });
  // 번들의 RenderModel 해시는 문서가 바뀌면 달라진다
  const hidden = gen(proj(), null, ['sensitivity']);
  assert.notEqual(hidden.bundle.renderHash, r.bundle.renderHash);
});

test('선택 section 숨김: 선택 section 만 숨기고 필수 section 은 무시한다', () => {
  const r = gen(proj(), null, ['sensitivity', 'scenario', 'dcf', 'cover'] as never);
  assert.deepEqual(r.ignoredHide.sort(), ['cover', 'dcf']);
  const ids = r.document.sections.map((s) => s.sectionId);
  assert.ok(!ids.includes('sensitivity') && !ids.includes('scenario') && ids.includes('dcf') && ids.includes('cover'));
  assert.ok(r.document.diagnostics.hiddenSections.some((h) => h.sectionId === 'sensitivity' && /Template/.test(h.reason)));
  assert.equal(withHiddenOptionalSections(valuationStandardV1, ['relativeValuation']).template.sections.find((s) => s.sectionId === 'relativeValuation')!.visibility, 'never');
});

test('No recalculation: render 코드에는 valuation 공식 · 계산 함수가 없다 (기하 계산만)', () => {
  const FORBIDDEN = /\b(runValuation|runSensitivity|runScenarios?|calculateWacc|calculateCostOfEquity|calculateRelativeValuation|analyzeHistorical|buildValidationView|buildSensitivityView|buildDcfView|terminalValueContribution|discountFactor\s*\*|\*\s*\(1\s*\+\s*wacc)/;
  const dir = new URL('./render/', import.meta.url).pathname;
  for (const f of readdirSync(dir)) assert.ok(!FORBIDDEN.test(readFileSync(`${dir}${f}`, 'utf8').replace(/\/\/.*$/gm, '')), `${f} 에 valuation 계산이 있다`);
  const py = readFileSync(new URL('../../backend/app/report/pdf.py', import.meta.url), 'utf8') + readFileSync(new URL('../../backend/app/report/charts.py', import.meta.url), 'utf8');
  assert.ok(!/\b(wacc|discount|terminal|enterprise)\w*\s*[*/+\-]=?\s*\w/i.test(py.replace(/#.*$/gm, '').replace(/"[^"]*"|'[^']*'/g, '""')), 'PDF Renderer 에 valuation 식이 없다');
});

test('파이프라인 시간 기록: 단계별 ms 만 기록한다 (성능 보장 아님)', () => {
  const r = gen();
  assert.ok(Object.values(r.timings).every((x) => x >= 0 && Number.isFinite(x)));
  assert.ok(r.timings.total >= r.timings.html);
});
