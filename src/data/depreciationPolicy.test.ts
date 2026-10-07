// D&A 처리 방침: 출처가 없으면 missing 으로 남기고, Forecast 에서 사용자가 직접 입력한다. 어떤 방법으로도 추정하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeFinancials } from './normalization/normalizeFinancials.ts';
import type { DartFinancialsResponse, DartRawAccount } from './dart/types.ts';
import { step04PracticeAssumptions } from './step04PracticeAssumptions.ts';
import { buildHistoricalView } from '../engine/historicalView.ts';
import { buildForecastReference, emptyForecastForm, parseForecastForm } from '../engine/forecastForm.ts';
import { depreciationUnavailableNote, historicalDepreciation } from '../engine/depreciation.ts';
import { emptyProjectState, withForecastInputs, withHistoricalData, withPracticeAssumptions } from '../store/projectModel.ts';
import { samsungHistoricalData } from './samsungHistorical.ts';

const RESPONSE = JSON.parse(readFileSync(new URL('./fixtures/samsungDartFinancials.json', import.meta.url), 'utf8')) as DartFinancialsResponse;
const YEARS = [2023, 2024, 2025];
const normalize = (accounts: DartRawAccount[]) => normalizeFinancials({ company: { name: '삼성전자', corpCode: '00126380', stockCode: '005930' }, accounts, fiscalYears: YEARS, fetchedAt: RESPONSE.fetchedAt });
const dart = () => {
  const r = normalize(structuredClone(RESPONSE.accounts));
  assert.ok(r.ok);
  return r;
};
const sourceOf = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const DA_WARNING = 'D&A not available from current OpenDART financial statement source.';

// 1·2. 실제 Raw 에 D&A 가 없으면 missing 이며 0 이 아니다
test('실제 Raw 에 D&A 가 없으면 missing 으로 남고 0 으로 저장되지 않는다', () => {
  assert.ok(!RESPONSE.accounts.some((a) => /감가상각|무형자산상각/.test(a.accountName)), '삼성전자 재무제표 본문에는 D&A 계정이 없다');
  const r = dart();
  assert.equal(r.data.cashFlow.depreciationAmortization, undefined);
  assert.ok(!('depreciationAmortization' in r.data.cashFlow));
  assert.equal(historicalDepreciation(r.data), null);
  assert.ok(!JSON.stringify(r.data).includes('depreciationAmortization'));
  // 계정은 있지만 금액이 비어 있어도 0 이 아니라 missing
  const blank = [...structuredClone(RESPONSE.accounts), ...YEARS.map((y): DartRawAccount => ({
    accountName: '감가상각비', statementType: 'CF', basis: 'Consolidated', fiscalYear: y, amount: null, unit: 'KRW', raw: {},
  }))];
  const b = normalize(blank);
  assert.ok(b.ok);
  assert.equal(b.data.cashFlow.depreciationAmortization, undefined);
  assert.equal(b.quality.fields.depreciationAmortization?.status, 'missing');
});

// 5. warning + mapping trace
test('D&A 를 찾지 못하면 warning 과 mapping trace(status=missing, source)를 남긴다', () => {
  const r = dart();
  assert.ok(r.quality.warnings.includes(DA_WARNING));
  const q = r.quality.fields.depreciationAmortization;
  assert.equal(q?.status, 'missing');
  assert.equal(q?.source, 'OpenDART Financial Statement');
  assert.deepEqual(q?.sources, []);
  assert.equal(q?.matchType, undefined);
  // 다른 선택 계정은 찾은 방식이 기록된다
  assert.equal(r.quality.fields.cash?.matchType, 'account-id');
  assert.equal(r.quality.fields.interestBearingDebt?.matchType, 'sum');
  assert.equal(r.quality.fields.revenue?.matchType, 'account-id');
});

