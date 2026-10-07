import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { samsungHistoricalData as h } from '../data/samsungHistorical.ts';
import { step04PracticeAssumptions as practice } from '../data/step04PracticeAssumptions.ts';
import { krwMillionToEok, eokToKrwMillion } from './units.ts';
import {
  buildForecastReference, decimalToPercentText, emptyForecastForm, fieldKey, forecastInputsToForm, forecastLabels, isBasedOnLatestActual,
  mergeDrafts, parseForecastForm, parseNumber, percentToDecimal, sameForecastInputs, FORECAST_YEARS, type ForecastFormValues,
} from './forecastForm.ts';

const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const practiceForm = (): ForecastFormValues => forecastInputsToForm(practice);

// ---- 1. Historical reference ----
test('Historical reference: 성장률 / 마진 / CAPEX / ΔNWC 를 참고값으로 제공한다', () => {
  const ref = buildForecastReference(h)!;
  assert.deepEqual(ref.periods, ['2023A', '2024A', '2025A']);
  const row = (k: string) => ref.rows.find((r) => r.key === k)!;
  assert.equal(row('revenueGrowth').values[0], null);
  assert.equal((row('revenueGrowth').values[1]! * 100).toFixed(1), '16.2');
  assert.equal((row('revenueGrowth').values[2]! * 100).toFixed(1), '10.9');
  assert.deepEqual(row('operatingMargin').values.map((v) => (v! * 100).toFixed(1)), ['2.5', '10.9', '13.1']);
  assert.deepEqual(ref.hints, ['Historical Revenue Growth: +16.2% → +10.9%', 'Historical Operating Margin: 2.5% → 10.9% → 13.1%']);
});

test('Historical reference: 금액 참고값은 억원으로 환산되고 D&A 는 데이터 없음으로 표시된다', () => {
  const ref = buildForecastReference(h)!;
  const row = (k: string) => ref.rows.find((r) => r.key === k)!;
  assert.deepEqual(row('capex').values, [576112.92, 514063.55, 475221.79]);
  assert.equal(row('capex').unit, '억원');
  assert.equal(row('deltaNwc').values[0], null);
  close(row('deltaNwc').values[1]!, 60543.18);
  assert.ok(row('depreciation').values.every((v) => v === null));
  assert.match(row('depreciation').note!, /Data unavailable/);
});

test('Historical reference 는 자동 입력되지 않는다: 빈 폼은 참고값과 무관하게 비어 있다', () => {
  const blank = emptyForecastForm();
  assert.ok(Object.values(blank).flat().every((v) => v === ''));
  buildForecastReference(h);
  assert.ok(Object.values(blank).flat().every((v) => v === ''));
});

test('Historical 이 없으면 reference 가 없다', () => assert.equal(buildForecastReference(null), null));

// ---- 2. Actual / Estimate ----
test('Actual / Estimate 라벨: 2023A–2025A 와 2026E–2028E', () => {
  const ref = buildForecastReference(h)!;
  for (const p of ref.periods) assert.match(p, /^\d{4}A$/);
  const est = forecastLabels(ref.periods);
  assert.deepEqual(est, ['2026E', '2027E', '2028E']);
  for (const p of est) assert.match(p, /^\d{4}E$/);
  assert.equal(est.length, FORECAST_YEARS);
});

test('Historical 이 없으면 Y1E / Y2E / Y3E, 기간 수를 바꾸면 5년도 가능', () => {
  assert.deepEqual(forecastLabels(null), ['Y1E', 'Y2E', 'Y3E']);
  assert.deepEqual(forecastLabels(['2025A'], 5), ['2026E', '2027E', '2028E', '2029E', '2030E']);
});

// ---- 3. 단위 변환 ----
test('KRW million → 억원: 333,605,938 → 3,336,059.38', () => {
  close(krwMillionToEok(333605938), 3336059.38);
  close(krwMillionToEok(100), 1);
  close(eokToKrwMillion(1), 100);
});

test('단위 변환은 원본 historicalData 를 변경하지 않는다', () => {
  const snapshot = JSON.stringify(h);
  krwMillionToEok(h.incomeStatement.revenue[2]);
  buildForecastReference(h);
  assert.equal(JSON.stringify(h), snapshot);
  assert.throws(() => krwMillionToEok(NaN), TypeError);
});

test('Current Revenue: 최근 Actual 매출 환산값과 같으면 "Based on latest actual revenue" 대상', () => {
  const ref = buildForecastReference(h)!;
  assert.equal(ref.latestRevenuePeriod, '2025A');
  close(ref.latestRevenueEok, 3336059.38);
  assert.equal(isBasedOnLatestActual(3336059.38, ref), true);
  assert.equal(isBasedOnLatestActual(1500, ref), false);
  assert.equal(isBasedOnLatestActual(3336059.38, null), false);
});

// ---- 4. UI % → decimal ----
test('UI % → Engine decimal', () => {
  assert.equal(percentToDecimal('8'), 0.08);
  assert.equal(percentToDecimal('8.0'), 0.08);
  assert.equal(percentToDecimal('25'), 0.25);
  assert.equal(percentToDecimal('8.1375'), 0.081375);
  assert.equal(percentToDecimal('8%'), 0.08);
  assert.equal(percentToDecimal(' -10 '), -0.1);
  assert.ok(Number.isNaN(percentToDecimal('')));
  assert.ok(Number.isNaN(percentToDecimal('abc')));
  assert.ok(Number.isNaN(percentToDecimal('1e3')));
  assert.equal(decimalToPercentText(0.08), '8');
  assert.equal(decimalToPercentText(0.081375), '8.1375');
  assert.equal(parseNumber('1,500.5'), 1500.5);
});

