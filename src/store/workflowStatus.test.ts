// STEP 07-7: 워크플로 상태, Dashboard 진행 상태, 출처 표기. 상태는 하드코딩이 아니라 실제 PROJECT 상태에서 계산된다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { step04PracticeAssumptions as fixture } from '../data/step04PracticeAssumptions.ts';
import {
  emptyProjectState, withAssumptions, withDcfInputs, withForecastInputs, withPracticeAssumptions, withSamsungHistorical, withValuationRun,
  withSensitivityRun, withWaccInputs, withResultsCleared, withRelativeInputs, type ProjectState,
} from './projectModel.ts';
import { assumptionBasis, buildWorkflowProgress, describeBasis, stageStatuses } from './workflowStatus.ts';
import { navActive } from '../components/navActive.ts';
import { parseForecastForm, forecastDraftToForm } from '../engine/forecastForm.ts';
import { parseWaccForm, waccDraftToForm } from '../engine/waccForm.ts';
import { parseDcfForm, dcfDraftToForm } from '../engine/dcfForm.ts';

const forecast = () => { const r = parseForecastForm(forecastDraftToForm(fixture)); assert.ok(r.ok); return r.value; };
const wacc = () => { const r = parseWaccForm(waccDraftToForm(fixture)); assert.ok(r.ok); return r.value; };
const dcf = () => { const r = parseDcfForm(dcfDraftToForm(fixture)); assert.ok(r.ok); return r.value; };
const progress = (s: ProjectState) => Object.fromEntries(buildWorkflowProgress(s).map((r) => [r.key, r.display]));
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---- 1. Dashboard progress 가 실제 상태에서 계산된다 ----
test('초기 상태: 모든 단계가 NOT STARTED', () => {
  const p = progress(emptyProjectState);
  assert.deepEqual(p, { historical: 'NOT STARTED', forecast: 'NOT STARTED', wacc: 'NOT STARTED', dcf: 'NOT STARTED', valuation: 'NOT STARTED', sensitivity: 'NOT STARTED', validation: 'NOT STARTED' });
});

test('단계를 진행할 때마다 상태가 바뀐다 (Historical → Forecast → WACC → DCF → 계산)', () => {
  let s = withSamsungHistorical(emptyProjectState);
  assert.equal(progress(s).historical, 'LOADED');
  assert.equal(progress(s).forecast, 'NOT STARTED');

  s = withForecastInputs(s, forecast());
  assert.deepEqual([progress(s).forecast, progress(s).wacc, progress(s).dcf, progress(s).valuation], ['READY', 'NOT STARTED', 'NOT STARTED', 'INCOMPLETE']);

  s = withWaccInputs(s, wacc());
  assert.deepEqual([progress(s).forecast, progress(s).wacc, progress(s).dcf, progress(s).valuation], ['READY', 'READY', 'NOT STARTED', 'INCOMPLETE']);

  s = withDcfInputs(s, dcf());
  assert.deepEqual([progress(s).dcf, progress(s).valuation, progress(s).sensitivity, progress(s).validation], ['READY', 'READY', 'READY', 'NOT STARTED']);

  s = withSensitivityRun(withValuationRun(s));
  assert.deepEqual(progress(s), { historical: 'LOADED', forecast: 'READY', wacc: 'READY', dcf: 'READY', valuation: 'CALCULATED', sensitivity: 'CALCULATED', validation: 'READY' });
});

test('섹션에 일부만 입력되면 INCOMPLETE (Forecast 7개 중 일부)', () => {
  const s = withAssumptions(emptyProjectState, { currentRevenue: 1500, taxRate: 0.25 });
  assert.equal(stageStatuses(s).forecast, 'INCOMPLETE');
  assert.equal(stageStatuses(s).wacc, 'NOT STARTED');
  assert.equal(stageStatuses(s).result, 'INCOMPLETE');
});

