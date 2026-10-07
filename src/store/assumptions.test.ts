import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as practice } from '../data/step04PracticeAssumptions.ts';
import { assumptionCompleteness, isCompleteAssumptions, DCF_FIELDS, FORECAST_FIELDS, WACC_FIELDS } from './assumptions.ts';

test('가정이 없으면 세 섹션 모두 INCOMPLETE', () => {
  const c = assumptionCompleteness(null);
  assert.deepEqual([c.forecast, c.wacc, c.dcf, c.complete], ['INCOMPLETE', 'INCOMPLETE', 'INCOMPLETE', false]);
  assert.equal(c.missing.forecast.length, FORECAST_FIELDS.length);
  assert.equal(c.missing.wacc.length, WACC_FIELDS.length);
  assert.equal(c.missing.dcf.length, DCF_FIELDS.length);
});

test('학습용 가정은 모두 READY 이고 엔진 입력으로 쓸 수 있다', () => {
  const c = assumptionCompleteness(practice);
  assert.deepEqual([c.forecast, c.wacc, c.dcf, c.complete], ['READY', 'READY', 'READY', true]);
  assert.equal(isCompleteAssumptions(practice), true);
});

test('섹션별 완성도: Forecast / WACC 만 채우면 DCF 만 INCOMPLETE (예: Forecast READY, WACC READY, DCF INCOMPLETE)', () => {
  const { terminalGrowth, interestBearingDebt, cash, sharesOutstanding, ...rest } = practice;
  void terminalGrowth; void interestBearingDebt; void cash; void sharesOutstanding;
  const c = assumptionCompleteness(rest);
  assert.deepEqual([c.forecast, c.wacc, c.dcf, c.complete], ['READY', 'READY', 'INCOMPLETE', false]);
  assert.deepEqual(c.missing.dcf, ['terminalGrowth', 'interestBearingDebt', 'cash', 'sharesOutstanding']);
});

test('필드 하나만 없어도 해당 섹션은 INCOMPLETE 이며 missing 에 이름이 나온다', () => {
  const { beta, ...noBeta } = practice;
  void beta;
  const c = assumptionCompleteness(noBeta);
  assert.equal(c.wacc, 'INCOMPLETE');
  assert.deepEqual(c.missing.wacc, ['beta']);
  assert.equal(c.complete, false);
});

test('연도별 배열이 비었거나 길이가 서로 다르면 Forecast 는 준비되지 않은 것이다', () => {
  assert.equal(assumptionCompleteness({ ...practice, capex: [60, 62] }).forecast, 'INCOMPLETE');
  assert.equal(assumptionCompleteness({ ...practice, revenueGrowth: [] }).forecast, 'INCOMPLETE');
  assert.equal(isCompleteAssumptions({ ...practice, capex: [60, 62] }), false);
});

test('NaN / Infinity 값은 준비된 값이 아니다', () => {
  assert.equal(assumptionCompleteness({ ...practice, beta: NaN }).wacc, 'INCOMPLETE');
  assert.equal(assumptionCompleteness({ ...practice, cash: Infinity }).dcf, 'INCOMPLETE');
  assert.equal(assumptionCompleteness({ ...practice, depreciation: [40, NaN, 44] }).forecast, 'INCOMPLETE');
});

test('섹션의 필드 목록은 ValuationInput 전체를 겹치지 않게 덮는다 (17개)', () => {
  const all = [...FORECAST_FIELDS, ...WACC_FIELDS, ...DCF_FIELDS];
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual([...all].sort(), Object.keys(practice).sort());
});
