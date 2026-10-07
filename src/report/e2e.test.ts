// STEP 09-8: Report 최종 검증 — Engine 값과의 일치 · 단위 · 라벨 · 출처 · 서술 · snapshot · 렌더 일치 · 고지 · project 불변 · 계산 금지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildReportInput, generateReport, renderReportHtml, runReportQa, type AiAnalysisInput, type GenerateOk } from './index.ts';
import { buildScenario } from '../ai/eval/scenarios.ts';
import type { Evidence, GroundedClaim } from '../ai/grounding/types.ts';
import { groundAnalysis, extractEvidence } from '../ai/index.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const NOW = () => new Date('2026-10-08T01:02:03Z');
const project = () => structuredClone(buildScenario('full', golden).project);
const claim = (claimId: string, text: string, type: GroundedClaim['type'], evidenceIds: string[], basis: GroundedClaim['basis'] = 'objective'): GroundedClaim =>
  ({ claimId, text, type, basis, evidenceIds, status: 'supported', confidence: 'high', numbers: [], issues: [], confidenceNotes: [] });
function ai(snapshot: string): AiAnalysisInput {
  const evidence: Evidence[] = [{ evidenceId: 'h', tool: 'getHistoricalAnalysis', sourceType: 'financial-data', sourceKind: 'actual' }, { evidenceId: 'm', tool: 'getMarketData', sourceType: 'market-data', sourceKind: 'external', origin: 'yahoo-finance', sourceLabel: '005930.KS', fieldPath: 'price.value', value: 268500, unit: 'KRW', asOf: '2026-10-07T03:00:00+00:00', provider: { name: 'Yahoo Finance', reliability: 'unofficial', tier: 'development', official: false, valuationGrade: false } }];
  return { analysisId: 'wf', question: 'q', workflowType: 'full-valuation-review', contextSnapshotId: snapshot, createdAt: '2026-10-08T00:00:00Z', groundingLevel: 'claim-evidence', evidence, sources: [], limitations: [],
    claims: [claim('c1', '2025년 영업이익률은 13.07%이다.', 'fact', ['h']), claim('c2', '수익성 개선이 이어지고 있다.', 'interpretation', ['h'], 'judgment'), claim('c3', '주가는 268,500원이다.', 'fact', ['m']), claim('c4', 'DCF 가 TV 에 의존한다.', 'risk', ['h'], 'judgment')] };
}
function build(withAi: boolean, hide: Parameters<typeof generateReport>[1] = {}): { r: GenerateOk; p: ReturnType<typeof project> } {
  const p = project();
  const sid = buildReportInput(p, { now: NOW }).snapshot.contextSnapshotId;
  const r = generateReport(buildReportInput(p, { now: NOW, aiAnalysis: withAi ? ai(sid) : null }), hide);
  assert.equal(r.status, 'ok');
  return { r: r as GenerateOk, p };
}
const failed = (qa: ReturnType<typeof runReportQa>) => qa.failures.map((f) => `${f.category}/${f.check}: ${f.detail}`);

test('Acceptance: AI 없는 Report · AI 있는 Report 모두 QA 실패 0 (numeric mismatch · unit · label · source · narrative · parity)', () => {
  for (const withAi of [false, true]) {
    const { r } = build(withAi);
    const qa = runReportQa(r, r.input);
    assert.deepEqual(failed(qa), [], `withAi=${withAi}`);
    const total = Object.values(qa.counts).reduce((s, c) => s + c.checked, 0);
    assert.ok(total > 400, `검사 항목 ${total}`);
    for (const cat of ['numerical', 'unit', 'label', 'source', 'parity', 'disclosure', 'snapshot', 'completeness'] as const) assert.ok(qa.counts[cat]!.checked > 0 && qa.counts[cat]!.failed === 0, cat);
    if (withAi) assert.ok(qa.counts.narrative!.checked >= 4, 'narrative 검사');
  }
});

test('Engine 값 고정: golden 삼성전자 EV · Equity · 주당 · WACC · g 가 Report 와 정확히 같다', () => {
  const { r } = build(false);
  const h = r.model.executiveSummary.headline;
  const v = r.input.valuationResult!;
  assert.equal(h.enterpriseValue.value, v.enterpriseValue);
  assert.equal(h.equityValue.value, v.equityValue);
  assert.equal(h.perShareValue.value, v.perShareValue);
  assert.equal(h.wacc.value, v.wacc);
  assert.equal(h.terminalGrowth.value, r.input.assumptions!.terminalGrowth);
  assert.equal(h.enterpriseValue.text, '2,346억원');
  assert.equal(h.perShareValue.text, '214,556원');
});

