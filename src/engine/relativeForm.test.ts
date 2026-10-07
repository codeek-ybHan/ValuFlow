import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samsungHistoricalData as h } from '../data/samsungHistorical.ts';
import {
  RELATIVE_FIELDS, RELATIVE_FIELD_SOURCE, RELATIVE_GROUPS, buildRelativeReference, emptyRelativeForm, mergeRelativeDrafts, parseRelativeForm,
  relativeDraftToForm, sameRelativeInputs, type RelativeFormValues,
} from './relativeForm.ts';
import { SOURCE_LABELS } from './waccForm.ts';

const form = (over: Partial<RelativeFormValues> = {}): RelativeFormValues => ({ ...emptyRelativeForm(), ...over });

test('빈 폼은 오류가 아니라 입력이 없는 상태다 (모두 선택 사항)', () => {
  const r = parseRelativeForm(emptyRelativeForm());
  assert.ok(r.ok);
  assert.deepEqual(r.value, {});
});

test('입력한 필드만 값에 들어간다 (콤마·소수 허용)', () => {
  const r = parseRelativeForm(form({ netIncome: '1,500.5', per: '12', evEbitda: '10' }));
  assert.ok(r.ok);
  assert.deepEqual(r.value, { netIncome: 1500.5, per: 12, evEbitda: 10 });
});

test('값이 들어 있는데 0 이하이거나 숫자가 아니면 오류', () => {
  const r = parseRelativeForm(form({ netIncome: '-5', per: '0', bookEquity: 'abc', pbr: '1.5', ebitda: '0' }));
  assert.ok(!r.ok);
  assert.match(r.errors.netIncome!, /0 보다 커야/);
  assert.match(r.errors.netIncome!, /의미가 없습니다/);
  assert.match(r.errors.per!, /0 보다 커야/);
  assert.equal(r.errors.bookEquity, '숫자를 입력하세요');
  assert.match(r.errors.ebitda!, /0 보다 커야/);
  assert.equal(r.errors.pbr, undefined);
});

test('저장된 입력 ↔ 폼 문자열 왕복, 없는 값은 빈 칸', () => {
  assert.deepEqual(relativeDraftToForm(null), emptyRelativeForm());
  const f = relativeDraftToForm({ netIncome: 150, per: 12 });
  assert.deepEqual(f, form({ netIncome: '150', per: '12' }));
  const back = parseRelativeForm(f);
  assert.ok(back.ok);
  assert.deepEqual(back.value, { netIncome: 150, per: 12 });
});

test('mergeRelativeDrafts / sameRelativeInputs', () => {
  const base = form({ per: '12' });
  const snap = JSON.stringify(base);
  assert.equal(mergeRelativeDrafts(base, { per: '15', unknown: 'x' }).per, '15');
  assert.equal(JSON.stringify(base), snap);
  assert.equal(sameRelativeInputs({ per: 12 }, { per: 12 }), true);
  assert.equal(sameRelativeInputs({ per: 12 }, { per: 12, pbr: 1 }), false);
});

test('구성: PER / PBR / EV·EBITDA 세 그룹, 입력 6개, 모두 Assumption', () => {
  assert.deepEqual(RELATIVE_GROUPS.map((g) => g.method), ['PER', 'PBR', 'EV/EBITDA']);
  assert.deepEqual([...RELATIVE_FIELDS], ['netIncome', 'per', 'bookEquity', 'pbr', 'ebitda', 'evEbitda']);
  for (const f of RELATIVE_FIELDS) assert.equal(SOURCE_LABELS[RELATIVE_FIELD_SOURCE[f]], 'Assumption');
  assert.match(RELATIVE_GROUPS[2].formula, /Equity Value = EV − Net Debt/);
});

test('최근 Actual 참고값: KRW million → 억원 (사용자가 버튼을 눌렀을 때만 입력된다)', () => {
  const ref = buildRelativeReference(h)!;
  assert.equal(ref.period, '2025A');
  assert.equal(ref.netIncomeEok, 452068.05);
  assert.equal(ref.bookEquityEok, 4363203.37);
  assert.equal(buildRelativeReference(null), null);
  assert.deepEqual(parseRelativeForm(emptyRelativeForm()), { ok: true, value: {} }); // 참고값은 폼에 자동으로 채워지지 않는다
});
