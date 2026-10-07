import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as a } from '../data/step04PracticeAssumptions.ts';
import { runSensitivity, type SensitivityResult } from './sensitivity.ts';
import { runValuation } from './engine.ts';
import { runDcf } from './dcf.ts';
import { ValuationError } from './models.ts';

const WACCS = [0.075, 0.08, 0.081375, 0.085, 0.09];
const GS = [0.01, 0.015, 0.02, 0.025, 0.03];
const approx = (x: number, y: number, e = 0.006) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);

const matrix = runSensitivity(a, WACCS, GS);
const cell = (m: SensitivityResult, wacc: number, g: number) => {
  const c = m.cells[m.waccValues.indexOf(wacc)][m.terminalGrowthValues.indexOf(g)];
  assert.ok(c, `cell ${wacc}/${g}`);
  return c;
};

test('구조: cells[i][j] = waccValues[i] × terminalGrowthValues[j]', () => {
  assert.equal(matrix.cells.length, WACCS.length);
  matrix.cells.forEach((row, i) => {
    assert.equal(row.length, GS.length);
    row.forEach((c, j) => {
      assert.equal(c.wacc, WACCS[i]);
      assert.equal(c.terminalGrowth, GS[j]);
    });
  });
  close(matrix.baseWacc, 0.081375);
  assert.equal(matrix.baseTerminalGrowth, 0.02);
});

test('Base Case EV (WACC 8.1375% / g 2%) ≈ 2345.56', () => approx(cell(matrix, 0.081375, 0.02).enterpriseValue, 2345.56));
test('WACC 9% / g 1% EV ≈ 1829.01', () => approx(cell(matrix, 0.09, 0.01).enterpriseValue, 1829.01));
test('WACC 7.5% / g 3% EV ≈ 3144.95', () => approx(cell(matrix, 0.075, 0.03).enterpriseValue, 3144.95));

test('Base Case 는 runValuation 결과와 정확히 일치한다', () => {
  const r = runValuation(a);
  const c = cell(matrix, 0.081375, 0.02);
  close(c.enterpriseValue, r.enterpriseValue);
  close(c.equityValue, r.equityValue);
  close(c.perShareValue, r.perShareValue, 1e-6);
});

test('Equity Value = EV − Net Debt(200)', () => {
  for (const row of matrix.cells) for (const c of row) close(c.equityValue, c.enterpriseValue - 200);
  approx(cell(matrix, 0.081375, 0.02).equityValue, 2145.56);
});

test('Per Share = Equity(억원) × 100,000,000 ÷ 주식 수', () => {
  for (const row of matrix.cells) for (const c of row) close(c.perShareValue, (c.equityValue * 1e8) / a.sharesOutstanding, 1e-6);
  approx(cell(matrix, 0.081375, 0.02).perShareValue, 214556, 0.6);
});

test('Base Case 식별: isBaseCase 는 정확히 한 칸', () => {
  const flagged = matrix.cells.flat().filter((c) => c.isBaseCase);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].wacc, 0.081375);
  assert.equal(flagged[0].terminalGrowth, 0.02);
});

test('축에 base 값이 없으면 isBaseCase 가 하나도 없다', () => {
  const m = runSensitivity(a, [0.07, 0.09], [0.01, 0.03]);
  assert.equal(m.cells.flat().filter((c) => c.isBaseCase).length, 0);
});

test('방향성: 같은 g 에서 WACC ↑ → EV ↓', () => {
  for (let j = 0; j < GS.length; j++) {
    for (let i = 1; i < WACCS.length; i++) {
      assert.ok(matrix.cells[i][j].enterpriseValue < matrix.cells[i - 1][j].enterpriseValue, `g=${GS[j]}, wacc ${WACCS[i - 1]}→${WACCS[i]}`);
    }
  }
});

test('방향성: 같은 WACC 에서 g ↑ → EV ↑', () => {
  for (let i = 0; i < WACCS.length; i++) {
    for (let j = 1; j < GS.length; j++) {
      assert.ok(matrix.cells[i][j].enterpriseValue > matrix.cells[i][j - 1].enterpriseValue, `wacc=${WACCS[i]}, g ${GS[j - 1]}→${GS[j]}`);
    }
  }
});

test('Scenario WACC 는 할인·TV·PV(TV) 모두에 적용된다 (독립 수식과 대조)', () => {
  const fcff = [135.1, 144.306, 150.51824];
  const w = 0.09, g = 0.01;
  const pv = fcff.reduce((s, f, i) => s + f / Math.pow(1 + w, i + 1), 0);
  const tv = (fcff[2] * (1 + g)) / (w - g);
  const expected = pv + tv / Math.pow(1 + w, 3);
  close(cell(matrix, w, g).enterpriseValue, expected, 1e-6);
  // base WACC 가 섞였다면 runDcf 결과와 달라진다
  close(cell(matrix, w, g).enterpriseValue, runDcf(fcff, w, g).enterpriseValue, 1e-6);
});

test('입력을 변경하지 않는다', () => {
  const snapshot = JSON.stringify(a);
  const waccs = [...WACCS];
  runSensitivity(a, waccs, GS);
  assert.equal(JSON.stringify(a), snapshot);
  assert.deepEqual(waccs, WACCS);
});

test('WACC ≤ g 조합은 ValuationError', () => {
  assert.throws(() => runSensitivity(a, [0.02], [0.02]), ValuationError);
  assert.throws(() => runSensitivity(a, [0.075, 0.01], [0.02]), ValuationError);
});

test('빈 / 잘못된 축은 ValuationError', () => {
  assert.throws(() => runSensitivity(a, [], GS), ValuationError);
  assert.throws(() => runSensitivity(a, WACCS, []), ValuationError);
  assert.throws(() => runSensitivity(a, [NaN], GS), ValuationError);
  assert.throws(() => runSensitivity(a, WACCS, [Infinity]), ValuationError);
});

test('잘못된 ValuationInput 은 Sensitivity 에서도 오류', () => {
  assert.throws(() => runSensitivity({ ...a, sharesOutstanding: 0 }, WACCS, GS), ValuationError);
  assert.throws(() => runSensitivity({ ...a, capex: [60] }, WACCS, GS), ValuationError);
});
