// STEP 06-1: Financial Data Pipeline 구조 테스트 (실제 OpenDART 호출 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { samsungHistoricalData } from './samsungHistorical.ts';
import type { DartBasis, DartRawAccount, DartRawUnit, DartStatementType } from './dart/types.ts';
import { normalizeFinancials, type NormalizeInput } from './normalization/normalizeFinancials.ts';
import { normalizeAccountName } from './normalization/accounts.ts';
import { toKrwMillion } from './normalization/units.ts';
import { buildPeriods, fiscalYearLabel, parseFiscalYear, resolveRelativePeriod } from './normalization/periods.ts';
import { capexForValuation } from './normalization/derived.ts';
import { assessHistoricalQuality, fromSamsungFixture } from './repository/fixtureAdapter.ts';
import { FixtureFinancialRepository } from './repository/fixtureRepository.ts';
import type { FinancialRepository } from './repository/financialRepository.ts';
import { buildHistoricalView } from '../engine/historicalView.ts';
import { deriveHistoricalMetrics } from '../engine/historical.ts';
import { krwMillionToEok } from '../engine/units.ts';

const YEARS = [2023, 2024, 2025];
const AT = '2026-01-01T00:00:00.000Z';

type Spec = [name: string, st: DartStatementType, values: number[], id?: string];
const FULL: Spec[] = [
  ['매출액', 'IS', [100, 110, 120], 'ifrs-full_Revenue'], ['매출원가', 'IS', [60, 65, 70]], ['매출총이익', 'IS', [40, 45, 50]],
  ['판매비와관리비', 'IS', [20, 21, 22]], ['영업이익(손실)', 'IS', [20, 24, 28]], ['당기순이익(손실)', 'IS', [15, 18, 21]],
  ['매출채권', 'BS', [10, 11, 12]], ['재고자산', 'BS', [8, 9, 10]], ['매입채무', 'BS', [5, 6, 7]],
  ['자산총계', 'BS', [300, 320, 340]], ['부채총계', 'BS', [100, 110, 120]], ['자본총계', 'BS', [200, 210, 220]],
  ['영업활동현금흐름', 'CF', [30, 33, 36]], ['유형자산의 취득', 'CF', [-12, -13, -14]], ['무형자산의 취득', 'CF', [-2, -3, -4]],
];

function rows(specs: Spec[], basis: DartBasis = 'Consolidated', unit: DartRawUnit = 'million'): DartRawAccount[] {
  return specs.flatMap(([accountName, statementType, values, accountId]) =>
    values.map((amount, i) => ({ accountName, accountId, statementType, basis, fiscalYear: YEARS[i], amount, unit, raw: { account_nm: accountName, thstrm_amount: String(amount) } })));
}
const input = (accounts: DartRawAccount[], extra: Partial<NormalizeInput> = {}): NormalizeInput =>
  ({ company: { name: '테스트', corpCode: '00000001', stockCode: '000001' }, accounts, fiscalYears: YEARS, fetchedAt: AT, ...extra });
