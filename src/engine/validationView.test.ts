import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { step04PracticeAssumptions as base } from '../data/step04PracticeAssumptions.ts';
import { runSensitivity, runValuation } from '../valuation/index.ts';
import type { RelativeInput } from '../valuation/index.ts';
import {
  DIRECTION_NOTES, RANGE_DISCLAIMER, buildValidationView, buildValidationWarnings, buildSensitivityView,
  SPREAD_NARROW_THRESHOLD, TV_WARNING_THRESHOLD,
} from './validationView.ts';

const WACCS = [0.075, 0.08, 0.081375, 0.085, 0.09];
const GS = [0.01, 0.015, 0.02, 0.025, 0.03];
const result = runValuation(base);
const sensitivity = runSensitivity(base, WACCS, GS);
const relativeInput: RelativeInput = { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 };
const view = buildValidationView({ assumptions: base, result, sensitivity, relativeInput });
const approx = (x: number, y: number, e = 0.06) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);

// ---- 1. Sensitivity 5×5 ----
test('Sensitivity 는 5×5 (행 = Terminal Growth 5개, 열 = WACC 5개) 로 표시된다', () => {
  const s = view.sensitivity!;
  assert.deepEqual(s.waccValues, WACCS);
  assert.deepEqual(s.terminalGrowthValues, GS);
  assert.equal(s.rows.length, 5);
  for (const row of s.rows) assert.equal(row.cells.length, 5);
  assert.deepEqual(s.rows.map((r) => r.terminalGrowth), GS);
  assert.deepEqual(s.rows[0].cells.map((c) => c.wacc), WACCS);
});

test('각 셀에 EV 가 있고 Equity Value / 주당가치도 제공된다', () => {
  const cell = view.sensitivity!.rows[2].cells[2]; // g 2%, WACC 8.1375%
  assert.ok(Number.isFinite(cell.enterpriseValue) && Number.isFinite(cell.equityValue) && Number.isFinite(cell.perShareValue));
  approx(cell.equityValue, cell.enterpriseValue - 200, 1e-9);
  approx(cell.perShareValue, (cell.equityValue * 1e8) / base.sharesOutstanding, 1e-6);
});

// ---- 2. Base Case ----
test('Base Case 는 한 칸이며 Base WACC 8.1375% / g 2% 와 DCF EV 2345.56 이다', () => {
  const s = view.sensitivity!;
  const flagged = s.rows.flatMap((r) => r.cells).filter((c) => c.isBaseCase);
  assert.equal(flagged.length, 1);
  close(s.base.wacc, 0.081375);
  assert.equal(s.base.terminalGrowth, 0.02);
  assert.equal(s.base.inGrid, true);
  assert.equal(flagged[0].enterpriseValue, result.enterpriseValue);
  approx(flagged[0].enterpriseValue, 2345.56, 0.006);
});

// ---- 3. Base 와 분석 범위 분리 ----
test('Base 값과 분석 범위는 서로 다른 필드로 분리된다', () => {
  const s = view.sensitivity!;
  assert.deepEqual(Object.keys(s.base).sort(), ['inGrid', 'terminalGrowth', 'wacc']);
  assert.deepEqual(Object.keys(s.range).sort(), ['terminalGrowthMax', 'terminalGrowthMin', 'waccMax', 'waccMin']);
  assert.equal(s.range.waccMin, 0.075);
  assert.equal(s.range.waccMax, 0.09);
  assert.equal(s.range.terminalGrowthMin, 0.01);
  assert.equal(s.range.terminalGrowthMax, 0.03);
  // Base 는 범위의 끝값이 아니다 (같은 개념이 아님)
  assert.notEqual(s.base.wacc, s.range.waccMin);
  assert.notEqual(s.base.wacc, s.range.waccMax);
  assert.notEqual(s.base.terminalGrowth, s.range.terminalGrowthMax);
});