test('Workflow 행: 7줄, 올바른 이동 경로', () => {
  const rows = buildWorkflowProgress(emptyProjectState);
  assert.deepEqual(rows.map((r) => r.label), ['Historical', 'Forecast', 'WACC', 'DCF / Equity', 'Valuation', 'Sensitivity', 'Validation']);
  assert.deepEqual(rows.map((r) => r.to), ['/valuation/historical', '/valuation/forecast', '/valuation/wacc', '/valuation/dcf', '/valuation/result', '/valuation/validation', '/valuation/validation']);
});

// ---- 16. stale 결과가 보이지 않는다 ----
test('입력이 바뀌면 CALCULATED 가 즉시 READY 로 돌아온다 (stale 결과를 보여주지 않는다)', () => {
  const calculated = withPracticeAssumptions(emptyProjectState);
  assert.equal(progress(calculated).valuation, 'CALCULATED');
  const changed = withForecastInputs(calculated, { ...forecast(), taxRate: 0.3 });
  assert.equal(changed.valuationResult, null);
  assert.deepEqual([progress(changed).valuation, progress(changed).sensitivity, progress(changed).validation], ['READY', 'READY', 'NOT STARTED']);
  assert.equal(progress(withResultsCleared(calculated)).valuation, 'READY');
});

test('계산 오류는 ERROR, 입력을 고치면 오류가 사라진다', () => {
  const bad = withValuationRun(withAssumptions(emptyProjectState, { ...fixture, terminalGrowth: 0.09 }));
  assert.equal(progress(bad).valuation, 'ERROR');
  assert.equal(progress(withValuationRun(withAssumptions(bad, fixture))).valuation, 'CALCULATED');
});

test('Dashboard 는 진행 상태와 KPI 를 하드코딩하지 않고 state 에서 읽는다', () => {
  const dash = code(src('../pages/Dashboard.tsx'));
  assert.ok(dash.includes('buildWorkflowProgress(project)'));
  assert.ok(!dash.includes('dashboardWorkflow'));
  assert.ok(!/label="NOT STARTED"/.test(dash), '상태 문구를 직접 쓰지 않는다');
  assert.ok(dash.includes('project.valuationResult'));
  const wf = code(src('../components/valuation/workflow.ts'));
  assert.ok(!wf.includes('dashboardWorkflow') && !wf.includes('NOT STARTED'));
});

test('Stepper 는 단계 상태를 state 에서 읽는다', () => {
  const st = code(src('../components/valuation/ValuationStepper.tsx'));
  assert.ok(st.includes('stageStatuses(project)'));
  for (const label of ['LOADED']) assert.ok(st.includes(label));
});

