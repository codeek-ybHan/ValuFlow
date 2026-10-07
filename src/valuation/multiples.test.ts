import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRelativeValuation, type RelativeOutcome } from './index.ts';
import { enterpriseValueFromEvEbitda, equityValueFromPbr, equityValueFromPer } from './multiples.ts';

const bridge = { interestBearingDebt: 300, cash: 100, sharesOutstanding: 1_000_000 }; // Net Debt 200
const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const ok = (o: RelativeOutcome) => { assert.equal(o.status, 'ok'); return o as Extract<RelativeOutcome, { status: 'ok' }>; };
const find = (outs: RelativeOutcome[], m: string) => outs.find((o) => o.method === m)!;

// ---- 9. PER ----
test('PER: Equity Value = Net Income × PER', () => {
  assert.equal(equityValueFromPer(150, 12), 1800);
  const per = ok(find(calculateRelativeValuation({ netIncome: 150, per: 12 }, bridge), 'PER'));
  assert.equal(per.equityValue, 1800);
});

// ---- 10. PBR ----
test('PBR: Equity Value = Book Equity × PBR', () => {
  assert.equal(equityValueFromPbr(1000, 1.5), 1500);
  const pbr = ok(find(calculateRelativeValuation({ bookEquity: 1000, pbr: 1.5 }, bridge), 'PBR'));
  assert.equal(pbr.equityValue, 1500);
});

// ---- 11. EV/EBITDA ----
test('EV/EBITDA: Enterprise Value = EBITDA × Multiple', () => {
  assert.equal(enterpriseValueFromEvEbitda(220, 10), 2200);
  const ev = ok(find(calculateRelativeValuation({ ebitda: 220, evEbitda: 10 }, bridge), 'EV/EBITDA'));
  assert.equal(ev.enterpriseValue, 2200);
  assert.equal(ev.evDerived, false);
});

// ---- 12. EV/EBITDA → Equity Bridge ----
test('EV/EBITDA → Equity Value = EV − Net Debt (200)', () => {
  const ev = ok(find(calculateRelativeValuation({ ebitda: 220, evEbitda: 10 }, bridge), 'EV/EBITDA'));
  assert.equal(ev.equityValue, 2000);
});

test('EV/EBITDA: Net Debt 가 음수(순현금)이면 Equity Value 가 EV 보다 크다', () => {
  const ev = ok(find(calculateRelativeValuation({ ebitda: 220, evEbitda: 10 }, { ...bridge, interestBearingDebt: 100, cash: 300 }), 'EV/EBITDA'));
  assert.equal(ev.equityValue, 2200 + 200);
});

// ---- 13. Per Share ----
test('Per Share = Equity Value(억원) × 100,000,000 ÷ 주식 수 (원)', () => {
  const per = ok(find(calculateRelativeValuation({ netIncome: 150, per: 12 }, bridge), 'PER'));
  assert.equal(per.perShareValue, 1800 * 1e8 / 1_000_000); // 180,000원
  const ev = ok(find(calculateRelativeValuation({ ebitda: 220, evEbitda: 10 }, bridge), 'EV/EBITDA'));
  assert.equal(ev.perShareValue, 200_000);
  const pbr = ok(find(calculateRelativeValuation({ bookEquity: 1000, pbr: 1.5 }, bridge), 'PBR'));
  assert.equal(pbr.perShareValue, 150_000);
});

test('PER / PBR 의 EV 는 Net Debt 를 더한 환산 참고값이다 (evDerived)', () => {
  const per = ok(find(calculateRelativeValuation({ netIncome: 150, per: 12 }, bridge), 'PER'));
  assert.equal(per.evDerived, true);
  assert.equal(per.enterpriseValue, 1800 + 200);
  const pbr = ok(find(calculateRelativeValuation({ bookEquity: 1000, pbr: 1.5 }, bridge), 'PBR'));
  assert.equal(pbr.enterpriseValue, 1500 + 200);
});