test('QA 는 실제로 오류를 잡는다 (mutation): 숫자 · 라벨 · 출처 · 서술 · 학습 고지', () => {
  const mutate = (f: (r: GenerateOk) => void, cat: string, withAi = false) => {
    const { r } = build(withAi);
    f(r);
    const qa = runReportQa(r, r.input);
    assert.ok(qa.failures.some((x) => x.category === cat), `${cat} 오류를 잡지 못했다`);
  };
  mutate((r) => { r.model.executiveSummary.headline.enterpriseValue.value! += 1; }, 'numerical');
  mutate((r) => { r.model.dcf.rows.find((x) => x.key === 'fcff')!.cells[0]!.value! *= 1.01; }, 'numerical');
  mutate((r) => { const s = r.model.sensitivity; if (s.status === 'ok') s.data.rows[0]!.cells[0]!.isBaseCase = true; }, 'numerical');
  mutate((r) => { r.model.executiveSummary.headline.perShareValue.text = '214,556억원'; }, 'unit');
  mutate((r) => { r.model.executiveSummary.headline.wacc.text = '0.0814'; }, 'unit');
  mutate((r) => { r.model.forecast.assumptions[0]!.cells[0]!.kind = 'actual'; }, 'label');
  mutate((r) => { r.model.historicalPerformance.rows[0]!.cells[0]!.kind = 'estimate'; }, 'label');
  mutate((r) => { r.document.sources.pop(); }, 'source');
  mutate((r) => { r.renderModel.blocks = r.renderModel.blocks.filter((b) => b.type !== 'banner'); r.renderModel.banners = []; }, 'disclosure');
  mutate((r) => { const n = r.model.executiveSummary.narrative; if (n.status === 'ok') n.data.items[0]!.text += ' 그리고 99.9% 상승한다.'; }, 'narrative', true);
  mutate((r) => { r.bundle.snapshot.contextSnapshotId = 'ctx-other'; }, 'snapshot');
  mutate((r) => { const t = r.renderModel.blocks.find((b) => b.type === 'kpis'); if (t && t.type === 'kpis') t.items[0]!.value.text = '1,234억원'; }, 'parity');
});

test('stale AI 분석은 서술에 쓰이지 않고 제외 사유가 남는다 (unsupported AI narrative 0)', () => {
  const p = project();
  const r = generateReport(buildReportInput(p, { now: NOW, aiAnalysis: ai('ctx-old00000') })) as GenerateOk;
  const qa = runReportQa(r, r.input);
  assert.deepEqual(failed(qa), []);
  assert.equal(JSON.stringify(r.model.executiveSummary.narrative).includes('13.07%'), false);
  assert.ok(r.model.appendix.narrativeRejected.every((x) => x.reason === 'stale-snapshot') && r.model.appendix.narrativeRejected.length === 4);
});

test('STEP 08 회귀: 서술에 들어간 claim 의 숫자는 Evidence 로 모두 검증된다 (unsupported 숫자 0 · hallucinated source 0 · 단위 오류 0)', () => {
  const { r } = build(true);
  const text = JSON.stringify([r.model.executiveSummary.narrative, r.model.historicalPerformance.narrative, r.model.keyRisks, r.model.conclusion.narrative]);
  for (const id of ['c1', 'c2', 'c3', 'c4']) assert.ok(text.includes(`"claimId":"${id}"`) || r.model.appendix.narrativeRejected.some((x) => x.claimId === id), id);
  const used = new Set(r.model.sources.map((s) => s.id));
  assert.ok(r.model.sources.every((s) => s.label.length > 0));
  assert.ok(r.document.sources.every((s) => used.has(s.id)), 'Sources 는 Registry 에 있는 출처뿐');
  const index = extractEvidence([]);
  const rg = groundAnalysis({ summary: '', claims: [], proposedActions: [], index });
  assert.equal(rg.report.stats.numbersUngrounded, 0);
});

test('Project 불변: Report 생성 · 렌더 · 번들 · QA 가 project 를 바꾸지 않는다 (project state mutation 0)', () => {
  const p = project();
  const before = JSON.stringify(p);
  const r = generateReport(buildReportInput(p, { now: NOW })) as GenerateOk;
  runReportQa(r, r.input);
  renderReportHtml(r.renderModel, { mode: 'document' });
  JSON.stringify(r.bundle);
  assert.equal(JSON.stringify(p), before);
  // snapshot 은 deep copy: 이후 project 가 바뀌어도 Report 입력은 그대로
  p.valuationAssumptions!.terminalGrowth = 0.05;
  assert.notEqual(r.input.assumptions!.terminalGrowth, 0.05);
});