// Priority 1: 직접 계정이 있으면 사용하고 trace 를 남긴다
test('직접 D&A 계정(감가상각비 / 무형자산상각비)이 Raw 에 있으면 합산해 사용하고 trace 를 남긴다', () => {
  const extra = (name: string, v: number[]): DartRawAccount[] => YEARS.map((y, i) => ({ accountName: name, statementType: 'CF', basis: 'Consolidated', fiscalYear: y, amount: v[i] * 1_000_000, unit: 'KRW', raw: {} }));
  const r = normalize([...structuredClone(RESPONSE.accounts), ...extra('감가상각비', [30, 31, 32]), ...extra('무형자산상각비', [3, 3, 4])]);
  assert.ok(r.ok);
  assert.deepEqual(r.data.cashFlow.depreciationAmortization, [33, 34, 36]);
  assert.equal(r.quality.fields.depreciationAmortization?.status, 'available');
  assert.equal(r.quality.fields.depreciationAmortization?.matchType, 'sum');
  assert.ok(!r.quality.warnings.includes(DA_WARNING));
  // Forecast 참고값에는 억원 환산된 Actual D&A 가 표시된다
  const row = buildForecastReference(r.data)!.rows.find((x) => x.key === 'depreciation')!;
  assert.deepEqual(row.values, [0.33, 0.34, 0.36]);
  assert.equal(row.note, undefined);
});

// 3. 학습용 fixture D&A 자동 삽입 없음 / 9. 혼입 없음
test('학습용 D&A(40/42/44)는 실제 기업 Historical / Forecast 에 자동으로 섞이지 않는다', () => {
  const r = dart();
  const learning = step04PracticeAssumptions.depreciation;
  assert.deepEqual(learning, [40, 42, 44]);
  assert.ok(!JSON.stringify(r.data).includes('40,42,44'));
  // Historical 을 불러와도 가정은 비어 있다
  const s = withHistoricalData(emptyProjectState, r.data);
  assert.equal(s.valuationAssumptions, null);
  // Forecast 참고값은 비어 있고 입력칸을 채울 값을 만들지 않는다
  const ref = buildForecastReference(r.data)!;
  assert.ok(ref.rows.find((x) => x.key === 'depreciation')!.values.every((v) => v === null));
  // 학습용 가정은 사용자가 명시적으로 적용했을 때만 들어온다
  assert.deepEqual(withPracticeAssumptions(s).valuationAssumptions?.depreciation, learning);
  assert.equal(withPracticeAssumptions(s).historicalData, r.data);
  // 사용자가 직접 입력한 D&A 가 있으면 학습용 값으로 바뀌는 일은 [학습용 DCF 가정 적용] 으로만 일어난다
  const typed = withForecastInputs(s, userForecast([500, 510, 520]));
  assert.deepEqual(typed.valuationAssumptions?.depreciation, [500, 510, 520]);
  assert.equal(typed.historicalData, r.data);
});

// 4. 추정하지 않는다
test('PPE / CAPEX 로 D&A 를 추정하지 않는다', () => {
  // CAPEX · 유형자산 취득이 매우 커도 D&A 는 만들어지지 않는다
  const big = structuredClone(RESPONSE.accounts).map((a) => (/취득/.test(a.accountName) && a.amount !== null ? { ...a, amount: a.amount * 100 } : a));
  const r = normalize(big);
  assert.ok(r.ok);
  assert.equal(r.data.cashFlow.depreciationAmortization, undefined);
  // 유형자산 잔액(BS)이 있어도 roll-forward 로 역산하지 않는다
  const withPpeBalance = [...structuredClone(RESPONSE.accounts), ...YEARS.map((y): DartRawAccount => ({ accountName: '유형자산', statementType: 'BS', basis: 'Consolidated', fiscalYear: y, amount: 1e14 + y, unit: 'KRW', raw: {} }))];
  const p = normalize(withPpeBalance);
  assert.ok(p.ok && p.data.cashFlow.depreciationAmortization === undefined);
  // 비슷해 보이는 다른 계정을 D&A 로 간주하지 않는다
  const decoy = [...structuredClone(RESPONSE.accounts), ...YEARS.map((y): DartRawAccount => ({ accountName: '단기상각후원가금융자산의 순감소(증가)', statementType: 'CF', basis: 'Consolidated', fiscalYear: y, amount: 5e11, unit: 'KRW', raw: {} }))];
  const d = normalize(decoy);
  assert.ok(d.ok && d.data.cashFlow.depreciationAmortization === undefined);
  // 소스에 추정 로직이 없다: D&A 와 capex / roll-forward / 비율을 연결하는 코드가 없다
  for (const f of ['./normalization/normalizeFinancials.ts', './normalization/accounts.ts', './normalization/derived.ts', '../engine/depreciation.ts', './repository/dartRepository.ts']) {
    const src = sourceOf(f);
    assert.ok(!/depreciation\w*\s*[:=][^;\n]*(capex|ppe|roll|ratio|average|industry)/i.test(src), `${f}: D&A 추정 코드`);
  }
});

