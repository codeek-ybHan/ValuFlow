// STEP 07-7: [학습용 DCF 가정 적용] 은 사용자가 입력한 값을 덮어쓰기 전에 확인을 받는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { step04PracticeAssumptions as fixture } from '../data/step04PracticeAssumptions.ts';
import {
  applyPracticeWithConfirmation, emptyProjectState, isPracticeAssumptions, practiceApplyNeedsConfirmation, withAssumptions, withForecastInputs,
  withPracticeAssumptions, withRelativeInputs, withSamsungHistorical, withWaccInputs,
} from './projectModel.ts';
import { assumptionCompleteness } from './assumptions.ts';

const typed = () => withWaccInputs(withForecastInputs(emptyProjectState, {
  currentRevenue: 3336059.38, revenueGrowth: [0.11, 0.09, 0.07], operatingMargin: [0.12, 0.13, 0.14], taxRate: 0.22, depreciation: [500, 510, 520], capex: [900, 910, 920], deltaNwc: [30, 31, 32],
}), { riskFreeRate: 0.035, beta: 0.95, marketRiskPremium: 0.055, preTaxCostOfDebt: 0.04, equityMarketValue: 4_000_000, debtMarketValue: 400_000 });

// ---- 3. confirmation 이 필요한 경우 / 필요 없는 경우 ----
test('아무 입력도 없는 초기 상태에서는 확인 없이 바로 적용한다', () => {
  assert.equal(practiceApplyNeedsConfirmation(emptyProjectState), false);
  assert.equal(practiceApplyNeedsConfirmation(withSamsungHistorical(emptyProjectState)), false); // Historical 만 있어도 가정 입력은 없다
  assert.equal(practiceApplyNeedsConfirmation(withAssumptions(emptyProjectState, {})), false);
});

test('상대가치 입력이 있으면 (가정이 비어 있어도) 지워지므로 확인이 필요하다', () => {
  assert.equal(practiceApplyNeedsConfirmation(withRelativeInputs(emptyProjectState, { per: 12 })), true);
  assert.equal(practiceApplyNeedsConfirmation(withRelativeInputs(withPracticeAssumptions(emptyProjectState), { per: 12 })), true);
});

test('가정에 사용자가 입력한 값이 하나라도 있으면 확인이 필요하다', () => {
  assert.equal(practiceApplyNeedsConfirmation(withAssumptions(emptyProjectState, { beta: 1.2 })), true); // 값 하나
  assert.equal(practiceApplyNeedsConfirmation(typed()), true);
  assert.equal(practiceApplyNeedsConfirmation(withAssumptions(withPracticeAssumptions(emptyProjectState), { ...fixture, cash: 99 })), true); // 학습용에서 일부 수정
});

test('이미 학습용 값 그대로이면 덮어써도 잃는 것이 없으므로 확인하지 않는다', () => {
  assert.equal(practiceApplyNeedsConfirmation(withPracticeAssumptions(emptyProjectState)), false);
});

// ---- 4. 취소 시 기존 입력 유지 ----
test('확인창에서 취소하면 현재 입력이 그대로 유지된다', () => {
  const before = typed();
  const snapshot = JSON.stringify(before);
  const after = applyPracticeWithConfirmation(before, false);
  assert.equal(after, before); // 같은 상태 객체
  assert.equal(JSON.stringify(after), snapshot);
  assert.equal(after.valuationAssumptions!.beta, 0.95);
  assert.equal(isPracticeAssumptions(after.valuationAssumptions), false);
  assert.equal(after.valuationResult, null);
});

// ---- 5. 적용하면 전체 fixture 로 교체 ----
test('"학습용 값 적용" 을 승인하면 STEP 04 fixture 전체로 교체된다 (직접 입력한 값은 남지 않는다)', () => {
  const after = applyPracticeWithConfirmation(typed(), true);
  assert.deepEqual(after.valuationAssumptions, fixture);
  assert.equal(assumptionCompleteness(after.valuationAssumptions).complete, true);
  assert.ok(after.valuationResult);
  assert.notEqual(after.valuationAssumptions!.beta, 0.95);
  assert.notEqual(after.valuationAssumptions!.taxRate, 0.22);
  assert.equal(isPracticeAssumptions(after.valuationAssumptions), true);
});

test('확인이 필요 없는 상태에서는 confirmed 값과 관계없이 바로 적용된다', () => {
  assert.deepEqual(applyPracticeWithConfirmation(emptyProjectState, false).valuationAssumptions, fixture);
  assert.deepEqual(applyPracticeWithConfirmation(emptyProjectState, true).valuationAssumptions, fixture);
});

test('적용은 Historical 은 유지하고 상대가치 입력은 비운다', () => {
  const s = withRelativeInputs(withSamsungHistorical(typed()), { netIncome: 150, per: 12 });
  const after = applyPracticeWithConfirmation(s, true);
  assert.equal(after.historicalData, s.historicalData);
  assert.deepEqual(after.relativeInputs, {});
  assert.equal(applyPracticeWithConfirmation(s, false), s); // 취소하면 아무것도 지워지지 않는다
});

// ---- 6. fixture clone ----
test('적용되는 값은 fixture 의 복사본이다 (이후 수정이 fixture 에 영향을 주지 않는다)', () => {
  const snapshot = JSON.stringify(fixture);
  const after = applyPracticeWithConfirmation(typed(), true);
  assert.notEqual(after.valuationAssumptions, fixture);
  assert.notEqual(after.valuationAssumptions!.revenueGrowth, fixture.revenueGrowth);
  after.valuationAssumptions!.revenueGrowth![0] = 0.99;
  assert.equal(JSON.stringify(fixture), snapshot);
});

// ---- UI 연결 ----
test('UI: 확인이 필요할 때만 대화상자를 띄우고, 문구와 버튼이 요구대로이다', () => {
  const c = readFileSync(new URL('../components/valuation/ValuationControls.tsx', import.meta.url), 'utf8');
  assert.ok(c.includes('practiceApplyNeedsConfirmation(project) ? setConfirming(true) : applyPracticeAssumptions()'));
  assert.ok(c.includes('현재 입력이 모두 학습용 값으로 교체됩니다. 계속하시겠습니까?'));
  assert.ok(c.includes('cancelLabel="취소"') && c.includes('confirmLabel="학습용 값 적용"'));
  assert.ok(c.includes('onCancel={() => setConfirming(false)}'), '취소는 상태를 바꾸지 않는다');
  assert.ok(/onConfirm=\{\(\) => \{ setConfirming\(false\); applyPracticeAssumptions\(\); \}\}/.test(c));
  const d = readFileSync(new URL('../components/ConfirmDialog.tsx', import.meta.url), 'utf8');
  for (const needed of ['role="alertdialog"', 'aria-modal="true"', "e.key === 'Escape'", 'cancelRef.current?.focus()']) assert.ok(d.includes(needed), needed);
});