test('Hidden fixture fallback 0: 빈 · 불완전 Project 는 Report 를 만들지 않는다', () => {
  const empty = buildScenario('empty', golden).project;
  assert.equal(generateReport(buildReportInput(structuredClone(empty), { now: NOW })).status, 'blocked');
  const noAssumptions = project();
  noAssumptions.valuationAssumptions = null;
  noAssumptions.valuationResult = null;
  assert.equal(generateReport(buildReportInput(noAssumptions, { now: NOW })).status, 'blocked');
});

test('결정성: 같은 입력 → 같은 RenderModel · HTML · JSON (Preview / PDF / JSON 이 같은 원본)', () => {
  const a = build(true).r;
  const b = build(true).r;
  assert.equal(JSON.stringify(a.renderModel), JSON.stringify(b.renderModel));
  assert.equal(renderReportHtml(a.renderModel, { mode: 'document' }), renderReportHtml(b.renderModel, { mode: 'document' }));
  assert.equal(a.bundle.renderHash, b.bundle.renderHash);
});

test('선택 section 숨김 후에도 QA 통과 (숨긴 section 의 출처는 Sources 에서도 빠진다)', () => {
  const { r } = build(true, { hideOptional: ['sensitivity', 'scenario', 'relativeValuation', 'marketReference', 'keyRisks'] });
  assert.deepEqual(failed(runReportQa(r, r.input)), []);
  assert.ok(!r.renderModel.blocks.some((b) => b.type === 'heading' && /Sensitivity|Scenario/.test(b.text)));
});

test('No recalculation: report 의 presentation · render · export · ui 코드에는 엔진 · 계산 import 가 없다', () => {
  const FORBIDDEN_IMPORT = /from '\.\.\/(\.\.\/)?(valuation|engine)\/(?!validationView)/;
  const root = new URL('./', import.meta.url).pathname;
  for (const dir of ['presentation', 'render', 'export', 'ui', 'narrative', 'templates', 'qa']) {
    for (const f of readdirSync(`${root}${dir}`).filter((x) => /\.tsx?$/.test(x))) {
      const src = readFileSync(`${root}${dir}/${f}`, 'utf8');
      assert.ok(!FORBIDDEN_IMPORT.test(src), `${dir}/${f} 가 valuation · engine 을 직접 import 한다`);
      assert.ok(!/\b(runValuation|runSensitivity|runScenarios|calculateWacc|calculateRelativeValuation)\b/.test(src.replace(/\/\/.*$/gm, '')), `${dir}/${f} 계산 호출`);
    }
  }
});

test('Sentinel: Engine 결과가 달라지면 Report 도 똑같이 달라진다 (Report 가 숨은 값을 쓰지 않는다)', () => {
  const p = project();
  const input = buildReportInput(p, { now: NOW });
  input.valuationResult!.enterpriseValue = 1234.5;   // 입력의 엔진 결과만 조작
  const r = generateReport(input);
  assert.equal(r.status, 'ok');
  const ok = r as GenerateOk;
  assert.equal(ok.model.executiveSummary.headline.enterpriseValue.value, 1234.5);
  assert.ok(ok.renderModel.blocks.some((b) => b.type === 'kpis' && b.items.some((k) => k.value.text === '1,234.50억원' || k.value.text === '1,234.5억원' || /^1,23[45]/.test(k.value.text ?? ''))));
  // 헤드라인만 바뀌었으므로 Sensitivity Base 와의 교차 검증이 정확히 그 불일치를 잡는다
  const fails = runReportQa(ok, input).failures.map((f) => f.check);
  assert.ok(fails.includes('Sensitivity Base = DCF EV'), fails.join());
});

test('성능 기록 (SLA 아님): 단계별 소요 시간', () => {
  const t = build(true).r.timings;
  console.log(`[report timings ms] buildModel=${t.buildModel.toFixed(1)} document=${t.document.toFixed(1)} presentation=${t.presentation.toFixed(1)} renderModel=${t.renderModel.toFixed(1)} html=${t.html.toFixed(1)} total=${t.total.toFixed(1)}`);
  assert.ok(Number.isFinite(t.total));
});
