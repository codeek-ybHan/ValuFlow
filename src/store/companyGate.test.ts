// 기업 선택 전 빈 상태 · 기업 전환 격리 · 새로고침: 선택한 기업이 없으면 어떤 데이터도 보이지 않고, 기업을 바꾸면 이전 기업의 값이 남지 않는다.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { buildAiContext } from '../ai/context.ts';
import {
  canApplyPractice, emptyProjectState, restoreProjectState, toPersisted, withPracticeAssumptions, withSamsungHistorical, withSelectedCompany, type ProjectState,
} from './projectModel.ts';
import { TEST_COMPANY, withTestCompany } from './testCompany.ts';

type Harness = { renderGate(path: string, persisted: string | null): string };
let h: Harness;
before(() => {
  const out = join(mkdtempSync(join(tmpdir(), 'valuflow-gate-')), 'h.cjs');
  buildSync({ entryPoints: [new URL('../pages/gateHarness.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', logLevel: 'silent', define: { 'import.meta.env': '{}' } });
  h = createRequire(import.meta.url)(out) as Harness;
});

const MESSAGE = '기업을 선택해 기업가치평가를 시작하세요.';
const SK = { ...TEST_COMPANY, corpCode: '00164779', corpName: 'SK하이닉스', stockCode: '000660' };
const calculated = (): ProjectState => withPracticeAssumptions(withSamsungHistorical(withTestCompany(emptyProjectState)));
const persisted = (p: ProjectState) => JSON.stringify(toPersisted(p));
const DATA_MARKERS = /2,346|2,146|214,556|Enterprise Value|Equity Value|Implied Share Price|Sensitivity|Run Valuation|Key Financials|Workflow/;

test('기업 없음 → Dashboard 는 KPI · Workflow 없이 빈 상태와 기업 선택 CTA 만 보인다', () => {
  const html = h.renderGate('/dashboard', null);
  assert.ok(html.includes(MESSAGE));
  assert.match(html, /href="\/workspace"[^>]*>기업 검색 · 선택/);
  assert.doesNotMatch(html, DATA_MARKERS);
  assert.doesNotMatch(html, /삼성전자/);
});

test('기업 없음 → Valuation(모든 단계)과 Analysis 는 Historical · 가정 · 결과 · Sensitivity 없이 빈 상태만 보인다', () => {
  for (const stage of ['historical', 'forecast', 'wacc', 'dcf', 'result', 'validation']) {
    const html = h.renderGate(`/valuation/${stage}`, null);
    assert.ok(html.includes(MESSAGE), stage);
    assert.doesNotMatch(html, DATA_MARKERS, stage);
    assert.doesNotMatch(html, /Run Valuation|학습용 DCF 가정 적용|삼성전자/, stage);
  }
});

test('새로고침: 선택한 기업이 없으면 저장돼 있던 Historical · 가정 · 결과가 있어도 빈 상태다 (이전 세션 기업 표시 금지)', () => {
  const stale = persisted(calculated());
  const withoutCompany = JSON.stringify({ ...JSON.parse(stale), selectedCompany: null });
  assert.deepEqual(restoreProjectState(JSON.parse(withoutCompany)), emptyProjectState);
  for (const path of ['/dashboard', '/valuation/result', '/valuation/validation']) {
    const html = h.renderGate(path, withoutCompany);
    assert.ok(html.includes(MESSAGE), path);
    assert.doesNotMatch(html, DATA_MARKERS, path);
    assert.doesNotMatch(html, /삼성전자|2,346/, path);
  }
  assert.deepEqual(restoreProjectState(null), emptyProjectState);
});

test('기업 선택 → 선택한 기업의 데이터만 표시한다 (빈 화면이 아니다)', () => {
  const html = h.renderGate('/dashboard', persisted(calculated()));
  assert.ok(!html.includes(MESSAGE));
  assert.match(html, /삼성전자/);
  assert.match(html, /Enterprise Value/);
  assert.match(html, /2,346/);
  const noHistorical = h.renderGate('/dashboard', persisted(withTestCompany(emptyProjectState)));
  assert.match(noHistorical, /삼성전자/);
  assert.doesNotMatch(noHistorical, /2,346/, '기업만 선택하면 값을 만들어 보이지 않는다');
  assert.match(noHistorical, /재무데이터를 불러오면/);
});

test('기업 전환 → 이전 기업의 Historical · 가정 · 결과 · 상대가치 · AI context 가 남지 않는다', () => {
  const before = { ...calculated(), relativeInputs: { per: 12 } };
  assert.ok(before.valuationResult && before.sensitivityResult && before.historicalData);
  assert.ok(buildAiContext(before).valuationResult, '전환 전에는 삼성전자의 결과가 AI context 에 있다');
  const after = withSelectedCompany(before, SK);
  assert.equal(after.selectedCompany?.corpName, 'SK하이닉스');
  assert.deepEqual([after.historicalData, after.historicalQuality, after.historicalProvenance, after.valuationAssumptions, after.valuationResult, after.sensitivityResult, after.relativeInputs, after.valuationError], [null, null, null, null, null, null, {}, null]);
  const ctx = buildAiContext(after);
  assert.deepEqual([ctx.company?.name, ctx.historicalData, ctx.valuationResult, ctx.sensitivityResult, ctx.valuationAssumptions], ['SK하이닉스', null, null, null, null]);
  // 전환한 상태를 저장 → 새로고침해도 삼성전자 값이 되살아나지 않는다
  const reloaded = restoreProjectState(JSON.parse(persisted(after)));
  assert.equal(reloaded.selectedCompany?.corpCode, '00164779');
  assert.deepEqual([reloaded.historicalData, reloaded.valuationAssumptions, reloaded.valuationResult], [null, null, null]);
  assert.doesNotMatch(h.renderGate('/dashboard', persisted(after)), /2,346|삼성전자/);
  // 선택 해제도 같다
  const cleared = withSelectedCompany(before, null);
  assert.deepEqual(cleared, emptyProjectState);
  // 같은 기업을 다시 고르면 작업 중이던 값은 유지된다
  assert.equal(withSelectedCompany(before, { ...TEST_COMPANY, fetchedAt: '2026-10-09T00:00:00Z' }).valuationResult, before.valuationResult);
});

test('저장된 Historical 이 다른 기업의 것이면 복원하지 않는다 (기업 전환 직후 새로고침 leak 방지)', () => {
  const live = { ...JSON.parse(persisted(withTestCompany(emptyProjectState))), selectedCompany: SK, historicalProvenance: { source: 'opendart', persisted: false, corpCode: TEST_COMPANY.corpCode, fiscalYears: [2023, 2024, 2025] } };
  const r = restoreProjectState(live);
  assert.deepEqual([r.selectedCompany?.corpName, r.historicalProvenance, r.historicalData], ['SK하이닉스', null, null]);
});

test('학습용 가정은 기업 선택 + Historical load 이후에 사용자가 명시적으로 눌렀을 때만 적용된다', () => {
  assert.equal(canApplyPractice(emptyProjectState), false);
  assert.equal(canApplyPractice(withTestCompany(emptyProjectState)), false, '기업만 선택: 아직 안 된다');
  assert.equal(canApplyPractice(withSamsungHistorical(withTestCompany(emptyProjectState))), true);
  assert.equal(withSamsungHistorical(withTestCompany(emptyProjectState)).valuationAssumptions, null, 'Historical 을 불러와도 가정이 자동으로 들어오지 않는다');
  assert.equal(withTestCompany(emptyProjectState).valuationAssumptions, null, '기업을 선택해도 가정이 자동으로 들어오지 않는다');
  const src = readFileSync(new URL('./project.tsx', import.meta.url), 'utf8');
  assert.match(src, /applyPracticeAssumptions = useCallback\(\(\) => setProject\(\(p\) => \(canApplyPractice\(p\)/, '제공자도 같은 조건으로 막는다');
  const controls = readFileSync(new URL('../components/valuation/ValuationControls.tsx', import.meta.url), 'utf8');
  assert.match(controls, /disabled=\{!practiceReady\}/);
});

test('화면 코드: fixture 를 기업 없이 불러오는 경로가 UI 에 없다 · 기업 변경 시 AI 대화와 Report 를 초기화한다', () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  for (const f of ['../pages/Workspace.tsx', '../components/valuation/HistoricalStage.tsx', '../components/valuation/ValuationControls.tsx']) assert.ok(!read(f).includes('loadSamsung'), f);
  assert.ok(!read('./project.tsx').includes('loadSamsung'));
  assert.match(read('./analyst.tsx'), /setSession\(emptySession\)/);
  assert.match(read('./report.tsx'), /setGenerated\(null\); setBlocked\(null\)/);
  assert.match(read('../components/CompanySearch.tsx'), /기업 선택 해제/);
});
