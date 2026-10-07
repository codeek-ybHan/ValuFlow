import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as practice } from '../data/step04PracticeAssumptions.ts';
import {
  DCF_FIELD_SOURCE, DCF_INPUT_FIELDS, dcfDraftToForm, dcfWarnings, emptyDcfForm, mergeDcfDrafts, parseDcfForm, sameDcfInputs, terminalSpread,
  type DcfFormValues,
} from './dcfForm.ts';
import { SOURCE_LABELS } from './waccForm.ts';

const practiceForm = (): DcfFormValues => dcfDraftToForm(practice);
const WACC = 0.081375;

// ---- 1. 학습용 fixture 표시 ----
test('학습용 DCF fixture 가 입력 폼 값으로 표시된다 (g 2% / 부채 300 / 현금 100 / 주식 1,000,000)', () => {
  assert.deepEqual(practiceForm(), { terminalGrowth: '2', interestBearingDebt: '300', cash: '100', sharesOutstanding: '1000000' });
});

// ---- 2~5. 입력 변환 ----
test('Terminal Growth % → decimal: 2 → 0.02, 2.5 → 0.025', () => {
  for (const [text, expected] of [['2', 0.02], ['2.5', 0.025], ['2%', 0.02], ['0', 0], ['-1', -0.01]] as const) {
    const f = practiceForm();
    f.terminalGrowth = text;
    const r = parseDcfForm(f);
    assert.ok(r.ok, text);
    assert.equal(r.value.terminalGrowth, expected, text);
  }
});

test('Debt / Cash / Shares 입력 (억원 / 억원 / 주): 콤마와 소수 허용', () => {
  const f = practiceForm();
  f.interestBearingDebt = '1,250.5';
  f.cash = '80';
  f.sharesOutstanding = '5,969,782,550';
  const r = parseDcfForm(f);
  assert.ok(r.ok);
  assert.equal(r.value.interestBearingDebt, 1250.5);
  assert.equal(r.value.cash, 80);
  assert.equal(r.value.sharesOutstanding, 5969782550);
  assert.equal(r.value.terminalGrowth, 0.02);
});

test('폼 → 입력: 학습용 fixture 값으로 되돌아온다', () => {
  const r = parseDcfForm(practiceForm());
  assert.ok(r.ok);
  assert.deepEqual(r.value, { terminalGrowth: 0.02, interestBearingDebt: 300, cash: 100, sharesOutstanding: 1_000_000 });
});

// ---- 7. Validation ----
test('Debt / Cash 는 0 이상, 0 은 허용, 음수는 오류', () => {
  const zero = practiceForm();
  zero.interestBearingDebt = '0';
  zero.cash = '0';
  assert.ok(parseDcfForm(zero).ok);
  const neg = practiceForm();
  neg.interestBearingDebt = '-1';
  neg.cash = '-5';
  const r = parseDcfForm(neg);
  assert.ok(!r.ok);
  assert.match(r.errors.interestBearingDebt!, /0 이상/);
  assert.match(r.errors.cash!, /0 이상/);
});

// ---- 9. Shares ≤ 0 ----
test('Shares Outstanding ≤ 0 은 오류 (0 도 오류)', () => {
  for (const bad of ['0', '-1', '-1000000']) {
    const f = practiceForm();
    f.sharesOutstanding = bad;
    const r = parseDcfForm(f);
    assert.ok(!r.ok, bad);
    assert.match(r.errors.sharesOutstanding!, /0 보다 커야/);
  }
});

// ---- 8. WACC ≤ g ----
test('WACC ≤ g 이면 Terminal Growth 오류 (WACC 를 알고 있을 때)', () => {
  for (const bad of ['8.1375', '9', '20']) {
    const f = practiceForm();
    f.terminalGrowth = bad;
    const r = parseDcfForm(f, { wacc: WACC });
    assert.ok(!r.ok, bad);
    assert.match(r.errors.terminalGrowth!, /WACC\(8\.1375%\)보다 낮아야 합니다/);
  }
  const ok = practiceForm();
  ok.terminalGrowth = '8';
  assert.ok(parseDcfForm(ok, { wacc: WACC }).ok);
});

