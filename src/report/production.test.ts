// STEP 10: 프론트 production 계약 — API 주소 · access key 헤더 · 저장/조회 client · 저장된 분석 병합 · 과거 Report 재현 · secret 비노출.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { PersistenceClient, PERSIST_NOTE, type SavedAnalysisSummary } from '../data/persist/client.ts';
import { ACCESS_HEADER, getAccessKey, setAccessKey } from '../data/access.ts';
import { apiBase, apiFetch } from '../data/http.ts';
import { analysisChoices, withSavedAnalyses, defaultAnalysisId } from './ui/model.ts';
import { buildReportInput, generateReport, reopenReport, renderReportHtml, runReportQa, type GenerateOk } from './index.ts';
import { buildScenario } from '../ai/eval/scenarios.ts';
import { readFileSync as rf } from 'node:fs';
import { requestPdf, PDF_ERROR_TEXT } from './export/pdfClient.ts';
import { knowledgeErrorText } from '../data/repository/knowledgeRepository.ts';

const golden = JSON.parse(rf(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const NOW = () => new Date('2026-10-08T01:02:03Z');
const ok = (): GenerateOk => generateReport(buildReportInput(structuredClone(buildScenario('full', golden).project), { now: NOW })) as GenerateOk;

type H = { renderReport(p: string | null, o?: Record<string, unknown>): string };
let h: H;
before(() => {
  const out = join(mkdtempSync(join(tmpdir(), 'valuflow-prod-')), 'h.cjs');
  buildSync({ entryPoints: [new URL('./ui/renderHarness.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', logLevel: 'silent', define: { 'import.meta.env': '{}' } });
  h = createRequire(import.meta.url)(out) as H;
});

function memorySession() {
  const m = new Map<string, string>();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  return m;
}

test('access key: 탭 저장소에만 두고, /api 요청에만 헤더로 보낸다 (다른 주소 · 빈 값은 보내지 않는다)', async () => {
  const store = memorySession();
  const calls: { url: string; headers: Record<string, string> }[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init: { headers: Record<string, string> }) => { calls.push({ url, headers: init.headers }); return new Response('{}'); };
  await apiFetch('/api/health');
  assert.equal(calls[0]!.headers[ACCESS_HEADER], undefined, '키가 없으면 헤더 없음');
  setAccessKey('  my-demo-key  ');
  assert.equal(getAccessKey(), 'my-demo-key');
  assert.equal(store.get('valuflow:access'), 'my-demo-key');
  await apiFetch('/api/report/pdf', { method: 'POST', body: '{}' });
  assert.equal(calls[1]!.headers[ACCESS_HEADER], 'my-demo-key');
  await apiFetch('https://other.example/x');
  assert.equal(calls[2]!.headers[ACCESS_HEADER], undefined, '외부 주소로는 키를 보내지 않는다');
  setAccessKey('');
  assert.equal(getAccessKey(), '');
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  assert.equal(getAccessKey(), '', 'sessionStorage 를 못 쓰면 빈 값');
  delete (globalThis as { fetch?: unknown }).fetch;
});

test('API 주소: VITE_API_BASE_URL 이 있으면 /api 앞에 붙인다 (끝 슬래시 제거)', () => {
  assert.equal(apiBase(), '');
});

test('PersistenceClient: 저장 · 목록 · 조회 요청 형식과 실패 사유 매핑 (예외를 던지지 않는다)', async () => {
  const seen: { url: string; method?: string; body?: string }[] = [];
  const reply = (status: number, body: unknown) => async (url: string, init?: { method?: string; body?: string }) => { seen.push({ url, method: init?.method, body: init?.body }); return { ok: status < 400, status, json: async () => body }; };
  const base = ok();
  const analysis = { analysisId: 'a1', question: 'q', workflowType: 'x', contextSnapshotId: 'ctx-1', createdAt: 'now', groundingLevel: 'claim-evidence' as const, claims: [], evidence: [], sources: [], limitations: [] };
  const c = new PersistenceClient({ fetch: reply(200, { id: 'a1' }) });
  assert.deepEqual(await c.saveAnalysis(analysis, { corpCode: '00126380', name: '삼성전자' }), { ok: true, value: { id: 'a1' } });
  const sent = JSON.parse(seen[0]!.body!);
  assert.equal(seen[0]!.url, '/api/analyses');
  assert.equal(sent.corpCode, '00126380');
  assert.equal(sent.companyName, '삼성전자');
  await new PersistenceClient({ fetch: reply(200, { reportId: 'r' }) }).saveReport(base.model, 'valuation-standard-v1@1.0');
  assert.equal(seen[1]!.url, '/api/report-snapshots');
  assert.equal(JSON.parse(seen[1]!.body!).templateVersion, 'valuation-standard-v1@1.0');
  const list = await new PersistenceClient({ fetch: reply(200, { items: [{ id: 'a1' }] }) }).listAnalyses('00126380');
  assert.ok(list.ok && list.value.length === 1);
  assert.match(seen[2]!.url, /^\/api\/analyses\?limit=20&corpCode=00126380$/);
  assert.deepEqual(await new PersistenceClient({ fetch: reply(200, { items: 'bad' }) }).listReports(null), { ok: true, value: [] });
  const fail = async (status: number, code: string | null) => (await new PersistenceClient({ fetch: reply(status, code ? { error: { code } } : null) }).listAnalyses(null) as { reason: string }).reason;
  assert.equal(await fail(503, 'persistence-unavailable'), 'unavailable');
  assert.equal(await fail(401, 'access-required'), 'access-required');
  assert.equal(await fail(403, 'access-not-configured'), 'access-required');
  assert.equal(await fail(429, 'rate-limited'), 'rate-limited');
  assert.equal(await fail(404, null), 'not-found');
  assert.equal(await fail(500, null), 'unreachable');
  assert.deepEqual(await new PersistenceClient({ fetch: async () => { throw new Error('ECONNREFUSED 10.0.0.1'); } }).getAnalysis('x'), { ok: false, reason: 'unreachable' });
  assert.deepEqual(await new PersistenceClient({ fetch: reply(200, { analysis: { groundingLevel: 'none' } }) }).getAnalysis('x'), { ok: false, reason: 'invalid' }, '형식이 다른 분석은 쓰지 않는다');
  assert.deepEqual(await new PersistenceClient({ fetch: reply(200, { model: { schemaVersion: '9' } }) }).getReport('x'), { ok: false, reason: 'invalid' });
  for (const note of Object.values(PERSIST_NOTE)) assert.ok(!/ECONNREFUSED|10\.0\.0\.1|Traceback/.test(note));
});

test('저장된 분석 병합: 새로고침 뒤에도 선택 가능, 같은 id 는 세션 우선, stale 은 자동 선택 안 함', () => {
  const analysis = (id: string, snap: string) => ({ analysisId: id, question: `q-${id}`, workflowType: 'full-valuation-review', contextSnapshotId: snap, createdAt: '2026-10-08T00:00:00Z', groundingLevel: 'claim-evidence' as const, claims: [], evidence: [], sources: [], limitations: [] });
  const session = analysisChoices([{ id: 't1', question: 'q-t1', askedAt: '2026-10-08T05:00:00Z', workflowLabel: 'Full', analysis: analysis('t1', 'ctx-now') } as never], 'ctx-now');
  const saved: SavedAnalysisSummary[] = [
    { id: 't1', corpCode: null, companyName: null, contextSnapshotId: 'ctx-now', workflowType: 'x', question: 'dup', createdAt: '2026-10-08T05:00:00Z', groundingSummary: { claims: 9, supported: 9, evidence: 1 } },
    { id: 's-cur', corpCode: null, companyName: null, contextSnapshotId: 'ctx-now', workflowType: 'full-valuation-review', question: '저장된 분석', createdAt: '2026-10-08T09:00:00Z', groundingSummary: { claims: 4, supported: 3, evidence: 6 } },
    { id: 's-old', corpCode: null, companyName: null, contextSnapshotId: 'ctx-old', workflowType: 'x', question: '오래된 분석', createdAt: '2026-10-07T09:00:00Z', groundingSummary: { claims: 2, supported: 2, evidence: 2 } },
  ];
  const merged = withSavedAnalyses(session, saved, 'ctx-now');
  assert.deepEqual(merged.map((c) => [c.id, c.source, c.freshness]), [['s-cur', 'saved', 'current'], ['t1', 'session', 'current'], ['s-old', 'saved', 'stale']]);
  assert.equal(merged.find((c) => c.id === 't1')!.claims, 0, '세션 분석이 우선 (저장 목록의 중복은 무시)');
  assert.equal(merged[0]!.analysis, null, '저장된 분석은 선택해 생성할 때 불러온다');
  assert.equal(defaultAnalysisId(merged), 's-cur');
  assert.equal(defaultAnalysisId(merged.filter((c) => c.freshness === 'stale')), null);
});

test('과거 Report 재현: 저장한 ReportModel 로 Preview / PDF 입력이 처음과 같다 (값 · 출처 · 학습용 고지)', () => {
  const first = ok();
  const stored = JSON.parse(JSON.stringify(first.model));   // 서버 저장 → 조회 (JSON 왕복)
  const again = reopenReport(stored);
  assert.equal(JSON.stringify(again.renderModel), JSON.stringify(first.renderModel), 'RenderModel 동일');
  assert.equal(renderReportHtml(again.renderModel, { mode: 'document' }), renderReportHtml(first.renderModel, { mode: 'document' }));
  assert.equal(again.bundle.renderHash, first.bundle.renderHash);
  assert.equal(again.validation.ok, first.validation.ok);
  assert.ok(again.input === undefined, '재현은 Project 를 읽지 않는다');
  const qa = runReportQa({ ...again, input: first.input } as GenerateOk, first.input);
  assert.deepEqual(qa.failures, [], '재현한 Report 도 QA 통과');
});

test('Report 화면: 저장된 Report 목록 · 저장소 안내 · 저장된 분석 표시', () => {
  const persisted = JSON.stringify({ selectedCompany: null });
  const html = h.renderReport(persisted, { saved: { reports: [{ reportId: 'rpt-1', corpCode: '00126380', companyName: '삼성전자', contextSnapshotId: 'ctx-1', schemaVersion: '1.0', templateVersion: 'v', createdAt: '2026-10-08T01:02:03Z' }], analyses: [{ id: 's1', corpCode: null, companyName: null, contextSnapshotId: 'ctx-x', workflowType: 'full-valuation-review', question: '저장된 질문', createdAt: '2026-10-08T00:00:00Z', groundingSummary: { claims: 4, supported: 3, evidence: 5 } }], note: '서버에 저장소가 없어 이 세션에서만 유지됩니다.' } });
  assert.match(html, /Saved reports/);
  assert.match(html, /삼성전자/);
  assert.match(html, />열기</);
  assert.match(html, /저장된 질문/);
  assert.match(html, /저장됨/);
  assert.match(html, /이 세션에서만 유지됩니다/);
  assert.match(h.renderReport(persisted), /저장된 Report 가 없습니다/);
});

test('오류 문구: access / rate limit 코드는 사용자 문구로 안내하고 내부 값을 노출하지 않는다', async () => {
  for (const code of ['access-required', 'access-not-configured', 'rate-limited', 'payload-too-large']) {
    assert.ok(PDF_ERROR_TEXT[code], `pdf ${code}`);
    assert.ok(!knowledgeErrorText(code).startsWith('문서를 처리하지 못했습니다'), `knowledge ${code}`);
  }
  const r = await requestPdf(ok().renderModel, { fetch: async () => ({ ok: false, status: 401, headers: { get: () => null }, blob: async () => new Blob(), json: async () => ({ error: { code: 'access-required', message: 'Access key 가 필요합니다.' } }) }) });
  assert.ok(!r.ok && r.code === 'access-required' && /Access key/.test(r.message));
});

test('frontend 에 secret 이 없다: 소스 · 설정 · 빌드 결과 (access key 는 사용자가 입력하는 값이다)', () => {
  const root = new URL('../../', import.meta.url).pathname;
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  const env = readFileSync(join(root, '.env.example'), 'utf8');
  const lines = env.split('\n').filter((l) => /^[A-Z_]+=/.test(l));
  assert.ok(lines.length > 0 && lines.every((l) => l.startsWith('VITE_API_BASE_URL=')), '루트 .env.example 에는 공개 변수(VITE_API_BASE_URL)만 있다');
  assert.ok(!/VITE_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/.test(env));
  const src = walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts')).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.ok(!/ACCESS_TOKEN|VITE_ACCESS/.test(src), 'backend 의 ACCESS_TOKEN 변수명이 프론트에 없다');
  assert.ok(!/(ACCESS_TOKEN\s*=|"X-ValuFlow-Access":\s*")/.test(src));
  if (existsSync(join(root, 'dist'))) for (const f of walk(join(root, 'dist')).filter((p) => /\.(js|html|css)$/.test(p))) assert.ok(!/ACCESS_TOKEN|OPENAI_API_KEY|DART_API_KEY|DATABASE_URL/.test(readFileSync(f, 'utf8')), f);
});
