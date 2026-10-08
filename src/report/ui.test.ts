// STEP 09-7: Report Workspace — 순수 로직(선택 · 신선도 · 검증 메시지 · PDF client)과 화면 렌더링.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { analysisChoices, defaultAnalysisId, isReportStale, validationMessages, OPTIONAL_SECTIONS, downloadNames } from './ui/model.ts';
import { requestPdf } from './export/pdfClient.ts';
import { generateReport } from './pipeline.ts';
import { buildReportInput, type AiAnalysisInput } from './input.ts';
import { emptyProjectState, toPersisted, withPracticeAssumptions, withSamsungHistorical, withSelectedCompany, withRelativeInputs, type ProjectState } from '../store/projectModel.ts';
import { emptySession, addTurn } from '../ai/analyst/session.ts';
import type { AnalystTurn } from '../ai/analyst/view.ts';
import { buildAiContext } from '../ai/context.ts';
import { snapshotId } from '../ai/agent/run.ts';

type H = { renderReport(p: string | null, o?: Record<string, unknown>): string };
let h: H;
before(() => {
  const out = join(mkdtempSync(join(tmpdir(), 'valuflow-report-')), 'h.cjs');
  buildSync({ entryPoints: [new URL('./ui/renderHarness.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', logLevel: 'silent', define: { 'import.meta.env': '{}' } });
  h = createRequire(import.meta.url)(out) as H;
});

const full = (): ProjectState => withRelativeInputs(withPracticeAssumptions(withSamsungHistorical(emptyProjectState)), { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 });
const persisted = (p: ProjectState) => JSON.stringify(toPersisted(p));
const sid = (p: ProjectState) => snapshotId(buildAiContext(p, { historicalStatus: { kind: 'idle' } as never }));
const analysis = (snapshot: string, id = 'a1'): AiAnalysisInput => ({ analysisId: id, question: 'q', workflowType: 'full-valuation-review', contextSnapshotId: snapshot, createdAt: '2026-10-08T00:00:00Z', groundingLevel: 'claim-evidence', evidence: [], sources: [], limitations: [],
  claims: [{ claimId: 'c1', text: 't', type: 'fact', basis: 'objective', evidenceIds: [], status: 'supported', confidence: 'high', numbers: [], issues: [], confidenceNotes: [] }] });
const turn = (id: string, a: AiAnalysisInput | null): AnalystTurn => ({ id, question: `질문 ${id}`, askedAt: '2026-10-08T00:00:00Z', workflowLabel: 'Full Valuation Review', analysis: a } as unknown as AnalystTurn);

test('AI 분석 선택: 기본은 같은 snapshot 의 최근 분석, stale 은 표시하되 자동 선택하지 않는다, Quick(분석 없음)은 제외', () => {
  const choices = analysisChoices([turn('t1', analysis('ctx-a', 'a1')), turn('t2', null), turn('t3', analysis('ctx-b', 'a3')), turn('t4', analysis('ctx-a', 'a4'))], 'ctx-a');
  assert.deepEqual(choices.map((c) => [c.id, c.freshness]), [['t4', 'current'], ['t3', 'stale'], ['t1', 'current']], '최근 순 · Quick 제외');
  assert.equal(defaultAnalysisId(choices), 't4');
  assert.equal(defaultAnalysisId(choices.filter((c) => c.freshness === 'stale')), null, 'stale 만 있으면 선택 없음');
  assert.equal(defaultAnalysisId([]), null);
  assert.equal(choices[0]!.supported, 1);
});

test('stale 판정 · 선택 section · 파일 이름', () => {
  assert.equal(isReportStale(null, 'ctx-a'), false);
  assert.equal(isReportStale('ctx-a', 'ctx-a'), false);
  assert.equal(isReportStale('ctx-a', 'ctx-b'), true);
  assert.deepEqual(OPTIONAL_SECTIONS.map((s) => s.id).sort(), ['keyRisks', 'marketReference', 'relativeValuation', 'scenario', 'sensitivity']);
  assert.deepEqual(downloadNames('ValuFlow_X_Valuation_2026-10-08.pdf'), { pdf: 'ValuFlow_X_Valuation_2026-10-08.pdf', html: 'ValuFlow_X_Valuation_2026-10-08.html', json: 'ValuFlow_X_Valuation_2026-10-08.json' });
});

test('Blocked 검증: 해결 화면으로 이동하는 링크가 붙는다 (fixture 로 채우지 않는다)', () => {
  const r = generateReport(buildReportInput(emptyProjectState, { now: () => new Date('2026-10-08T00:00:00Z') }));
  assert.equal(r.status, 'blocked');
  const msgs = validationMessages(r.validation);
  assert.ok(msgs.length > 0 && msgs.every((m) => m.severity === 'error' || m.severity === 'warning'));
  assert.ok(msgs.some((m) => m.severity === 'error' && m.to === '/workspace'));
});

test('PDF client: 성공 · 서버 오류 · 연결 실패는 사용자 문구로 바뀌고 원문 오류는 노출하지 않는다', async () => {
  const rm = generateReport(buildReportInput(full(), { now: () => new Date('2026-10-08T00:00:00Z') })) as { status: 'ok'; renderModel: never };
  const mk = (status: number, body: unknown, headers: Record<string, string> = {}) => async () => ({ ok: status < 400, status, headers: { get: (k: string) => headers[k] ?? null }, blob: async () => new Blob(['%PDF']), json: async () => body });
  const ok = await requestPdf(rm.renderModel, { fetch: mk(200, null, { 'x-report-pages': '11', 'x-report-font': 'ttf-embedded' }) });
  assert.ok(ok.ok && ok.pages === 11 && ok.font === 'ttf-embedded' && /\.pdf$/.test(ok.filename));
  const e500 = await requestPdf(rm.renderModel, { fetch: mk(500, { error: { code: 'pdf-render-failed', message: 'Traceback secret' } }) });
  assert.ok(!e500.ok && e500.code === 'pdf-render-failed' && !e500.message.includes('Traceback'));
  const e422 = await requestPdf(rm.renderModel, { fetch: mk(422, { error: { code: 'unsupported-render-model' } }) });
  assert.ok(!e422.ok && e422.code === 'unsupported-render-model');
  const down = await requestPdf(rm.renderModel, { fetch: async () => { throw new Error('ECONNREFUSED'); } });
  assert.ok(!down.ok && down.code === 'backend-unreachable' && !down.message.includes('ECONNREFUSED'));
  const bad = await requestPdf(rm.renderModel, { fetch: async () => ({ ok: false, status: 502, headers: { get: () => null }, blob: async () => new Blob(), json: async () => { throw new Error('html'); } }) });
  assert.ok(!bad.ok && bad.code === 'backend-unreachable');
});

test('기업을 선택하기 전에는 Report 생성 · Preview · Export 없이 공통 빈 상태만 보인다', () => {
  const html = h.renderReport(null, { noCompany: true });
  assert.match(html, /기업을 선택해 기업가치평가를 시작하세요\./);
  assert.match(html, /href="\/workspace"[^>]*>기업 검색 · 선택/);
  assert.doesNotMatch(html, /Generate Report|Download PDF|AI 서술|Saved reports|valuflow-report|2,346억원|삼성전자/);
});

test('화면: 기업 선택 후 빈 Project → fixture 로 채우지 않고 안내만, Preview 없음 (hidden fixture fallback 0)', () => {
  const html = h.renderReport(null);
  assert.match(html, /아직 생성된 Report 가 없습니다/);
  assert.match(html, /샘플 데이터로 자동 대체하지 않습니다/);
  assert.ok(!html.includes('valuflow-report') && !html.includes('2,346억원'));
  assert.match(html, /Generate Report/);
  assert.match(html, /<button[^>]*disabled[^>]*>Download PDF/);
  assert.match(html, /AI 서술 없음/);
});

test('화면: 생성 전 Blocked → 오류 목록과 이동 링크, Export 비활성', () => {
  const html = h.renderReport(null, { blocked: true });
  assert.match(html, /Report 를 만들 수 없습니다 \(Blocked\)/);
  assert.match(html, /Blocked<\/span>/);
  assert.match(html, /href="\/workspace"/);
  assert.match(html, /<button[^>]*disabled[^>]*>Download PDF/);
});

test('화면: 생성된 Preview — 실제 ReportDocument 값 · [S#] marker · Sources · 학습용 고지 · Export 활성', () => {
  const html = h.renderReport(persisted(full()), { generated: true });
  assert.ok(html.includes('class="valuflow-report"') && html.includes('2,346억원') && html.includes('214,556원') && html.includes('8.14%'));
  assert.ok(html.includes('data-marker="S3"') && html.includes('id="src-S3"') && html.includes('class="sources"'));
  assert.match(html, /Learning \/ Demonstration Data/);
  assert.ok(!/<button[^>]*disabled[^>]*>Download PDF/.test(html), 'PDF 버튼 활성');
  assert.match(html, /ValuFlow_.+_Valuation_2026-10-08\.pdf/);
  assert.match(html, /Regenerate Report/);
  assert.match(html, /Snapshot/);
  assert.ok(!html.includes('older project snapshot'), '같은 snapshot 이면 stale 배너 없음');
});

test('화면: stale snapshot 배너와 Regenerate', () => {
  const html = h.renderReport(persisted(full()), { generated: true, staleSnapshot: true });
  assert.match(html, /Report preview is based on an older project snapshot\./);
  assert.match(html, />Regenerate</);
  assert.ok(html.includes('2,346억원'), '이전 Preview 는 유지되지만 오래됐음을 알린다');
});

test('화면: 선택 section 은 토글 가능, 필수 section 은 토글 목록에 없다', () => {
  const html = h.renderReport(persisted(full()));
  for (const s of OPTIONAL_SECTIONS) assert.ok(html.includes(s.label.replace('&', '&amp;')), s.label);
  for (const req of ['Executive Summary', 'WACC', 'DCF Valuation', 'Sources']) assert.ok(!new RegExp(`type="checkbox"[^>]*/>${req}`).test(html), req);
  assert.match(html, /필수 section.*숨길 수 없습니다/);
  const hidden = h.renderReport(persisted(full()), { generated: true, hideOptional: ['sensitivity', 'scenario'] });
  assert.ok(!hidden.includes('id="sec-sensitivity"') && !hidden.includes('id="sec-scenario"') && hidden.includes('id="sec-dcf"'));
  assert.match(hidden, /제외된 section/);
});

test('화면: AI 분석 선택 — current 는 기본 선택, stale 은 경고와 함께 표시 (자동 선택 안 함)', () => {
  const p = full();
  const cur = analysis(sid(p), 'a-cur');
  const stale = analysis('ctx-old', 'a-old');
  let session = emptySession;
  session = addTurn(session, turn('tc', cur));
  session = addTurn(session, turn('ts', stale));
  const html = h.renderReport(persisted(p), { session });
  assert.match(html, /Current project snapshot/);
  assert.match(html, /Stale: 이전 Project 상태 기준/);
  const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
  assert.equal(radios.length, 3);
  const checked = radios.filter((r) => /checked/.test(r));
  assert.equal(checked.length, 1);
  assert.equal(radios.indexOf(checked[0]!), 2, '가장 오래된 current(tc)가 기본: 목록은 최근 순(ts, tc)이고 AI 없음이 첫 항목');
});

test('화면: PDF 상태 — 생성 중 · 완료 · 오류(재시도)', () => {
  const p = persisted(full());
  assert.match(h.renderReport(p, { generated: true, pdf: { status: 'generating' } }), /PDF 생성 중…/);
  assert.match(h.renderReport(p, { generated: true, pdf: { status: 'ready', filename: 'x.pdf', pages: 11, font: 'ttf-embedded', reportId: 'rpt-1' } }), /PDF 를 내려받았습니다 \(11쪽\)/);
  const err = h.renderReport(p, { generated: true, pdf: { status: 'error', code: 'backend-unreachable', message: 'ValuFlow 서버에 연결할 수 없습니다.' } });
  assert.match(err, /role="alert"[^>]*>ValuFlow 서버에 연결할 수 없습니다\./);
  assert.match(err, /다시 시도/);
  assert.match(h.renderReport(p, { generated: true, pdf: { status: 'ready', filename: 'x.pdf', pages: 3, font: 'cid-fallback', reportId: 'r' } }), /대체 폰트/);
});

test('Report 화면은 Project 를 바꾸지 않는다 (렌더 전후 저장 상태 동일)', () => {
  const p = full();
  const before = persisted(p);
  h.renderReport(before, { generated: true });
  assert.equal(persisted(p), before);
  assert.ok(withSelectedCompany);
});
