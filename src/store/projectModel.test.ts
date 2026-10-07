import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions as practice } from '../data/step04PracticeAssumptions.ts';
import { samsungHistoricalData } from '../data/samsungHistorical.ts';
import {
  emptyProjectState, isPracticeAssumptions, restoreProjectState, toPersisted, withAssumptions, withHistoricalData,
  withPracticeAssumptions, withSamsungHistorical, withSensitivityRun, withValuationReset, withValuationRun,
  DEFAULT_TERMINAL_GROWTH_VALUES, DEFAULT_WACC_VALUES, type ProjectState,
} from './projectModel.ts';

const approx = (x: number, y: number, e = 0.006) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);

test('초기 상태: 4개 영역이 모두 비어 있다', () => {
  assert.equal(emptyProjectState.historicalData, null);
  assert.equal(emptyProjectState.valuationAssumptions, null);
  assert.equal(emptyProjectState.valuationResult, null);
  assert.equal(emptyProjectState.sensitivityResult, null);
});

test('삼성전자 불러오기는 historicalData 만 채우고 가정/결과를 건드리지 않는다', () => {
  const s = withSamsungHistorical(emptyProjectState);
  assert.equal(s.historicalData, samsungHistoricalData);
  assert.equal(s.valuationAssumptions, null);
  assert.equal(s.valuationResult, null);
  assert.equal(s.sensitivityResult, null);
});

test('삼성전자 데이터가 있는 상태에서 다시 불러와도 가정/결과는 그대로다', () => {
  const calculated = withPracticeAssumptions(emptyProjectState);
  const s = withSamsungHistorical(calculated);
  assert.equal(s.valuationAssumptions, calculated.valuationAssumptions);
  assert.equal(s.valuationResult, calculated.valuationResult);
  assert.equal(s.sensitivityResult, calculated.sensitivityResult);
});

test('학습용 가정 적용: 가정 설정 + Valuation + Sensitivity 계산, historicalData 는 그대로', () => {
  const withHist = withSamsungHistorical(emptyProjectState);
  const s = withPracticeAssumptions(withHist);
  assert.equal(s.historicalData, samsungHistoricalData);
  assert.deepEqual(s.valuationAssumptions, practice);
  assert.ok(s.valuationResult);
  approx(s.valuationResult.enterpriseValue, 2345.56);
  approx(s.valuationResult.equityValue, 2145.56);
  assert.ok(s.sensitivityResult);
  assert.equal(s.valuationError, null);
  assert.equal(s.sensitivityError, null);
  assert.ok(isPracticeAssumptions(s.valuationAssumptions));
});

test('Sensitivity 기본 축은 5×5 이고 Base 칸이 하나 표시된다', () => {
  const s = withPracticeAssumptions(emptyProjectState);
  assert.deepEqual(s.sensitivityResult!.waccValues, DEFAULT_WACC_VALUES);
  assert.deepEqual(s.sensitivityResult!.terminalGrowthValues, DEFAULT_TERMINAL_GROWTH_VALUES);
  assert.equal(s.sensitivityResult!.cells.flat().length, 25);
  assert.equal(s.sensitivityResult!.cells.flat().filter((c) => c.isBaseCase).length, 1);
});

test('가정 없이 실행하면 아무 일도 일어나지 않는다', () => {
  assert.equal(withValuationRun(emptyProjectState), emptyProjectState);
  assert.equal(withSensitivityRun(emptyProjectState), emptyProjectState);
});

test('가정만 설정하면 결과는 비어 있고(Not run), 실행하면 채워진다', () => {
  const s1 = withAssumptions(emptyProjectState, practice);
  assert.equal(s1.valuationResult, null);
  const s2 = withValuationRun(s1);
  assert.ok(s2.valuationResult);
  assert.equal(s2.sensitivityResult, null); // Sensitivity 는 별도 실행
  const s3 = withSensitivityRun(s2);
  assert.ok(s3.sensitivityResult);
});