// ---- 2. Analysis → Validation 네비게이션 ----
test('Analysis 메뉴는 Validation 단계로 연결되고 Valuation 과 동시에 강조되지 않는다', () => {
  assert.deepEqual(navActive('/valuation/validation'), { analysis: true, valuation: false });
  assert.deepEqual(navActive('/valuation/dcf'), { analysis: false, valuation: true });
  assert.deepEqual(navActive('/valuation'), { analysis: false, valuation: true });
  assert.deepEqual(navActive('/analysis'), { analysis: true, valuation: false });
  assert.deepEqual(navActive('/dashboard'), { analysis: false, valuation: false });
  const layout = src('../components/Layout.tsx');
  assert.ok(layout.includes('<NavLink to="/valuation/validation"'));
  // NavLink 는 문자열 className 이면 경로가 맞을 때 'active' 를 덧붙인다 → 함수형으로 덮어써야 두 메뉴가 동시에 강조되지 않는다
  assert.ok(layout.includes("<NavLink to=\"/valuation\" className={() => (nav.valuation ? 'active' : '')}>"));
  assert.ok(layout.includes("<NavLink to=\"/valuation/validation\" className={() => (nav.analysis ? 'active' : '')}>"));
  assert.ok(layout.includes('Analysis'));
  const app = src('../App.tsx');
  assert.ok(app.includes('path="analysis" element={<Navigate to="/valuation/validation" replace />}'));
  assert.ok(!/path="analysis" element=\{<PlannedPage/.test(app), '중복 Analysis placeholder 페이지가 없다');
});

// ---- 7, 11. 실제 Historical 과 학습용 가정의 구분 ----
test('Samsung Historical + 학습용 가정: 서로 다른 출처로 표시된다 (삼성전자 valuation 처럼 보이지 않는다)', () => {
  const s = withPracticeAssumptions(withSamsungHistorical(emptyProjectState));
  const b = describeBasis(s);
  assert.equal(b.historical.label, '삼성전자 · Actual');
  assert.equal(b.assumptions.label, '학습용 가정');
  assert.equal(b.assumptions.basis, 'learning');
  assert.match(b.caution!, /서로 다른 출처/);
  assert.match(b.caution!, /삼성전자의 가치평가로 해석하지 마세요|삼성전자 실제 공시/);
});

test('Samsung Historical + 직접 입력: 학습용이 아니라 사용자 입력', () => {
  const s = withForecastInputs(withSamsungHistorical(emptyProjectState), { ...forecast(), taxRate: 0.22 });
  assert.equal(assumptionBasis(s), 'user');
  const b = describeBasis(s);
  assert.equal(b.assumptions.label, '사용자 입력');
  assert.equal(b.caution, null);
  assert.equal(b.historical.label, '삼성전자 · Actual');
});

test('출처 표기: 가정이 없으면 미입력, Historical 이 없으면 불러오지 않음', () => {
  const b = describeBasis(emptyProjectState);
  assert.deepEqual([b.historical.present, b.historical.label, b.assumptions.label, b.caution], [false, '불러오지 않음', '미입력', null]);
  assert.equal(assumptionBasis(withAssumptions(emptyProjectState, {})), 'none');
});

test('상단 패널은 Historical Data 와 Valuation Assumptions 를 따로 표시한다', () => {
  const c = src('../components/valuation/ValuationControls.tsx');
  for (const needed of ['<dt>Historical</dt>', '<dt>Assumptions</dt>', 'basis.historical.label', 'basis.assumptions.label', 'basis.caution']) assert.ok(c.includes(needed), needed);
});

// ---- 8. 단계별 Source / Basis ----
test('단계별 출처: Historical = Actual, Forecast = Analyst assumption, WACC / DCF / Relative = Assumption', async () => {
  const { STAGE_BASIS } = await import('../components/valuation/workflow.ts');
  assert.match(STAGE_BASIS.historical, /Actual/);
  assert.match(STAGE_BASIS.historical, /공시/);
  assert.equal(STAGE_BASIS.forecast, 'Analyst assumption');
  assert.equal(STAGE_BASIS.wacc, 'Assumption');
  assert.equal(STAGE_BASIS.dcf, 'Assumption');
  assert.match(STAGE_BASIS.validation, /Assumption/);
  assert.match(code(src('../pages/Valuation.tsx')), /STAGE_BASIS\[id\]/);
});

test('Dashboard 의 PROJECT Roadmap 은 구현된 STEP 을 완료로 표시한다 (오래된 진행 상태 없음)', async () => {
  const { projectRoadmap } = await import('../content/roadmap.ts');
  const byCode = Object.fromEntries(projectRoadmap.map((r) => [r.code, r.status]));
  assert.equal(byCode['STEP 05'], 'COMPLETE'); // Valuation Engine
  assert.equal(byCode['STEP 07'], 'COMPLETE'); // Valuation Workspace
  assert.equal(byCode['STEP 06'], 'NEXT'); // 다음 단계: 데이터 파이프라인
  assert.ok(['STEP 08', 'STEP 09', 'STEP 10'].every((c) => byCode[c] === 'LOCKED'));
});