function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null) { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

// 1. Raw 와 Domain 의 분리
test('Raw model 은 domain(HistoricalData)·business field 와 분리되어 있다', () => {
  const dart = (f: string) => readFileSync(new URL(`./dart/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/revenue|capex|operatingProfit|HistoricalData/i.test(dart('types.ts')), 'Raw 타입에 business field 없음');
  // dart/ 는 normalization / repository / domain 을 모른다
  for (const f of readdirSync(new URL('./dart', import.meta.url)).filter((x) => x.endsWith('.ts'))) {
    assert.ok(!/from '\.\.\//.test(dart(f)), `dart/${f} 는 상위 계층을 import 하지 않는다`);
  }
  // UI / store / valuation 은 dart/ 와 normalization/ 을 직접 import 하지 않는다
  const ui = ['store/project.tsx', 'store/projectModel.ts', 'pages/Workspace.tsx', 'components/valuation/HistoricalStage.tsx', 'valuation/index.ts']
    .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  assert.ok(!/data\/dart|data\/normalization|\.\/dart\//.test(ui));
});

// 2. 계정 매핑
test('계정명 변형이 같은 canonical field 로 매핑된다', () => {
  for (const name of ['매출액', '수익(매출액)', '영업수익', 'Revenue']) {
    const specs: Spec[] = FULL.map((s) => (s[0] === '매출액' ? [name, s[1], s[2]] : s)) as Spec[];
    const r = normalizeFinancials(input(rows(specs.map((s) => [s[0], s[1], s[2]] as Spec))));
    assert.ok(r.ok, name);
    if (r.ok) assert.deepEqual(r.data.incomeStatement.revenue, [100, 110, 120]);
  }
  assert.equal(normalizeAccountName(' 영업이익 (손실)'), normalizeAccountName('영업이익(손실)'));
  assert.equal(normalizeAccountName('Ⅰ. 매출액'), normalizeAccountName('매출액'));
});

test('XBRL ID 로도 매핑되고, 손익 항목은 IS/CIS 어느 쪽이든 찾는다', () => {
  const specs: Spec[] = FULL.map(([n, st, v]) => (n === '매출액' ? ['alt', 'CIS', v, 'ifrs-full_Revenue'] : [n, st, v]) as Spec);
  const r = normalizeFinancials(input(rows(specs)));
  assert.ok(r.ok && r.data.incomeStatement.revenue[2] === 120);
});

test('유사 계정(매입채무및기타채무)은 weak 매핑이며 warning 을 남긴다', () => {
  const specs = FULL.map(([n, st, v]) => (n === '매입채무' ? ['매입채무 및 기타채무', st, v] : [n, st, v]) as Spec);
  const r = normalizeFinancials(input(rows(specs)));
  assert.ok(r.ok);
  assert.ok(r.quality.warnings.includes('Accounts Payable mapped from trade and other payables'));
  // strong 후보가 있으면 weak 는 쓰지 않는다
  const both = normalizeFinancials(input(rows([...FULL, ['매입채무및기타채무', 'BS', [999, 999, 999]]])));
  assert.ok(both.ok && both.data.balanceSheet.accountsPayable[0] === 5);
});

test('선택 계정: Cash / 이자부부채(합산) / D&A(부분이면 warning)', () => {
  const extra: Spec[] = [['현금및현금성자산', 'BS', [50, 60, 70]], ['단기차입금', 'BS', [10, 10, 10]], ['사채', 'BS', [5, 6, 7]], ['감가상각비', 'CF', [3, 3, 3]]];
  const r = normalizeFinancials(input(rows([...FULL, ...extra])));
  assert.ok(r.ok);
  assert.deepEqual(r.data.balanceSheet.cash, [50, 60, 70]);
  assert.deepEqual(r.data.balanceSheet.interestBearingDebt, [15, 16, 17]);
  assert.deepEqual(r.data.cashFlow.depreciationAmortization, [3, 3, 3]);
  assert.ok(r.quality.warnings.some((w) => w.startsWith('D&A is partial')));
});

test('취득 계정은 부호와 상관없이 크기로 저장하고, CAPEX 는 하나로 합치지 않고 보존한다', () => {
  const r = normalizeFinancials(input(rows(FULL)));
  assert.ok(r.ok);
  assert.deepEqual(r.data.cashFlow.ppeAcquisition, [12, 13, 14]);
  assert.deepEqual(r.data.cashFlow.intangibleAcquisition, [2, 3, 4]);
  assert.deepEqual(capexForValuation(r.data), [12, 13, 14]);
  assert.deepEqual(capexForValuation(r.data, 'ppe+intangible'), [14, 16, 18]);
});

test('같은 계정에 서로 다른 값이 있으면 ambiguous 로 표시한다', () => {
  const r = normalizeFinancials(input(rows([...FULL, ['영업수익', 'IS', [1, 1, 1]]])));
  assert.ok(r.ok);
  assert.equal(r.quality.fields.revenue?.status, 'ambiguous');
  assert.ok(r.quality.warnings.some((w) => w.includes('multiple different values')));
});

// 3. 단위
test('단위 정규화: 원 / 천원 / 백만원 → KRW million', () => {
  assert.equal(toKrwMillion(333_605_938_000_000, 'KRW'), 333_605_938);
  assert.equal(toKrwMillion(333_605_938_000, 'thousand'), 333_605_938);
  assert.equal(toKrwMillion(333_605_938, 'million'), 333_605_938);
  assert.throws(() => toKrwMillion(Number.NaN, 'KRW'));
  // 같은 데이터를 다른 단위로 줘도 같은 결과
  const won = FULL.map(([n, st, v, id]) => [n, st, v.map((x) => x * 1_000_000), id] as Spec);
  const a = normalizeFinancials(input(rows(FULL, 'Consolidated', 'million')));
  const b = normalizeFinancials(input(rows(won, 'Consolidated', 'KRW')));
  assert.ok(a.ok && b.ok);
  assert.deepEqual(b.data.incomeStatement, a.data.incomeStatement);
  // Valuation 진입 시 억원 환산은 기존 engine/units 를 그대로 쓴다
  assert.equal(krwMillionToEok(333_605_938), 3_336_059.38);
});

// 4. 기간
test('기간 정규화: 당기 / 전기 / 전전기 / FY 라벨 → 2023A', () => {
  assert.equal(resolveRelativePeriod('당기', 2025), 2025);
  assert.equal(resolveRelativePeriod('전기', 2025), 2024);
  assert.equal(resolveRelativePeriod('전 전기', 2025), 2023);
  assert.equal(resolveRelativePeriod('차기', 2025), null);
  for (const l of ['2023A', 'FY2023', '2023', '2023.12.31', '2023년']) assert.equal(parseFiscalYear(l), 2023, l);
  assert.equal(parseFiscalYear('abc'), null);
  assert.equal(fiscalYearLabel(2023), '2023A');
  assert.deepEqual(buildPeriods([2025, 2023, 2024, 2023]), { years: [2023, 2024, 2025], labels: ['2023A', '2024A', '2025A'] });
  // 상대 표기만 있는 원본도 해석된다
  const rel = rows(FULL).map((a) => ({ ...a, fiscalYear: null, reportYear: 2025, periodLabel: ['전전기', '전기', '당기'][YEARS.indexOf(a.fiscalYear!)] }));
  const r = normalizeFinancials(input(rel));
  assert.ok(r.ok);
  assert.deepEqual(r.data.company.period, ['2023A', '2024A', '2025A']);
  assert.deepEqual(r.data.incomeStatement.revenue, [100, 110, 120]);
});

// 5. 연결 / 별도
test('연결 우선, 연결이 없으면 별도로 fallback 하고 실제 사용한 basis 를 기록한다', () => {
  const consolidated = normalizeFinancials(input([...rows(FULL, 'Consolidated'), ...rows(FULL.map(([n, s, v, i]) => [n, s, v.map((x) => x * 2), i] as Spec), 'Separate')]));
  assert.ok(consolidated.ok);
  assert.equal(consolidated.data.company.basis, 'Consolidated');
  assert.equal(consolidated.data.incomeStatement.revenue[0], 100);
  assert.equal(consolidated.quality.basisFallback, false);

  const sepOnly = normalizeFinancials(input(rows(FULL, 'Separate')));
  assert.ok(sepOnly.ok);
  assert.equal(sepOnly.data.company.basis, 'Separate');
  assert.equal(sepOnly.quality.basisRequested, 'Consolidated');
  assert.equal(sepOnly.quality.basisUsed, 'Separate');
  assert.equal(sepOnly.quality.basisFallback, true);
  assert.ok(sepOnly.quality.warnings.includes('Separate statements used because consolidated data unavailable'));

  const noFallback = normalizeFinancials(input(rows(FULL, 'Separate'), { allowBasisFallback: false }));
  assert.equal(noFallback.ok, false);
});

// 6. 누락
test('필수 계정이 없으면 값을 채우지 않고 ok:false + warning, 선택 계정이 없으면 warning 만', () => {
  const without = FULL.filter(([n]) => n !== '재고자산');
  const r = normalizeFinancials(input(rows(without)));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.missingRequired, ['inventory']);
    assert.equal(r.quality.fields.inventory?.status, 'missing');
    assert.ok(r.quality.warnings.some((w) => w.startsWith('Inventory account not found')));
  }
  const ok = normalizeFinancials(input(rows(FULL)));
  assert.ok(ok.ok);
  assert.ok(ok.quality.warnings.includes('D&A account not found'));
  assert.ok(ok.quality.warnings.includes('Cash account not found'));
  assert.equal(ok.data.balanceSheet.cash, undefined);

  // 일부 연도만 있으면 partial → 필수 계정이면 실패
  const partial = rows(FULL).filter((a) => !(a.accountName === '매출액' && a.fiscalYear === 2024));
  const p = normalizeFinancials(input(partial));
  assert.equal(p.ok, false);
  assert.equal(p.quality.fields.revenue?.status, 'partial');
  assert.deepEqual(p.quality.fields.revenue?.missingYears, [2024]);
});

// 7. Samsung fixture adapter
test('Samsung fixture adapter: source=Fixture, 값은 그대로, fixture 는 변경되지 않는다', () => {
  const before = JSON.stringify(samsungHistoricalData);
  const h = fromSamsungFixture(AT);
  assert.equal(h.meta?.source, 'Fixture');
  assert.equal(h.meta?.corpCode, undefined, 'OpenDART 응답처럼 위장하지 않는다');
  assert.equal(h.meta?.stockCode, '005930');
  assert.equal(h.meta?.fetchedAt, AT);
  assert.deepEqual(h.incomeStatement, samsungHistoricalData.incomeStatement);
  assert.notEqual(h.incomeStatement, samsungHistoricalData.incomeStatement);
  h.incomeStatement.revenue[0] = 1;
  assert.equal(JSON.stringify(samsungHistoricalData), before);
  assert.deepEqual(samsungHistoricalData.meta, { stockCode: '005930', source: 'Fixture' }); // fixture 자체의 meta 는 그대로
  const q = assessHistoricalQuality(h);
  assert.equal(q.basisUsed, 'Consolidated');
  assert.equal(q.fields.revenue?.status, 'available');
  assert.equal(q.fields.depreciationAmortization?.status, 'missing');
  assert.ok(q.warnings.includes('D&A account not found'));
});

// 8. 원본 불변
test('normalizeFinancials 는 입력(Raw)을 변경하지 않는다', () => {
  const accounts = deepFreeze(rows([...FULL, ['현금및현금성자산', 'BS', [1, 2, 3]]]));
  const snapshot = JSON.stringify(accounts);
  const inp = deepFreeze(input(accounts));
  assert.doesNotThrow(() => normalizeFinancials(inp));
  assert.equal(JSON.stringify(accounts), snapshot);
  const r = normalizeFinancials(inp);
  assert.ok(r.ok);
  r.data.incomeStatement.revenue[0] = -1; // 결과를 바꿔도 입력에 영향 없음
  assert.equal(JSON.stringify(accounts), snapshot);
});

// 9. Repository interface
test('Repository interface: Workspace 는 구현체를 모르고 interface 로만 접근한다', async () => {
  const repo: FinancialRepository = new FixtureFinancialRepository(() => AT);
  assert.deepEqual((await repo.searchCompanies('삼성')).map((c) => c.stockCode), ['005930']);
  assert.deepEqual(await repo.searchCompanies(''), []);
  assert.equal(await repo.getCompany('000000'), null);
  const ok = await repo.getHistoricalFinancials({ stockCode: '005930', fiscalYears: [2023, 2024, 2025] });
  assert.ok(ok.ok);
  if (ok.ok) { assert.equal(ok.data.meta?.source, 'Fixture'); assert.equal(ok.data.meta?.fetchedAt, AT); }
  const nf = await repo.getHistoricalFinancials({ stockCode: '000660' });
  assert.ok(!nf.ok && nf.reason === 'not-found');
  const un = await repo.getHistoricalFinancials({ stockCode: '005930', fiscalYears: [2019] });
  assert.ok(!un.ok && un.reason === 'unavailable');
});

// 10. 기존 Historical View / metrics 와 호환
test('정규화 결과와 fixture adapter 결과가 기존 Historical View / metrics 와 호환된다', () => {
  const r = normalizeFinancials(input(rows(FULL)));
  assert.ok(r.ok);
  for (const h of [r.data, fromSamsungFixture(AT)]) {
    const view = buildHistoricalView(h);
    assert.ok(view);
    assert.equal(deriveHistoricalMetrics(h).revenueGrowth.length, h.company.period.length);
  }
  // fixture adapter 는 메타만 추가하므로 View 의 숫자가 원본 fixture 와 같다
  assert.deepEqual(buildHistoricalView(fromSamsungFixture(AT))?.rows, buildHistoricalView(samsungHistoricalData)?.rows);
});
