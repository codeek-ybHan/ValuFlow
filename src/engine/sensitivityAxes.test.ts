import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as fixture } from '../data/step04PracticeAssumptions.ts';
import { calculateWacc, runSensitivity } from '../valuation/index.ts';
import { buildSensitivityAxes } from './sensitivityAxes.ts';

const close = (a: number[], b: number[]) => {
  assert.equal(a.length, b.length, JSON.stringify(a));
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${JSON.stringify(a)} !≈ ${JSON.stringify(b)}`));
};

test('학습용 가정(Base WACC 8.1375% / g 2%)에서는 기존에 문서화된 격자와 정확히 같다', () => {
  const axes = buildSensitivityAxes(0.081375, 0.02);
  close(axes.waccValues, [0.075, 0.08, 0.081375, 0.085, 0.09]);
  close(axes.terminalGrowthValues, [0.01, 0.015, 0.02, 0.025, 0.03]);
});

test('실제 입력(Base WACC 8.2155% / g 2.5%)에서는 그 Base 를 중심으로 만든다', () => {
  const axes = buildSensitivityAxes(0.082155, 0.025);
  close(axes.waccValues, [0.075, 0.08, 0.082155, 0.085, 0.09]);
  close(axes.terminalGrowthValues, [0.015, 0.02, 0.025, 0.03, 0.035]);
});

test('Base 는 항상 축에 포함되고, 축은 오름차순 · 중복 없음', () => {
  for (const [w, g] of [[0.081375, 0.02], [0.0925, 0.03], [0.1, 0.0], [0.065, -0.01], [0.0777, 0.0213], [0.12, 0.04]] as const) {
    const a = buildSensitivityAxes(w, g);
    assert.ok(a.waccValues.some((x) => Math.abs(x - w) < 1e-9), `WACC ${w}`);
    assert.ok(a.terminalGrowthValues.some((x) => Math.abs(x - g) < 1e-9), `g ${g}`);
    for (const axis of [a.waccValues, a.terminalGrowthValues]) {
      assert.deepEqual([...axis].sort((x, y) => x - y), axis);
      assert.equal(new Set(axis.map((x) => x.toFixed(9))).size, axis.length);
    }
  }
});

test('Base 가 0.5%p 단위 값이어도 Base 를 중복하지 않고 5개를 만든다', () => {
  const axes = buildSensitivityAxes(0.08, 0.02);
  close(axes.waccValues, [0.07, 0.075, 0.08, 0.085, 0.09]);
  close(axes.terminalGrowthValues, [0.01, 0.015, 0.02, 0.025, 0.03]);
});

test('모든 조합에서 WACC > g 이다 (Spread 가 좁아도 계산 불가 조합을 만들지 않는다)', () => {
  for (const [w, g] of [[0.05, 0.04], [0.045, 0.04], [0.0402, 0.04], [0.081375, 0.02], [0.2, 0.19]] as const) {
    const a = buildSensitivityAxes(w, g);
    assert.ok(Math.min(...a.waccValues) > Math.max(...a.terminalGrowthValues), `${w}/${g}: ${JSON.stringify(a)}`);
    assert.ok(a.waccValues.includes(w) && a.terminalGrowthValues.includes(g));
  }
});

test('Spread 가 좁으면 축이 줄어들 수 있지만 Base 칸은 남는다', () => {
  const a = buildSensitivityAxes(0.0402, 0.04);
  assert.ok(a.waccValues.length >= 1 && a.terminalGrowthValues.length >= 1);
  assert.ok(a.terminalGrowthValues.length < 5 || a.waccValues.length < 5);
});

test('Base 자체가 계산 불가(WACC ≤ g)이면 Base 한 칸만 돌려줘 엔진이 같은 오류를 내게 한다', () => {
  assert.deepEqual(buildSensitivityAxes(0.02, 0.03), { waccValues: [0.02], terminalGrowthValues: [0.03] });
  assert.deepEqual(buildSensitivityAxes(0.03, 0.03), { waccValues: [0.03], terminalGrowthValues: [0.03] });
  assert.throws(() => runSensitivity(fixture, [0.02], [0.03]), /영구성장률/);
});

test('생성한 축으로 runSensitivity 를 실행하면 Base 칸이 정확히 하나 표시된다 (학습용 / 실제 입력 모두)', () => {
  const real = { ...fixture, riskFreeRate: 0.035, beta: 0.95, marketRiskPremium: 0.055, preTaxCostOfDebt: 0.04, equityMarketValue: 4_000_000, debtMarketValue: 400_000, taxRate: 0.22, terminalGrowth: 0.025 };
  for (const input of [fixture, real]) {
    const a = buildSensitivityAxes(calculateWacc(input).wacc, input.terminalGrowth);
    const s = runSensitivity(input, a.waccValues, a.terminalGrowthValues);
    assert.equal(s.cells.flat().filter((c) => c.isBaseCase).length, 1);
  }
});

test('입력 값을 변경하지 않는 순수 함수', () => {
  assert.deepEqual(buildSensitivityAxes(0.081375, 0.02), buildSensitivityAxes(0.081375, 0.02));
});
