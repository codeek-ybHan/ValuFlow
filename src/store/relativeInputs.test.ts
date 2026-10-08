// STEP 07-6: 상대가치 입력(relativeInputs)의 상태 동작. Valuation 가정 / 결과와는 별개의 입력이다.
import { test } from 'node:test';
import { TEST_COMPANY, withTestCompany } from './testCompany.ts';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as fixture } from '../data/step04PracticeAssumptions.ts';
import {
  emptyProjectState, restoreProjectState, toPersisted, withPracticeAssumptions, withRelativeInputs, withSamsungHistorical, withValuationReset,
  withForecastInputs,
} from './projectModel.ts';
import { assumptionCompleteness } from './assumptions.ts';

test('초기 상태: relativeInputs 는 비어 있다', () => {
  assert.deepEqual(emptyProjectState.relativeInputs, {});
});

test('withRelativeInputs 는 상대가치 입력만 교체하고 가정 / 결과는 건드리지 않는다', () => {
  const s0 = withPracticeAssumptions(withSamsungHistorical(emptyProjectState));
  const s1 = withRelativeInputs(s0, { netIncome: 150, per: 12 });
  assert.deepEqual(s1.relativeInputs, { netIncome: 150, per: 12 });
  assert.equal(s1.valuationAssumptions, s0.valuationAssumptions);
  assert.equal(s1.valuationResult, s0.valuationResult); // 결과가 stale 처리되지 않는다
  assert.equal(s1.sensitivityResult, s0.sensitivityResult);
  assert.equal(s1.historicalData, s0.historicalData);
});

test('통째로 교체: 비운 칸은 빠진다', () => {
  const s1 = withRelativeInputs(emptyProjectState, { netIncome: 150, per: 12, pbr: 1.5 });
  const s2 = withRelativeInputs(s1, { per: 12 });
  assert.deepEqual(s2.relativeInputs, { per: 12 });
});

test('입력 객체와 이전 상태를 변경하지 않는다 (복사본 저장)', () => {
  const input = { netIncome: 150, per: 12 };
  const s = withRelativeInputs(emptyProjectState, input);
  input.per = 99;
  assert.equal(s.relativeInputs.per, 12);
  assert.deepEqual(emptyProjectState.relativeInputs, {});
});

test('Reset 정책: Valuation 초기화는 가정 · 결과 · 상대가치 입력을 모두 지우고 Historical 은 유지한다', () => {
  const s = withRelativeInputs(withPracticeAssumptions(withSamsungHistorical(emptyProjectState)), { netIncome: 150, per: 12 });
  const r = withValuationReset(s);
  assert.deepEqual(r.relativeInputs, {});
  assert.equal(r.valuationAssumptions, null);
  assert.equal(r.valuationResult, null);
  assert.equal(r.sensitivityResult, null);
  assert.equal(r.historicalData, s.historicalData); // Historical 은 유지
});

test('학습용 적용은 상대가치 입력을 비우지만 Forecast 입력은 지우지 않는다', () => {
  const s = withRelativeInputs(withPracticeAssumptions(emptyProjectState), { netIncome: 150, per: 12 });
  assert.deepEqual(withPracticeAssumptions(s).relativeInputs, {});
  assert.deepEqual(withForecastInputs(s, { ...fixture }).relativeInputs, { netIncome: 150, per: 12 });
});

test('상대가치 입력은 가정 완성도에 영향을 주지 않는다', () => {
  const s = withRelativeInputs(emptyProjectState, { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 });
  assert.equal(assumptionCompleteness(s.valuationAssumptions).complete, false);
  assert.equal(s.valuationAssumptions, null);
});

test('저장 대상에 포함되고 reload 후 그대로 복원된다', () => {
  const s = withRelativeInputs(withPracticeAssumptions(withTestCompany(emptyProjectState)), { netIncome: 150, per: 12, ebitda: 220, evEbitda: 10 });
  const persisted = toPersisted(s);
  assert.deepEqual(persisted.relativeInputs, { netIncome: 150, per: 12, ebitda: 220, evEbitda: 10 });
  const restored = restoreProjectState(JSON.parse(JSON.stringify(persisted)));
  assert.deepEqual(restored.relativeInputs, s.relativeInputs);
  assert.deepEqual(restored.valuationResult, s.valuationResult); // 결과는 입력에서 다시 계산
});

test('옛 저장 형식(relativeInputs 없음)이나 손상된 값은 안전하게 복원된다', () => {
  assert.deepEqual(restoreProjectState({ selectedCompany: TEST_COMPANY, historicalData: null, valuationAssumptions: null }).relativeInputs, {});
  const dirty = restoreProjectState({ selectedCompany: TEST_COMPANY, relativeInputs: { netIncome: 150, per: 'abc', bookEquity: NaN, pbr: null, ebitda: Infinity, evEbitda: 10, hacked: 1 } });
  assert.deepEqual(dirty.relativeInputs, { netIncome: 150, evEbitda: 10 });
  assert.deepEqual(restoreProjectState({ selectedCompany: TEST_COMPANY, relativeInputs: 'oops' }).relativeInputs, {});
  assert.deepEqual(restoreProjectState({ selectedCompany: TEST_COMPANY, relativeInputs: [1, 2] }).relativeInputs, {});
});

test('전체 초기화(emptyProjectState)는 상대가치 입력도 비운다', () => {
  assert.deepEqual(emptyProjectState.relativeInputs, {});
  assert.notEqual(withRelativeInputs(emptyProjectState, { per: 12 }), emptyProjectState);
  assert.deepEqual(emptyProjectState.relativeInputs, {});
});
