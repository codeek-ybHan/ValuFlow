import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { step04PracticeAssumptions as practice } from '../data/step04PracticeAssumptions.ts';
import {
  SOURCE_LABELS, WACC_FIELD_SOURCE, WACC_INPUT_FIELDS, computeWaccPreview, emptyWaccForm, mergeWaccDrafts, parseWaccForm, sameWaccInputs,
  waccContributions, waccDraftToForm, waccWarnings, type WaccFormValues,
} from './waccForm.ts';

const close = (x: number, y: number, e = 1e-12) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const practiceForm = (): WaccFormValues => waccDraftToForm(practice);

// ---- 1. 학습용 WACC fixture 표시 ----
test('학습용 WACC fixture 가 입력 폼 값으로 표시된다', () => {
  const f = practiceForm();
  assert.equal(f.riskFreeRate, '3');
  assert.equal(f.beta, '1.1');
  assert.equal(f.marketRiskPremium, '6');
  assert.equal(f.preTaxCostOfDebt, '5');
  assert.equal(f.equityMarketValue, '900');
  assert.equal(f.debtMarketValue, '300');
});

test('학습용 fixture 의 계산 결과: Ke 9.6% / 세후 Kd 3.75% / 가중치 75% · 25% / WACC 8.1375%', () => {
  const p = computeWaccPreview(practiceForm(), practice.taxRate);
  close(p.costOfEquity!, 0.096);
  close(p.afterTaxCostOfDebt!, 0.0375);
  close(p.equityWeight!, 0.75);
  close(p.debtWeight!, 0.25);
  close(p.wacc!, 0.081375);
});

// ---- 2. % → decimal ----
test('UI % → Engine decimal: Rf 3% → 0.03, MRP 6% → 0.06, Kd 5% → 0.05', () => {
  const r = parseWaccForm(practiceForm());
  assert.ok(r.ok);
  assert.equal(r.value.riskFreeRate, 0.03);
  assert.equal(r.value.marketRiskPremium, 0.06);
  assert.equal(r.value.preTaxCostOfDebt, 0.05);
  assert.equal(r.value.beta, 1.1); // Beta 는 % 가 아니다
  assert.equal(r.value.equityMarketValue, 900);
  assert.equal(r.value.debtMarketValue, 300);
});

// ---- 3. Beta ----
test('Beta 입력: 1.1 → 1.1, 0 허용, 음수는 오류, 빈 값은 입력 필요', () => {
  const ok = (beta: string) => { const f = practiceForm(); f.beta = beta; return parseWaccForm(f); };
  const a = ok('1.1'); assert.ok(a.ok && a.value.beta === 1.1);
  const b = ok('0'); assert.ok(b.ok && b.value.beta === 0);
  const c = ok('-0.2'); assert.ok(!c.ok); assert.match(c.errors.beta!, /0 이상/);
  const d = ok(''); assert.ok(!d.ok); assert.equal(d.errors.beta, '입력 필요');
  const e = ok('abc'); assert.ok(!e.ok); assert.equal(e.errors.beta, '숫자를 입력하세요');
});

// ---- 4~7. 계산 (valuation 공개 API 재사용) ----
test('Cost of Equity = Rf + Beta × MRP: Beta 가 바뀌면 달라진다', () => {
  const f = practiceForm();
  f.beta = '1.5';
  close(computeWaccPreview(f, practice.taxRate).costOfEquity!, 0.03 + 1.5 * 0.06);
});

test('After-tax Cost of Debt = Kd × (1 − Tax Rate)', () => {
  const f = practiceForm();
  f.preTaxCostOfDebt = '8';
  close(computeWaccPreview(f, 0.25).afterTaxCostOfDebt!, 0.06);
  close(computeWaccPreview(f, 0.4).afterTaxCostOfDebt!, 0.048);
});

test('Equity / Debt Weight: E 600, D 400 → 60% / 40%', () => {
  const f = practiceForm();
  f.equityMarketValue = '600';
  f.debtMarketValue = '400';
  const p = computeWaccPreview(f, practice.taxRate);
  close(p.equityWeight!, 0.6);
  close(p.debtWeight!, 0.4);
});

test('WACC Preview: 기여도의 합이 WACC 와 같다', () => {
  const p = computeWaccPreview(practiceForm(), practice.taxRate);
  const c = waccContributions(p)!;
  close(c.equity, 0.072);
  close(c.debt, 0.009375);
  close(c.equity + c.debt, p.wacc!);
});