test('WACC 를 모르면 WACC 비교는 하지 않는다 (실행 시 엔진이 다시 검증한다)', () => {
  const f = practiceForm();
  f.terminalGrowth = '9';
  assert.ok(parseDcfForm(f).ok);
  assert.ok(parseDcfForm(f, { wacc: null }).ok);
});

test('Terminal Growth 는 유한한 숫자여야 한다', () => {
  for (const bad of ['', 'abc', '1e3', 'Infinity']) {
    const f = practiceForm();
    f.terminalGrowth = bad;
    const r = parseDcfForm(f);
    assert.ok(!r.ok, bad);
    assert.ok(r.errors.terminalGrowth, bad);
  }
});

// ---- 10. Net Debt 음수 허용 (입력 단계) ----
test('Cash > Debt 는 오류가 아니다 (Net Debt 가 음수일 수 있다)', () => {
  const f = practiceForm();
  f.interestBearingDebt = '100';
  f.cash = '300';
  const r = parseDcfForm(f);
  assert.ok(r.ok);
  assert.ok(r.value.interestBearingDebt - r.value.cash < 0);
});

test('빈 폼은 4개 필드 모두 입력 필요', () => {
  const r = parseDcfForm(emptyDcfForm());
  assert.ok(!r.ok);
  assert.equal(Object.keys(r.errors).length, DCF_INPUT_FIELDS.length);
  assert.ok(Object.values(r.errors).every((m) => m === '입력 필요'));
});

test('경고: g > 5%, 음수 g, 정수가 아닌 주식 수 (입력은 막지 않는다)', () => {
  const f = practiceForm();
  f.terminalGrowth = '6';
  f.sharesOutstanding = '1000.5';
  assert.ok(parseDcfForm(f).ok);
  const w = dcfWarnings(f);
  assert.match(w.terminalGrowth!, /5% 를 넘습니다/);
  assert.match(w.sharesOutstanding!, /정수가 아닙니다/);
  const neg = practiceForm();
  neg.terminalGrowth = '-1';
  assert.match(dcfWarnings(neg).terminalGrowth!, /음수/);
  assert.deepEqual(dcfWarnings(practiceForm()), {});
});

test('Spread = WACC − g', () => {
  assert.ok(Math.abs(terminalSpread(WACC, 0.02)! - 0.061375) < 1e-12);
  assert.equal(terminalSpread(null, 0.02), null);
  assert.equal(terminalSpread(WACC, null), null);
  assert.ok(terminalSpread(0.02, 0.03)! < 0);
});

test('입력 4개만 폼 필드다 (결과값은 입력이 아니다) / Source 는 Assumption', () => {
  assert.deepEqual([...DCF_INPUT_FIELDS], ['terminalGrowth', 'interestBearingDebt', 'cash', 'sharesOutstanding']);
  assert.deepEqual(Object.keys(emptyDcfForm()).sort(), [...DCF_INPUT_FIELDS].sort());
  for (const f of DCF_INPUT_FIELDS) assert.equal(SOURCE_LABELS[DCF_FIELD_SOURCE[f]], 'Assumption');
});

test('mergeDcfDrafts / sameDcfInputs / 부분 입력', () => {
  const base = practiceForm();
  const snapshot = JSON.stringify(base);
  const merged = mergeDcfDrafts(base, { cash: '150', unknown: 'x' });
  assert.equal(merged.cash, '150');
  assert.equal(JSON.stringify(base), snapshot);
  const full = { terminalGrowth: 0.02, interestBearingDebt: 300, cash: 100, sharesOutstanding: 1_000_000 };
  assert.equal(sameDcfInputs(practice, full), true);
  assert.equal(sameDcfInputs({}, full), false);
  assert.deepEqual(dcfDraftToForm(null), emptyDcfForm());
  assert.deepEqual(dcfDraftToForm({ cash: 5 }), { ...emptyDcfForm(), cash: '5' });
});