test('세 방법을 한 번에 계산하고, 입력이 없는 방법은 incomplete', () => {
  const outs = calculateRelativeValuation({ netIncome: 150, per: 12, ebitda: 220 }, bridge);
  assert.deepEqual(outs.map((o) => o.method), ['PER', 'PBR', 'EV/EBITDA']);
  assert.equal(outs[0].status, 'ok');
  assert.deepEqual(outs[1], { method: 'PBR', status: 'incomplete', missing: ['bookEquity', 'pbr'] });
  assert.deepEqual(outs[2], { method: 'EV/EBITDA', status: 'incomplete', missing: ['evEbitda'] });
  assert.ok(calculateRelativeValuation({}, {}).every((o) => o.status === 'incomplete'));
});

test('Equity Bridge 정보가 없으면 가능한 값만 계산하고 안내한다 (값을 만들어 내지 않는다)', () => {
  const per = ok(find(calculateRelativeValuation({ netIncome: 150, per: 12 }, {}), 'PER'));
  assert.equal(per.equityValue, 1800);
  assert.equal(per.enterpriseValue, null);
  assert.equal(per.perShareValue, null);
  assert.equal(per.notes.length, 2);
  const ev = ok(find(calculateRelativeValuation({ ebitda: 220, evEbitda: 10 }, { sharesOutstanding: 1_000_000 }), 'EV/EBITDA'));
  assert.equal(ev.enterpriseValue, 2200);
  assert.equal(ev.equityValue, null);
  assert.equal(ev.perShareValue, null);
});

test('잘못된 입력은 그 방법만 invalid (순이익/장부가/EBITDA ≤ 0, 멀티플 ≤ 0, 주식 수 ≤ 0, NaN)', () => {
  const cases: [Parameters<typeof calculateRelativeValuation>[0], Parameters<typeof calculateRelativeValuation>[1], string][] = [
    [{ netIncome: -10, per: 12 }, bridge, '순이익'],
    [{ netIncome: 0, per: 12 }, bridge, '순이익'],
    [{ netIncome: 150, per: 0 }, bridge, '멀티플'],
    [{ bookEquity: 0, pbr: 1.5 }, bridge, '장부가'],
    [{ ebitda: -1, evEbitda: 10 }, bridge, 'EBITDA'],
    [{ netIncome: 150, per: 12 }, { ...bridge, sharesOutstanding: 0 }, '발행주식수'],
    [{ netIncome: NaN, per: 12 }, bridge, '유한'],
  ];
  for (const [input, br, msg] of cases) {
    const out = calculateRelativeValuation(input, br)[0] ?? null;
    const target = calculateRelativeValuation(input, br).find((o) => o.status === 'invalid');
    assert.ok(target, JSON.stringify(input));
    assert.match((target as { error: string }).error, new RegExp(msg));
    void out;
  }
  // 한 방법의 오류가 다른 방법에 영향을 주지 않는다
  const mixed = calculateRelativeValuation({ netIncome: -1, per: 12, bookEquity: 1000, pbr: 1.5 }, bridge);
  assert.equal(mixed[0].status, 'invalid');
  assert.equal(mixed[1].status, 'ok');
});

test('입력 객체를 변경하지 않는다', () => {
  const input = { netIncome: 150, per: 12 };
  const br = { ...bridge };
  const snap = JSON.stringify([input, br]);
  calculateRelativeValuation(input, br);
  assert.equal(JSON.stringify([input, br]), snap);
});

test('STEP 04 학습용 값(Net Debt 200, 주식 100만)과 일관된 값: 부동소수 오차 없음', () => {
  const per = ok(find(calculateRelativeValuation({ netIncome: 100, per: 21.4556 }, bridge), 'PER'));
  close(per.equityValue!, 2145.56, 1e-9);
  close(per.perShareValue!, 214556, 1e-6);
});