test('Base 가 분석 범위 격자에 없으면 inGrid 가 false (Base 칸이 없다)', () => {
  const s = buildSensitivityView(runSensitivity(base, [0.07, 0.09], [0.01, 0.03]), result.enterpriseValue);
  assert.equal(s.base.inGrid, false);
  assert.equal(s.rows.flatMap((r) => r.cells).filter((c) => c.isBaseCase).length, 0);
  close(s.base.wacc, 0.081375);
});

test('화면 코드는 Base 와 분석 범위를 따로 표기하고 방향성 설명을 포함한다', () => {
  const ui = readFileSync(new URL('../components/valuation/SensitivityPanel.tsx', import.meta.url), 'utf8');
  for (const needed of ['Base WACC', 'Base Terminal Growth', '분석 범위', 'DIRECTION_NOTES']) assert.ok(ui.includes(needed), needed);
  assert.deepEqual([...DIRECTION_NOTES], ['WACC ↑ → Value ↓', 'Terminal Growth ↑ → Value ↑']);
});

// ---- 4, 5. 방향성 ----
test('WACC 상승 → EV 하락 (표시 모델의 모든 행에서 왼쪽 → 오른쪽)', () => {
  for (const row of view.sensitivity!.rows) {
    for (let i = 1; i < row.cells.length; i++) assert.ok(row.cells[i].enterpriseValue < row.cells[i - 1].enterpriseValue, `g=${row.terminalGrowth}`);
  }
});

test('Terminal Growth 상승 → EV 상승 (표시 모델의 모든 열에서 위 → 아래)', () => {
  const rows = view.sensitivity!.rows;
  for (let i = 0; i < WACCS.length; i++) {
    for (let j = 1; j < rows.length; j++) assert.ok(rows[j].cells[i].enterpriseValue > rows[j - 1].cells[i].enterpriseValue, `wacc=${WACCS[i]}`);
  }
});

// ---- 6. Scenario 표시 ----
test('Scenario: Bear / Base / Bull 열과 결과, 가정 묶음', () => {
  const cols = view.scenarios.columns;
  assert.deepEqual(cols.map((c) => c.id), ['bear', 'base', 'bull']);
  assert.ok(cols.every((c) => c.ok && c.error === null));
  assert.ok(cols[0].enterpriseValue! < cols[1].enterpriseValue! && cols[1].enterpriseValue! < cols[2].enterpriseValue!);
  assert.equal(cols[1].enterpriseValue, result.enterpriseValue); // Base 열 = DCF 결과
  assert.deepEqual(cols[1].assumptions.revenueGrowth, base.revenueGrowth);
  assert.deepEqual(cols[0].assumptions.revenueGrowth, [0.06, 0.04, 0.02]);
  assert.ok(cols[0].wacc! > cols[1].wacc! && cols[1].wacc! > cols[2].wacc!);
  assert.ok(cols.every((c) => c.description.length > 0)); // 가정 묶음 설명
});

test('Scenario 범위: Bear ~ Bull 의 Equity Value', () => {
  const r = view.scenarios.equityRange!;
  assert.equal(r.min, view.scenarios.columns[0].equityValue);
  assert.equal(r.max, view.scenarios.columns[2].equityValue);
  assert.ok(r.widthRatio! > 0.5);
});

test('계산 불가 시나리오는 열에 오류가 담기고 나머지는 유지된다', () => {
  const risky = { ...base, terminalGrowth: 0.074 };
  const v = buildValidationView({ assumptions: risky, result: runValuation({ ...risky, terminalGrowth: 0.02 }), sensitivity: null, relativeInput: {} });
  const byId = Object.fromEntries(v.scenarios.columns.map((c) => [c.id, c]));
  assert.equal(byId.bull.ok, false);
  assert.match(byId.bull.error!, /영구성장률/);
  assert.equal(byId.bull.equityValue, null);
  assert.equal(byId.base.ok, true);
});