test('부채가 0 이면 WACC 는 Cost of Equity 와 같다', () => {
  const f = practiceForm();
  f.debtMarketValue = '0';
  const p = computeWaccPreview(f, practice.taxRate);
  close(p.debtWeight!, 0);
  close(p.wacc!, p.costOfEquity!);
});

// ---- 9. E + D = 0 ----
test('E + D = 0 이면 오류이며 가중치와 WACC 는 계산되지 않는다', () => {
  const f = practiceForm();
  f.equityMarketValue = '0';
  f.debtMarketValue = '0';
  const r = parseWaccForm(f);
  assert.ok(!r.ok);
  assert.match(r.errors.capitalStructure!, /0 보다 커야/);
  const p = computeWaccPreview(f, practice.taxRate);
  assert.equal(p.equityWeight, null);
  assert.equal(p.debtWeight, null);
  assert.equal(p.wacc, null);
  assert.notEqual(p.costOfEquity, null); // 다른 구성요소는 자기 입력만으로 계산된다
});

test('E, D 가 개별로 음수이면 각 필드 오류 (E + D 오류는 중복 표시하지 않음)', () => {
  const f = practiceForm();
  f.equityMarketValue = '-100';
  const r = parseWaccForm(f);
  assert.ok(!r.ok);
  assert.match(r.errors.equityMarketValue!, /0 이상/);
  assert.equal(r.errors.capitalStructure, undefined);
});

// ---- 8. Validation ----
test('MRP / Kd 음수, 100% 이상, Rf 범위는 오류', () => {
  const f = practiceForm();
  f.marketRiskPremium = '-1';
  f.preTaxCostOfDebt = '100';
  f.riskFreeRate = '-6';
  const r = parseWaccForm(f);
  assert.ok(!r.ok);
  assert.match(r.errors.marketRiskPremium!, /0% 이상/);
  assert.match(r.errors.preTaxCostOfDebt!, /100% 미만/);
  assert.match(r.errors.riskFreeRate!, /-5% 이상 100% 미만/);
});

test('빈 폼은 6개 필드 모두 입력 필요', () => {
  const r = parseWaccForm(emptyWaccForm());
  assert.ok(!r.ok);
  assert.equal(Object.keys(r.errors).length, WACC_INPUT_FIELDS.length);
});

test('비현실적인 값은 오류가 아니라 경고 (입력을 막지 않는다)', () => {
  const f = practiceForm();
  f.riskFreeRate = '30'; // 3 을 30 으로 잘못 입력한 경우
  f.beta = '4';
  f.marketRiskPremium = '25';
  f.preTaxCostOfDebt = '40';
  assert.ok(parseWaccForm(f).ok);
  const w = waccWarnings(f);
  assert.ok(w.riskFreeRate && w.beta && w.marketRiskPremium && w.preTaxCostOfDebt);
  assert.deepEqual(waccWarnings(practiceForm()), {});
  const neg = practiceForm();
  neg.riskFreeRate = '-0.5';
  assert.match(waccWarnings(neg).riskFreeRate!, /음수 금리/);
});

// ---- 10. Forecast Tax Rate 재사용 ----
test('Tax Rate 는 WACC 입력이 아니다: Forecast 의 세율을 받아 쓴다', () => {
  assert.ok(!(WACC_INPUT_FIELDS as readonly string[]).includes('taxRate'));
  assert.equal('taxRate' in practiceForm(), false);
  const parsed = parseWaccForm(practiceForm());
  assert.ok(parsed.ok);
  assert.equal('taxRate' in parsed.value, false);
});

test('Forecast 세율이 없거나 잘못되면 세후 Kd 와 WACC 는 계산되지 않는다 (기본 세율로 대체하지 않는다)', () => {
  for (const tax of [undefined, 1, -0.1, NaN]) {
    const p = computeWaccPreview(practiceForm(), tax);
    assert.equal(p.afterTaxCostOfDebt, null, String(tax));
    assert.equal(p.wacc, null, String(tax));
    assert.notEqual(p.costOfEquity, null);
    assert.notEqual(p.equityWeight, null);
  }
});

// ---- 입력 / 계산 구분, 기타 ----
test('계산 결과는 입력 폼 필드가 아니다: 폼에는 입력 6개만 있다', () => {
  assert.deepEqual([...WACC_INPUT_FIELDS], ['riskFreeRate', 'beta', 'marketRiskPremium', 'preTaxCostOfDebt', 'equityMarketValue', 'debtMarketValue']);
  assert.deepEqual(Object.keys(emptyWaccForm()).sort(), [...WACC_INPUT_FIELDS].sort());
});

