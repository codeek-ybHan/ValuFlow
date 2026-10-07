import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { step04PracticeAssumptions as practice } from '../data/step04PracticeAssumptions.ts';
import { runValuation } from '../valuation/index.ts';
import { TV_HIGH_THRESHOLD, bridgeAdjustment, buildDcfView, buildEquityBridge, terminalValueContribution } from './dcfView.ts';

const approx = (x: number, y: number, e = 0.006) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const result = runValuation(practice);

// ---- 9. DCF Table ----
test('DCF 표: 2026E / 2027E / 2028E 의 FCFF, Discount Factor, PV of FCFF', () => {
  const v = buildDcfView(result, ['2026E', '2027E', '2028E']);
  assert.deepEqual(v.rows.map((r) => r.label), ['2026E', '2027E', '2028E']);
  v.rows.forEach((r, i) => {
    assert.equal(r.fcff, result.fcff[i]);
    assert.equal(r.discountFactor, result.discountFactors[i]);
    assert.equal(r.pvFcff, result.pvFcff[i]);
  });
  approx(v.rows[0].pvFcff, 124.93);
  approx(v.rows[2].pvFcff, 119.03);
  close(v.rows[0].fcff, 135.1);
});

test('Terminal FCFF / Terminal Value / PV(TV) / Enterprise Value 는 엔진 결과 그대로', () => {
  const v = buildDcfView(result, []);
  assert.equal(v.terminalFcff, result.terminalFcff);
  approx(v.terminalValue, 2501.48);
  approx(v.pvTerminalValue, 1978.19);
  approx(v.enterpriseValue, 2345.56);
  assert.deepEqual(v.rows.map((r) => r.label), ['Y1E', 'Y2E', 'Y3E']); // 라벨이 없으면 Y1E…
});

test('EV = Σ PV(FCFF) + PV(TV) 로 이어진다 (표시용 합계)', () => {
  const v = buildDcfView(result, []);
  close(v.sumPvFcff + v.pvTerminalValue, v.enterpriseValue, 1e-9);
});

// ---- 15. Terminal Value Contribution ----
test('Terminal Value Contribution = PV(TV) / EV ≈ 84.3%', () => {
  const c = terminalValueContribution(result)!;
  assert.equal((c * 100).toFixed(1), '84.3');
  close(c, result.pvTerminalValue / result.enterpriseValue);
  assert.equal(buildDcfView(result, []).tvContribution, c);
});

test('TV 비중이 80% 를 넘으면 검토 안내가 붙는다 (참고용)', () => {
  assert.ok(TV_HIGH_THRESHOLD === 0.8);
  assert.match(buildDcfView(result, []).tvNote!, /80% 를 넘어/);
  // 영구성장률을 낮추면 비중이 내려간다 (g = -2% → 약 75.8%). 예측기간 성장률을 높여도 마지막 해 FCFF 가 같이 커져 비중은 낮아지지 않는다.
  const low = runValuation({ ...practice, terminalGrowth: -0.02 });
  assert.ok(terminalValueContribution(low)! < 0.8);
  assert.equal(buildDcfView(low, []).tvNote, null);
});

test('EV 가 0 이하이면 TV 비중은 null 이다 (0 나누기 없음)', () => {
  assert.equal(terminalValueContribution({ pvTerminalValue: 10, enterpriseValue: 0 }), null);
  assert.equal(terminalValueContribution({ pvTerminalValue: -10, enterpriseValue: -5 }), null);
});

test('표시용 모델은 엔진 결과를 변경하지 않는다', () => {
  const snapshot = JSON.stringify(result);
  const frozen = JSON.parse(snapshot);
  const deepFreeze = (o: unknown): void => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } };
  deepFreeze(frozen);
  assert.doesNotThrow(() => { buildDcfView(frozen, ['a', 'b', 'c']); buildEquityBridge(frozen, 1_000_000); terminalValueContribution(frozen); });
  assert.equal(JSON.stringify(result), snapshot);
});