test('가정을 바꾸면 이전 결과가 지워진다 (stale 방지)', () => {
  const calculated = withPracticeAssumptions(emptyProjectState);
  const changed = withAssumptions(calculated, { ...practice, beta: 1.5 });
  assert.equal(changed.valuationResult, null);
  assert.equal(changed.sensitivityResult, null);
  assert.equal(changed.valuationError, null);
});

test('ValuationError 는 throw 되지 않고 메시지로 저장된다', () => {
  const bad = withValuationRun(withAssumptions(emptyProjectState, { ...practice, terminalGrowth: 0.09 }));
  assert.equal(bad.valuationResult, null);
  assert.match(bad.valuationError!, /영구성장률/);

  const badShares = withSensitivityRun(withAssumptions(emptyProjectState, { ...practice, sharesOutstanding: 0 }));
  assert.equal(badShares.sensitivityResult, null);
  assert.match(badShares.sensitivityError!, /sharesOutstanding/);
});

test('오류 후 정상 가정으로 바꾸면 오류가 사라진다', () => {
  const bad = withValuationRun(withAssumptions(emptyProjectState, { ...practice, terminalGrowth: 0.09 }));
  const fixed = withValuationRun(withAssumptions(bad, practice));
  assert.equal(fixed.valuationError, null);
  assert.ok(fixed.valuationResult);
});

test('resetValuation: 가정·결과·오류는 비우고 historicalData 는 유지한다', () => {
  const s = withValuationReset(withPracticeAssumptions(withSamsungHistorical(emptyProjectState)));
  assert.equal(s.historicalData, samsungHistoricalData);
  assert.equal(s.valuationAssumptions, null);
  assert.equal(s.valuationResult, null);
  assert.equal(s.sensitivityResult, null);
});

test('저장 대상은 historicalData 와 valuationAssumptions 뿐이다', () => {
  const s = withPracticeAssumptions(withSamsungHistorical(emptyProjectState));
  const persisted = toPersisted(s);
  assert.deepEqual(Object.keys(persisted).sort(), ['historicalData', 'valuationAssumptions']);
  const json = JSON.stringify(persisted);
  assert.ok(!json.includes('enterpriseValue'));
  assert.ok(!json.includes('cells'));
});

test('reload: 저장된 입력만으로 결과를 다시 계산한다', () => {
  const before = withPracticeAssumptions(withSamsungHistorical(emptyProjectState));
  const stored = JSON.parse(JSON.stringify(toPersisted(before))); // localStorage round-trip
  const after = restoreProjectState(stored);
  assert.deepEqual(after.historicalData, before.historicalData);
  assert.deepEqual(after.valuationAssumptions, before.valuationAssumptions);
  assert.deepEqual(after.valuationResult, before.valuationResult);
  assert.deepEqual(after.sensitivityResult, before.sensitivityResult);
});

test('reload: 옛 저장 형식(가정 없음)이나 비정상 값도 안전하게 복원한다', () => {
  assert.deepEqual(restoreProjectState(null), emptyProjectState);
  assert.deepEqual(restoreProjectState('oops'), emptyProjectState);
  const legacy = restoreProjectState({ historicalData: samsungHistoricalData, valuationAssumptions: null, valuationResult: null });
  assert.equal(legacy.valuationAssumptions, null);
  assert.equal(legacy.valuationResult, null);
  const broken = restoreProjectState({ valuationAssumptions: { ...practice, capex: [1] } });
  assert.equal(broken.valuationResult, null);
  assert.ok(broken.valuationError);
});

test('상태 전이는 입력 상태를 변경하지 않는다', () => {
  const s: ProjectState = withSamsungHistorical(emptyProjectState);
  const snapshot = JSON.stringify(s);
  withPracticeAssumptions(s);
  withValuationReset(s);
  withHistoricalData(s, null);
  assert.equal(JSON.stringify(s), snapshot);
});

test('isPracticeAssumptions: 값이 달라지면 학습용 배지 대상이 아니다', () => {
  assert.equal(isPracticeAssumptions(null), false);
  assert.equal(isPracticeAssumptions(practice), true);
  assert.equal(isPracticeAssumptions({ ...practice, beta: 1.2 }), false);
});