// 6. Historical View 의 — 표시
test('Historical View 에서 D&A 는 — 로 표시되고 출처 안내가 붙는다', () => {
  const view = buildHistoricalView(dart().data)!;
  const row = view.keyFinancials.find((x) => x.key === 'depreciationAmortization')!;
  assert.deepEqual(row.values, [null, null, null]); // fmtNum(null) = '—'
  assert.match(row.note!, /Data unavailable from current DART source/);
  // Fixture 는 출처를 DART 라고 말하지 않는다
  const fx = buildHistoricalView(samsungHistoricalData)!.keyFinancials.find((x) => x.key === 'depreciationAmortization')!;
  assert.deepEqual(fx.values, [null, null, null]);
  assert.doesNotMatch(fx.note!, /DART source/);
  assert.match(depreciationUnavailableNote(samsungHistoricalData), /Data unavailable from current source/);
  // 화면은 null 을 fmtNum 으로만 표시한다 (0 으로 바꾸지 않는다)
  const stage = sourceOf('../components/valuation/HistoricalStage.tsx');
  assert.ok(stage.includes('fmtNum(v)') || stage.includes('fmtNum'));
  const ws = readFileSync(new URL('../pages/Workspace.tsx', import.meta.url), 'utf8');
  assert.ok(ws.includes("label: 'D&A', values: da ?? p.map(() => null)"));
});

// 7·8. Forecast D&A 직접 입력 → valuationAssumptions
function userForecast(depreciation: number[]) {
  const f = emptyForecastForm();
  f.currentRevenue = '3336059.38';
  f.taxRate = '22';
  f.revenueGrowth = ['11', '9', '7'];
  f.operatingMargin = ['12', '13', '14'];
  f.depreciation = depreciation.map(String);
  f.capex = ['900', '910', '920'];
  f.deltaNwc = ['30', '31', '32'];
  const parsed = parseForecastForm(f);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}

test('Forecast 에서 D&A 를 직접 입력할 수 있고, 입력값이 valuationAssumptions 에 반영된다', () => {
  const inputs = userForecast([500, 510, 520]);
  assert.deepEqual(inputs.depreciation, [500, 510, 520]);
  const s = withForecastInputs(withHistoricalData(emptyProjectState, dart().data), inputs);
  assert.deepEqual(s.valuationAssumptions?.depreciation, [500, 510, 520]);
  // D&A 칸이 비어 있으면 검증 실패 (임의 값으로 채우지 않는다)
  const f = emptyForecastForm();
  const blank = parseForecastForm(f);
  assert.ok(!blank.ok);
  const missing = emptyForecastForm();
  Object.assign(missing, { currentRevenue: '1', taxRate: '22', revenueGrowth: ['1', '1', '1'], operatingMargin: ['1', '1', '1'], capex: ['1', '1', '1'], deltaNwc: ['1', '1', '1'] });
  const r = parseForecastForm(missing);
  assert.ok(!r.ok);
  if (!r.ok) assert.ok(Object.keys(r.errors).some((k) => k.startsWith('depreciation')));
  // 음수 D&A 는 거부
  const neg = emptyForecastForm();
  Object.assign(neg, { currentRevenue: '1', taxRate: '22', revenueGrowth: ['1', '1', '1'], operatingMargin: ['1', '1', '1'], depreciation: ['-1', '1', '1'], capex: ['1', '1', '1'], deltaNwc: ['1', '1', '1'] });
  assert.ok(!parseForecastForm(neg).ok);
});

// 10. 원본 Raw 불변
test('정규화는 원본 Raw 를 변경하지 않는다', () => {
  const accounts = structuredClone(RESPONSE.accounts);
  const freeze = (o: unknown): void => { if (typeof o === 'object' && o !== null) { Object.values(o).forEach(freeze); Object.freeze(o); } };
  freeze(accounts);
  const snapshot = JSON.stringify(accounts);
  assert.doesNotThrow(() => normalize(accounts));
  assert.equal(JSON.stringify(accounts), snapshot);
});