// ---- Relative ----
test('Relative: DCF / PER / PBR / EV·EBITDA 행과 각 결과', () => {
  const rows = view.relative.rows;
  assert.deepEqual(rows.map((r) => r.method), ['DCF', 'PER', 'PBR', 'EV/EBITDA']);
  assert.equal(rows[0].equityValue, result.equityValue);
  assert.equal(rows[1].equityValue, 1800);
  assert.equal(rows[2].equityValue, 1500);
  assert.equal(rows[3].enterpriseValue, 2200);
  assert.equal(rows[3].equityValue, 2000);
  assert.equal(rows[3].perShareValue, 200_000);
  assert.equal(rows[1].evDerived, true);
  assert.equal(rows[3].evDerived, false);
  assert.deepEqual(view.relative.equityRange, { min: 1500, max: 2000 });
});

test('입력이 없는 방법은 incomplete 로 표시되고 값이 만들어지지 않는다', () => {
  const v = buildValidationView({ assumptions: base, result, sensitivity, relativeInput: { netIncome: 150, per: 12 } });
  assert.equal(v.relative.rows[1].status, 'ok');
  for (const r of v.relative.rows.slice(2)) {
    assert.equal(r.status, 'incomplete');
    assert.equal(r.equityValue, null);
  }
  assert.deepEqual(v.relative.equityRange, { min: 1800, max: 1800 });
  const none = buildValidationView({ assumptions: base, result, sensitivity, relativeInput: {} });
  assert.equal(none.relative.equityRange, null);
  assert.equal(none.relative.maxDivergence, null);
});

// ---- 15. Valuation Range ----
test('Valuation Range: Low ≤ Base ≤ High 이고 Base 는 DCF Base 이다', () => {
  const r = view.range;
  assert.equal(r.base.equityValue, result.equityValue);
  assert.ok(r.low.equityValue <= r.base.equityValue && r.base.equityValue <= r.high.equityValue);
  // 이 입력에서 최저는 Bear 시나리오, 최고는 Bull 시나리오
  assert.equal(r.low.label, 'Bear');
  assert.equal(r.high.label, 'Bull');
  assert.equal(r.low.source, 'Scenario');
  approx(r.low.equityValue, 1207.0);
  approx(r.high.equityValue, 3232.7);
});