// ---- D. Equity Value Bridge ----
test('Equity Bridge: EV − Net Debt = Equity Value ÷ Shares = Per Share', () => {
  const b = buildEquityBridge(result, practice.sharesOutstanding);
  approx(b.enterpriseValue, 2345.56);
  assert.equal(b.netDebt, 200);
  approx(b.equityValue, 2145.56);
  assert.equal(b.sharesOutstanding, 1_000_000);
  approx(b.perShareValue, 214556, 0.6);
  close(b.enterpriseValue - b.netDebt, b.equityValue);
  assert.equal(b.netCash, false);
});

test('Cash > Debt: Net Debt 가 음수이고 Equity Value 가 EV 보다 크다', () => {
  const r = runValuation({ ...practice, interestBearingDebt: 100, cash: 300 });
  const b = buildEquityBridge(r, practice.sharesOutstanding);
  assert.equal(b.netDebt, -200);
  assert.equal(b.netCash, true);
  assert.ok(b.equityValue > b.enterpriseValue);
  close(b.equityValue, b.enterpriseValue + 200);
});

// ---- 16. 내부 모듈 직접 import 금지 ----
test('DCF 폼 / 표시 모델 / 화면은 valuation 공개 API 만 사용한다', () => {
  for (const rel of ['./dcfForm.ts', './dcfView.ts', '../components/valuation/DcfStage.tsx']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]*valuation[^'"]*)['"]/g)) {
      assert.ok(/(^|\/)valuation(\/index(\.ts)?)?$/.test(m[1]) || /\.\/(workflow|Assumption|useAssumption)/.test(m[1]), `${rel} → ${m[1]}`);
    }
  }
});

// ---- STEP 07-7: Net Debt / Net Cash 표기 (표현만 바꾸고 엔진 값은 그대로) ----
test('Net Debt ≥ 0: "− Net Debt 200" (EV − Net Debt = Equity Value)', () => {
  assert.deepEqual(bridgeAdjustment(200), { operator: '−', label: 'Net Debt', amount: 200 });
  assert.deepEqual(bridgeAdjustment(0), { operator: '−', label: 'Net Debt', amount: 0 });
});

test('Net Debt < 0: "+ Net Cash 200" (이중 부정 없음, 금액은 항상 0 이상)', () => {
  assert.deepEqual(bridgeAdjustment(-200), { operator: '+', label: 'Net Cash', amount: 200 });
  assert.ok(bridgeAdjustment(-0.5).amount >= 0);
});

test('표기가 바뀌어도 값은 같다: EV ∓ 표시 금액 = Equity Value', () => {
  for (const [debt, cash] of [[300, 100], [100, 300], [0, 0], [250, 250]] as const) {
    const r = runValuation({ ...practice, interestBearingDebt: debt, cash });
    const adj = bridgeAdjustment(r.netDebt);
    const shown = adj.operator === '−' ? r.enterpriseValue - adj.amount : r.enterpriseValue + adj.amount;
    close(shown, r.equityValue);
    assert.equal(r.netDebt, debt - cash); // 엔진 값은 부호 있는 Net Debt 그대로
  }
});

test('화면 코드: Equity Bridge 는 bridgeAdjustment 로 연산자와 라벨을 정한다', () => {
  const ui = readFileSync(new URL('../components/valuation/DcfStage.tsx', import.meta.url), 'utf8');
  assert.ok(ui.includes('bridgeAdjustment(bridge.netDebt)'));
  assert.ok(ui.includes('{adj.operator}') && ui.includes('{adj.label}') && ui.includes('adj.amount'));
  assert.ok(!ui.includes('fmtNum(bridge.netDebt'), '부호 있는 Net Debt 를 그대로 출력하지 않는다');
  const result = readFileSync(new URL('../components/valuation/ResultStage.tsx', import.meta.url), 'utf8');
  assert.ok(result.includes('bridgeAdjustment(r.netDebt)'));
});
