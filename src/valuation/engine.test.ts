import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step04PracticeAssumptions } from '../data/step04PracticeAssumptions.ts';
import { runValuation } from './engine.ts';
import { ValuationError } from './models.ts';

// 05-1 skeleton: 계산이 구현되기 전에는 가짜 결과를 돌려주지 않고 명시적으로 실패해야 한다.
// 05-2 에서 이 테스트를 STEP 04 기준값 검증으로 교체한다.
test('runValuation skeleton 은 구현 전까지 ValuationError 를 던진다', () => {
  assert.throws(() => runValuation(step04PracticeAssumptions), ValuationError);
});