test('Valuation Range 는 평균 / 중앙값 같은 "정답 가치"를 만들지 않는다', () => {
  assert.deepEqual(Object.keys(view.range).sort(), ['base', 'disclaimer', 'high', 'low', 'spans']);
  const src = readFileSync(new URL('./validationView.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const forbidden of ['average', 'mean', 'median', '/ points.length', '/ all.length']) assert.ok(!src.includes(forbidden), forbidden);
});

test('Valuation Range 안내 문구와 방법별 범위(Sensitivity / Scenario / Relative)', () => {
  assert.equal(view.range.disclaimer, RANGE_DISCLAIMER);
  assert.match(RANGE_DISCLAIMER, /각 방법의 가정과 기준이 다르므로, 범위와 차이를 검토해야 합니다/);
  assert.deepEqual(view.range.spans.map((s) => s.source), ['Sensitivity', 'Scenario', 'Relative']);
  const rel = view.range.spans.find((s) => s.source === 'Relative')!;
  assert.deepEqual([rel.low.label, rel.high.label], ['PBR', 'EV/EBITDA']);
  const sens = view.range.spans.find((s) => s.source === 'Sensitivity')!;
  approx(sens.low.equityValue, 1629.01, 0.006);
  approx(sens.high.equityValue, 2944.95, 0.006);
});

test('Relative / Sensitivity 가 없어도 Range 는 계산된다 (있는 것만)', () => {
  const v = buildValidationView({ assumptions: base, result, sensitivity: null, relativeInput: {} });
  assert.deepEqual(v.range.spans.map((s) => s.source), ['Scenario']);
  assert.equal(v.sensitivity, null);
});

// ---- 14, 17. Warning ----
test('Terminal Value Contribution 80% 초과 → "DCF 가치가 Terminal Value에 크게 의존합니다."', () => {
  assert.equal(TV_WARNING_THRESHOLD, 0.8);
  const w = view.warnings.find((x) => x.code === 'tv-dependence');
  assert.ok(w);
  assert.equal(w.message, 'DCF 가치가 Terminal Value에 크게 의존합니다.');
  assert.equal((view.metrics.terminalValueContribution! * 100).toFixed(1), '84.3');
});

test('Sensitivity 범위가 넓으면 "가정 변화에 따른 가치 변동성이 큽니다."', () => {
  const w = view.warnings.find((x) => x.code === 'wide-sensitivity');
  assert.ok(w);
  assert.equal(w.message, '가정 변화에 따른 가치 변동성이 큽니다.');
  assert.ok(view.metrics.sensitivityRange!.widthRatio! > 0.5);
});

test('경고 규칙: 기준 이하이면 경고가 없다', () => {
  const none = buildValidationWarnings({ terminalValueContribution: 0.6, spread: 0.05, relativeDivergence: 0.2, sensitivityWidth: 0.3, scenarioWidth: 0.4 });
  assert.deepEqual(none, []);
  const nulls = buildValidationWarnings({ terminalValueContribution: null, spread: 0.05, relativeDivergence: null, sensitivityWidth: null, scenarioWidth: null });
  assert.deepEqual(nulls, []);
});

test('경고 규칙: Spread 가 작거나 상대가치가 크게 다르거나 시나리오 폭이 크면 경고', () => {
  assert.equal(SPREAD_NARROW_THRESHOLD, 0.03);
  const w = buildValidationWarnings({ terminalValueContribution: 0.5, spread: 0.02, relativeDivergence: 0.7, sensitivityWidth: 0.1, scenarioWidth: 0.9 });
  assert.deepEqual(w.map((x) => x.code), ['narrow-spread', 'wide-scenario', 'relative-divergence']);
});

test('상대가치가 DCF 와 50% 넘게 다르면 경고가 붙는다', () => {
  const far = buildValidationView({ assumptions: base, result, sensitivity, relativeInput: { netIncome: 500, per: 12 } }); // Equity 6000 vs DCF 2145
  assert.ok(far.metrics.relativeDivergence! > 0.5);
  assert.ok(far.warnings.some((x) => x.code === 'relative-divergence'));
  assert.ok(!view.warnings.some((x) => x.code === 'relative-divergence')); // 1500~2000 vs 2145 → 30% 이내
});

// ---- 16. 실무 검토 지표 ----
test('검토 지표: TV 비중, WACC/g Spread, Sensitivity / Scenario / Relative 범위', () => {
  const m = view.metrics;
  close(m.spread, 0.081375 - 0.02);
  assert.ok(m.terminalValueContribution! > 0.84 && m.terminalValueContribution! < 0.85);
  approx(m.sensitivityRange!.min, 1829.01, 0.006);
  approx(m.sensitivityRange!.max, 3144.95, 0.006);
  assert.ok(m.scenarioRange!.min < result.equityValue && result.equityValue < m.scenarioRange!.max);
  assert.deepEqual(m.relativeRange, { min: 1500, max: 2000 });
});

test('Validation 모델은 입력(결과 / 가정 / Sensitivity)을 변경하지 않는다', () => {
  const snap = JSON.stringify([base, result, sensitivity, relativeInput]);
  buildValidationView({ assumptions: base, result, sensitivity, relativeInput });
  assert.equal(JSON.stringify([base, result, sensitivity, relativeInput]), snap);
});

// ---- 16(번호 다름). 내부 모듈 직접 import 금지 ----
test('Validation 모델 / 화면은 valuation 공개 API 만 사용한다', () => {
  for (const rel of ['./validationView.ts', './relativeForm.ts', '../components/valuation/ValidationStage.tsx', '../components/valuation/SensitivityPanel.tsx', '../components/valuation/ScenarioPanel.tsx', '../components/valuation/RelativePanel.tsx', '../components/valuation/ValidationSummary.tsx']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]*valuation[^'"]*)['"]/g)) {
      assert.ok(/(^|\/)valuation(\/index(\.ts)?)?$/.test(m[1]) || /^\.\/(workflow|Assumption|useAssumption|Sensitivity|Scenario|Relative|Validation)/.test(m[1]), `${rel} → ${m[1]}`);
    }
  }
});