test('폼 문자열 → ValuationInput 의 forecast 필드 (% 는 decimal 로)', () => {
  const r = parseForecastForm(practiceForm());
  assert.ok(r.ok);
  assert.deepEqual(r.value.revenueGrowth, [0.08, 0.06, 0.04]);
  assert.deepEqual(r.value.operatingMargin, [0.14, 0.14, 0.14]);
  assert.equal(r.value.taxRate, 0.25);
  assert.deepEqual(r.value.depreciation, [40, 42, 44]);
  assert.deepEqual(r.value.capex, [60, 62, 64]);
  assert.deepEqual(r.value.deltaNwc, [15, 16, 17]);
  assert.equal(r.value.currentRevenue, 1500);
});

// ---- 10. 학습용 fixture 표시 ----
test('학습용 fixture 가 입력 폼 값으로 표시된다 (2026E 8% / 2027E 6% / 2028E 4%, 마진 14%)', () => {
  const f = practiceForm();
  assert.deepEqual(f.revenueGrowth, ['8', '6', '4']);
  assert.deepEqual(f.operatingMargin, ['14', '14', '14']);
  assert.equal(f.taxRate, '25');
  assert.deepEqual(f.depreciation, ['40', '42', '44']);
  assert.deepEqual(f.capex, ['60', '62', '64']);
  assert.deepEqual(f.deltaNwc, ['15', '16', '17']);
  assert.equal(f.currentRevenue, '1500');
  assert.ok(sameForecastInputs(practice, (parseForecastForm(f) as { ok: true; value: typeof practice }).value));
});

// ---- 8, 9. Validation ----
test('invalid growth: -100% 이하는 오류', () => {
  for (const bad of ['-100', '-150']) {
    const f = practiceForm();
    f.revenueGrowth[1] = bad;
    const r = parseForecastForm(f);
    assert.ok(!r.ok);
    assert.match(r.errors[fieldKey('revenueGrowth', 1)], /-100%/);
  }
  const ok = practiceForm();
  ok.revenueGrowth[1] = '-10';
  assert.ok(parseForecastForm(ok).ok, '역성장 -10% 는 허용');
});

test('invalid tax: 0 미만 또는 100% 이상은 오류', () => {
  for (const bad of ['-1', '100', '120']) {
    const f = practiceForm();
    f.taxRate = bad;
    const r = parseForecastForm(f);
    assert.ok(!r.ok, bad);
    assert.match(r.errors.taxRate, /0% 이상 100% 미만/);
  }
  const zero = practiceForm();
  zero.taxRate = '0';
  assert.ok(parseForecastForm(zero).ok);
});

test('Operating Margin 범위, D&A / CAPEX 음수, Current Revenue ≤ 0 검증', () => {
  const f = practiceForm();
  f.operatingMargin[0] = '150';
  f.depreciation[1] = '-1';
  f.capex[2] = '-5';
  f.currentRevenue = '0';
  const r = parseForecastForm(f);
  assert.ok(!r.ok);
  assert.match(r.errors[fieldKey('operatingMargin', 0)], /-100% ~ 100%/);
  assert.match(r.errors[fieldKey('depreciation', 1)], /0 이상/);
  assert.match(r.errors[fieldKey('capex', 2)], /0 이상/);
  assert.match(r.errors.currentRevenue, /0 보다 커야/);
});

test('ΔNWC 는 음수(운전자본 감소)를 허용한다', () => {
  const f = practiceForm();
  f.deltaNwc[0] = '-5';
  assert.ok(parseForecastForm(f).ok);
});

test('빈 입력 / 숫자가 아닌 입력은 필드별 오류', () => {
  const r = parseForecastForm(emptyForecastForm());
  assert.ok(!r.ok);
  assert.equal(Object.keys(r.errors).length, 2 + 5 * FORECAST_YEARS);
  assert.equal(r.errors.currentRevenue, '입력 필요');
  const f = practiceForm();
  f.capex[0] = 'abc';
  const r2 = parseForecastForm(f);
  assert.ok(!r2.ok);
  assert.equal(r2.errors[fieldKey('capex', 0)], '숫자를 입력하세요');
});

test('배열 길이가 예측 기간과 다르면 오류', () => {
  const f = practiceForm();
  f.capex = ['60', '62'];
  const r = parseForecastForm(f);
  assert.ok(!r.ok);
  assert.match(r.errors[fieldKey('capex', 0)], /예측 기간\(3년\)/);
});

test('mergeDrafts: 편집 중인 문자열이 기준 폼을 덮고, 기준 폼은 변경되지 않는다', () => {
  const base = practiceForm();
  const snapshot = JSON.stringify(base);
  const merged = mergeDrafts(base, { 'revenueGrowth.1': '7.5', taxRate: '22' });
  assert.equal(merged.revenueGrowth[1], '7.5');
  assert.equal(merged.taxRate, '22');
  assert.equal(JSON.stringify(base), snapshot);
});

test('Forecast 화면 코드는 Valuation 결과를 읽지 않고 필요한 문구를 포함한다', () => {
  const formSrc = readFileSync(new URL('./forecastForm.ts', import.meta.url), 'utf8');
  for (const forbidden of ['valuationResult', 'sensitivityResult', 'runValuation']) assert.ok(!formSrc.includes(forbidden), forbidden);
  const ui = readFileSync(new URL('../components/valuation/ForecastStage.tsx', import.meta.url), 'utf8');
  for (const needed of ['Based on latest actual revenue', 'Run Valuation', 'Actual', 'Estimate']) assert.ok(ui.includes(needed), needed);
  // 학습용 가정 배지는 단계마다 반복하지 않고 상단 패널 한 곳에서 보여 준다
  const top = readFileSync(new URL('../components/valuation/ValuationControls.tsx', import.meta.url), 'utf8');
  assert.ok(top.includes('학습용 가정'));
});