test('Source 라벨: 모든 WACC 입력은 Assumption 이고 확장 가능한 구조다', () => {
  for (const f of WACC_INPUT_FIELDS) assert.equal(SOURCE_LABELS[WACC_FIELD_SOURCE[f]], 'Assumption');
  assert.deepEqual(Object.keys(SOURCE_LABELS).sort(), ['analyst', 'assumption', 'comparable', 'manual', 'market-data']);
});

test('mergeWaccDrafts / sameWaccInputs / 부분 입력', () => {
  const base = practiceForm();
  const snapshot = JSON.stringify(base);
  const merged = mergeWaccDrafts(base, { beta: '1.3', unknown: 'x' });
  assert.equal(merged.beta, '1.3');
  assert.equal(JSON.stringify(base), snapshot);
  assert.equal(sameWaccInputs(practice, { riskFreeRate: 0.03, beta: 1.1, marketRiskPremium: 0.06, preTaxCostOfDebt: 0.05, equityMarketValue: 900, debtMarketValue: 300 }), true);
  assert.equal(sameWaccInputs({}, { riskFreeRate: 0.03, beta: 1.1, marketRiskPremium: 0.06, preTaxCostOfDebt: 0.05, equityMarketValue: 900, debtMarketValue: 300 }), false);
  assert.deepEqual(waccDraftToForm(null), emptyWaccForm());
  assert.deepEqual(waccDraftToForm({ beta: 1.2 }), { ...emptyWaccForm(), beta: '1.2' });
});

test('Preview 는 Valuation 결과를 만들지 않는다: 반환은 WACC 구성요소 5개뿐이다', () => {
  assert.deepEqual(Object.keys(computeWaccPreview(practiceForm(), 0.25)).sort(), ['afterTaxCostOfDebt', 'costOfEquity', 'debtWeight', 'equityWeight', 'wacc']);
});

// ---- 11. private valuation module import 금지 ----
const SRC = fileURLToPath(new URL('..', import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? (name === 'valuation' && dir === SRC.replace(/\/$/, '') ? [] : walk(p)) : [p];
  });
}
test('UI / store / engine 어디에서도 valuation 내부 파일을 직접 import 하지 않는다 (공개 API 만 사용)', () => {
  const offenders: string[] = [];
  for (const file of walk(SRC.replace(/\/$/, '')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]*valuation[^'"]*)['"]/g)) {
      // '../valuation', '../../valuation', '../valuation/index.ts' 만 허용. components/valuation/* 같은 UI 폴더는 제외
      const target = m[1];
      if (/components\/valuation|\.\/(workflow|Stage|Valuation|Forecast|Wacc|Historical|Result|Assumption|useAssumption)/.test(target)) continue;
      if (/(^|\/)valuation(\/index(\.ts)?)?$/.test(target)) continue;
      offenders.push(`${file.replace(SRC, '')} → ${target}`);
    }
  }
  assert.deepEqual(offenders, []);
});

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

test('WACC 화면 / 폼 코드는 Valuation 결과를 만들거나 읽지 않는다 (주석 제외한 코드 기준)', () => {
  const ui = readFileSync(new URL('../components/valuation/WaccStage.tsx', import.meta.url), 'utf8');
  const form = readFileSync(new URL('./waccForm.ts', import.meta.url), 'utf8');
  for (const src of [ui, form]) {
    const code = stripComments(src);
    for (const forbidden of ['valuationResult', 'sensitivityResult', 'runValuation', 'runSensitivity']) assert.ok(!code.includes(forbidden), forbidden);
  }
  for (const needed of ['Calculated WACC', 'Forecast 에서 재사용', 'Assumption', 'Preview']) assert.ok(ui.includes(needed) || form.includes(needed), needed);
});

// ---- 12. 학습용 fallback 제거 ----
test('학습용 WACC / DCF 기본값 fallback 코드가 남아 있지 않다', () => {
  const model = readFileSync(new URL('../store/projectModel.ts', import.meta.url), 'utf8');
  assert.ok(!model.includes('LEARNING_NON_FORECAST_DEFAULTS'));
  assert.ok(!model.includes('usesLearningNonForecastInputs'));
  // 학습용 fixture 는 withPracticeAssumptions 에서만 사용한다
  const uses = model.match(/step04PracticeAssumptions/g) ?? [];
  assert.ok(uses.length >= 1);
  const forecastFn = model.slice(model.indexOf('export function withForecastInputs'), model.indexOf('export function withWaccInputs'));
  assert.ok(!forecastFn.includes('step04PracticeAssumptions'));
  const waccFn = model.slice(model.indexOf('export function withWaccInputs'), model.indexOf('export function withResultsCleared'));
  assert.ok(!waccFn.includes('step04PracticeAssumptions'));
});
