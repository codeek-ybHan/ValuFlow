import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { step04PracticeAssumptions as base } from '../data/step04PracticeAssumptions.ts';
import { runValuation, runSensitivity, runScenario, runScenarios, applyOverrides, buildDefaultScenarios, buildScenarioOverrides, DEFAULT_SCENARIO_ADJUSTMENTS } from './index.ts';

const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const approx = (x: number, y: number, e = 0.06) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);

// ---- 7. Scenario 는 runValuation 을 재사용 ----
test('Base 시나리오(override 없음)는 runValuation(base) 와 완전히 같다', () => {
  assert.deepEqual(runScenario(base, {}), runValuation(base));
  assert.deepEqual(runScenario(base), runValuation(base));
});

test('override 가 있는 시나리오 = runValuation(base + override) (별도 계산식 없음)', () => {
  const overrides = { terminalGrowth: 0.025, beta: 1.3 };
  assert.deepEqual(runScenario(base, overrides), runValuation({ ...base, ...overrides }));
});

test('scenario.ts 는 DCF / WACC 계산 함수를 직접 쓰지 않고 runValuation 만 호출한다', () => {
  const src = readFileSync(new URL('./scenario.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(src.includes("import { runValuation } from './engine.ts'"));
  for (const forbidden of ['runDcf', 'calculateTerminalValue', 'discountCashFlow', 'calculateWacc', 'calculateEnterpriseValue', 'calculateFcff', 'runForecast']) {
    assert.ok(!src.includes(forbidden), forbidden);
  }
  const imports = [...new Set([...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]))];
  assert.deepEqual(imports.sort(), ['./engine.ts', './models.ts']);
});

// ---- 8. base input 불변 ----
test('Scenario 는 base input 을 변경하지 않는다 (배열 포함)', () => {
  const snapshot = JSON.stringify(base);
  const overrides = buildScenarioOverrides(base, DEFAULT_SCENARIO_ADJUSTMENTS.bear);
  const overridesSnapshot = JSON.stringify(overrides);
  runScenario(base, overrides);
  runScenarios(base);
  assert.equal(JSON.stringify(base), snapshot);
  assert.equal(JSON.stringify(overrides), overridesSnapshot);
});

test('applyOverrides 는 복제본을 반환하고 override 배열을 공유하지 않는다', () => {
  const growth = [0.1, 0.1, 0.1];
  const next = applyOverrides(base, { revenueGrowth: growth });
  assert.notEqual(next, base);
  assert.notEqual(next.revenueGrowth, growth);
  assert.notEqual(next.capex, base.capex);
  next.capex[0] = 999;
  growth[0] = 0.5;
  assert.equal(base.capex[0], 60);
  assert.equal(next.revenueGrowth[0], 0.1);
  assert.deepEqual(applyOverrides(base, { beta: undefined }), base);
});

// ---- 6. Bear / Base / Bull 결과 ----
test('Bear / Base / Bull: 가정 묶음 정의 (조정량)', () => {
  const [bear, mid, bull] = buildDefaultScenarios(base);
  assert.deepEqual([bear.id, mid.id, bull.id], ['bear', 'base', 'bull']);
  assert.deepEqual(mid.overrides, {});
  // Bear: 성장·마진 하향, CAPEX 상향, 위험 프리미엄 상향, g 하향
  assert.deepEqual(bear.overrides.revenueGrowth, [0.06, 0.04, 0.02]);
  assert.deepEqual(bear.overrides.operatingMargin, [0.12, 0.12, 0.12]);
  assert.deepEqual(bear.overrides.capex, [66, 68.2, 70.4]);
  close(bear.overrides.marketRiskPremium!, 0.07);
  close(bear.overrides.terminalGrowth!, 0.015);
  // Bull: 성장·마진 상향, CAPEX 유지, 위험 프리미엄 하향, g 상향
  assert.deepEqual(bull.overrides.revenueGrowth, [0.1, 0.08, 0.06]);
  assert.deepEqual(bull.overrides.operatingMargin, [0.16, 0.16, 0.16]);
  assert.deepEqual(bull.overrides.capex, [60, 62, 64]);
  close(bull.overrides.marketRiskPremium!, 0.055);
  close(bull.overrides.terminalGrowth!, 0.025);
});

test('Bear / Base / Bull 결과: Bear < Base < Bull 이고 Base 는 2345.56', () => {
  const [bear, mid, bull] = runScenarios(base);
  assert.ok(bear.ok && mid.ok && bull.ok);
  approx(mid.result.enterpriseValue, 2345.56, 0.006);
  approx(bear.result.enterpriseValue, 1407.0);
  approx(bull.result.enterpriseValue, 3432.7);
  assert.ok(bear.result.enterpriseValue < mid.result.enterpriseValue && mid.result.enterpriseValue < bull.result.enterpriseValue);
  assert.ok(bear.result.equityValue < mid.result.equityValue && mid.result.equityValue < bull.result.equityValue);
  assert.ok(bear.result.perShareValue < mid.result.perShareValue && mid.result.perShareValue < bull.result.perShareValue);
});

test('Scenario 의 WACC / g 는 방향대로 움직인다 (Bear: WACC ↑ g ↓, Bull: WACC ↓ g ↑)', () => {
  const [bear, mid, bull] = runScenarios(base);
  assert.ok(bear.ok && mid.ok && bull.ok);
  assert.ok(bear.result.wacc > mid.result.wacc && mid.result.wacc > bull.result.wacc);
  assert.ok((bear.overrides.terminalGrowth ?? 0) < base.terminalGrowth && (bull.overrides.terminalGrowth ?? 0) > base.terminalGrowth);
  close(mid.result.wacc, 0.081375);
});

test('Scenario 는 Sensitivity 와 다르다: 영업 가정까지 바꾼다 (같은 WACC·g 라도 FCFF 가 다르다)', () => {
  const bear = runScenario(base, { revenueGrowth: [0.06, 0.04, 0.02] });
  const baseResult = runValuation(base);
  assert.notDeepEqual(bear.fcff, baseResult.fcff);
  // Sensitivity 는 FCFF 를 고정한다
  const s = runSensitivity(base, [baseResult.wacc], [base.terminalGrowth]);
  close(s.cells[0][0].enterpriseValue, baseResult.enterpriseValue);
});

test('한 시나리오가 계산 불가여도 다른 시나리오 결과는 유지된다', () => {
  // base g 가 높아 Bull(g + 0.5%p)에서 WACC ≤ g 가 되는 경우: WACC(Bull) ≈ 7.7%
  const risky = { ...base, terminalGrowth: 0.074 };
  const out = runScenarios(risky);
  const byId = Object.fromEntries(out.map((o) => [o.id, o]));
  assert.equal(byId.base.ok, true);
  assert.equal(byId.bear.ok, true);
  assert.equal(byId.bull.ok, false);
  assert.match((byId.bull as { error: string }).error, /영구성장률/);
});

test('잘못된 base 입력은 시나리오에서도 ValuationError', () => {
  assert.throws(() => runScenario({ ...base, sharesOutstanding: 0 }), /sharesOutstanding/);
  const out = runScenarios({ ...base, sharesOutstanding: 0 });
  assert.ok(out.every((o) => !o.ok));
});
