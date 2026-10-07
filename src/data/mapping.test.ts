// STEP 06-4: 실제 OpenDART 응답 기반 계정 매핑 / 정규화 검증.
// fixtures/*DartFinancials.json 은 실제 응답(2023~2025, 연결)에서 관련 계정만 추린 것이다 (삼성전자 · 현대자동차 · SK하이닉스 · NAVER · KB금융).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeFinancials, type NormalizeResult } from './normalization/normalizeFinancials.ts';
import { traceFor } from './normalization/quality.ts';
import { ACCOUNT_RULES } from './normalization/accounts.ts';
import { capexForValuation, CAPEX_BASIS_LABELS, DEFAULT_CAPEX_BASIS } from './normalization/derived.ts';
import { samsungHistoricalData as expected } from './samsungHistorical.ts';
import { DartFinancialRepository } from './repository/dartRepository.ts';
import { BackendDartClient } from './dart/client.ts';
import type { DartFinancialsResponse, DartRawAccount, DartStatementType } from './dart/types.ts';

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}DartFinancials.json`, import.meta.url), 'utf8')) as DartFinancialsResponse;
const FX = { samsung: load('samsung'), hyundai: load('hyundai'), hynix: load('hynix'), naver: load('naver'), kb: load('kb') };
const YEARS = [2023, 2024, 2025];
const run = (accounts: readonly DartRawAccount[], extra: object = {}): NormalizeResult =>
  normalizeFinancials({ company: { name: 't', corpCode: '00000001' }, accounts, fiscalYears: YEARS, fetchedAt: '2026-01-01T00:00:00Z', ...extra });
const okRun = (accounts: readonly DartRawAccount[]) => { const r = run(accounts); assert.ok(r.ok, r.ok ? '' : r.reason); return r; };

let n = 0;
function acc(name: string, st: DartStatementType, values: number[], id?: string, raw?: string): DartRawAccount[] {
  return values.map((v, i) => ({ accountName: name, accountId: id, statementType: st, rawStatementType: raw ?? st, basis: 'Consolidated' as const, fiscalYear: YEARS[i], amount: v * 1_000_000, unit: 'KRW' as const, raw: { n: ++n } }));
}
const BASE: DartRawAccount[] = [
  ...acc('매출액', 'IS', [100, 110, 120], 'ifrs-full_Revenue'), ...acc('매출원가', 'IS', [60, 65, 70], 'ifrs-full_CostOfSales'), ...acc('매출총이익', 'IS', [40, 45, 50], 'ifrs-full_GrossProfit'),
  ...acc('판매비와관리비', 'IS', [20, 21, 22]), ...acc('영업이익', 'IS', [20, 24, 28], 'dart_OperatingIncomeLoss'), ...acc('당기순이익', 'IS', [15, 18, 21], 'ifrs-full_ProfitLoss'),
  ...acc('매출채권', 'BS', [10, 11, 12], 'ifrs-full_CurrentTradeReceivables'), ...acc('재고자산', 'BS', [8, 9, 10], 'ifrs-full_Inventories'), ...acc('매입채무', 'BS', [5, 6, 7], 'ifrs-full_TradeAndOtherCurrentPayablesToTradeSuppliers'),
  ...acc('자산총계', 'BS', [300, 320, 340], 'ifrs-full_Assets'), ...acc('부채총계', 'BS', [100, 110, 120], 'ifrs-full_Liabilities'), ...acc('자본총계', 'BS', [200, 210, 220], 'ifrs-full_Equity'),
  ...acc('영업활동현금흐름', 'CF', [30, 33, 36]), ...acc('유형자산의 취득', 'CF', [12, 13, 14]), ...acc('무형자산의 취득', 'CF', [2, 3, 4]),
];
const without = (...names: string[]) => BASE.filter((a) => !names.includes(a.accountName));
const withRows = (rows: DartRawAccount[], ...extra: DartRawAccount[][]) => [...rows, ...extra.flat()];

// 1·2·3. 우선순위: account-id > exact-name > alias > weak
test('매핑 우선순위: accountId 가 이름보다, 이름이 alias 보다 우선한다', () => {
  // id 일치 (이름은 전혀 다름)
  const byId = okRun([...without('매출액'), ...acc('전혀 다른 이름', 'IS', [1, 2, 3], 'ifrs-full_Revenue')]);
  assert.deepEqual(byId.data.incomeStatement.revenue, [1, 2, 3]);
  assert.equal(traceFor(byId.quality, 'revenue', 2025)?.matchType, 'account-id');
  // id 가 있으면 같은 이름의 다른 행보다 id 행이 우선
  const both = okRun([...without('매출액'), ...acc('수익(매출액)', 'IS', [9, 9, 9]), ...acc('다른 이름', 'IS', [1, 2, 3], 'ifrs-full_Revenue')]);
  assert.deepEqual(both.data.incomeStatement.revenue, [1, 2, 3]);
  // exact name (id 없음)
  const byName = okRun([...without('매출액'), ...acc('매출액', 'IS', [4, 5, 6])]);
  assert.equal(traceFor(byName.quality, 'revenue', 2024)?.matchType, 'exact-name');
  // exact name > alias
  const nameOverAlias = okRun([...without('매출액'), ...acc('영업수익', 'IS', [9, 9, 9]), ...acc('매출액', 'IS', [4, 5, 6])]);
  assert.deepEqual(nameOverAlias.data.incomeStatement.revenue, [4, 5, 6]);
  // alias
  for (const alias of ['수익(매출액)', '영업수익', 'Revenue']) {
    const r = okRun([...without('매출액'), ...acc(alias, 'IS', [7, 8, 9])]);
    assert.equal(traceFor(r.quality, 'revenue', 2023)?.matchType, 'alias', alias);
    assert.equal(r.quality.fields.revenue?.status, 'available');
  }
  const op = okRun([...without('영업이익'), ...acc('영업이익(손실)', 'IS', [1, 2, 3])]);
  assert.equal(traceFor(op.quality, 'operatingProfit', 2025)?.matchType, 'alias');
});

// 4. weak
test('weak 매칭은 항상 warning 이고 status=ambiguous 이며, strong 이 있으면 쓰지 않는다 (AR / AP)', () => {
  const weak = okRun([...without('매입채무', '매출채권'), ...acc('매입채무및기타채무', 'BS', [50, 60, 70], 'ifrs-full_TradeAndOtherCurrentPayables'), ...acc('매출채권및기타채권', 'BS', [90, 91, 92], 'ifrs-full_TradeAndOtherCurrentReceivables')]);
  assert.deepEqual(weak.data.balanceSheet.accountsPayable, [50, 60, 70]);
  assert.ok(weak.quality.warnings.includes('Accounts Payable mapped from broader trade and other payables account.'));
  assert.ok(weak.quality.warnings.includes('Accounts Receivable mapped from broader trade and other receivables account.'));
  assert.equal(weak.quality.fields.accountsPayable?.status, 'ambiguous');
  assert.equal(weak.quality.fields.accountsPayable?.matchType, 'weak');
  // 비유동 동명 계정(다른 ID)은 제외한다: NAVER 의 장기 매출채권및기타채권
  const withNoncurrent = okRun([...without('매출채권'), ...acc('매출채권및기타채권', 'BS', [500, 500, 500], 'ifrs-full_NoncurrentReceivables'), ...acc('매출채권및기타채권', 'BS', [90, 91, 92], 'ifrs-full_TradeAndOtherCurrentReceivables')]);
  assert.deepEqual(withNoncurrent.data.balanceSheet.accountsReceivable, [90, 91, 92]);
  assert.ok(!withNoncurrent.quality.warnings.some((w) => w.includes('multiple different values')), '비유동 계정은 후보에서 제외된다');
  // strong 이 있으면 weak 값을 쓰지 않고 warning 도 없다
  const strong = okRun(withRows(BASE, acc('매입채무및기타채무', 'BS', [999, 999, 999], 'ifrs-full_TradeAndOtherCurrentPayables')));
  assert.deepEqual(strong.data.balanceSheet.accountsPayable, [5, 6, 7]);
  assert.ok(!strong.quality.warnings.some((w) => w.includes('broader')));
  assert.equal(strong.quality.fields.accountsPayable?.status, 'available');
});

// 5. IS / CIS 중복
test('IS 와 CIS 에 같은 값이 중복돼도 합산하지 않고 대표 하나만 쓰며 selection 을 기록한다', () => {
  const r = okRun([...without('당기순이익'), ...acc('당기순이익', 'IS', [15, 18, 21], 'ifrs-full_ProfitLoss', 'IS'), ...acc('당기순이익', 'IS', [15, 18, 21], 'ifrs-full_ProfitLoss', 'CIS')]);
  assert.deepEqual(r.data.incomeStatement.netIncome, [15, 18, 21]);
  assert.equal(r.quality.fields.netIncome?.status, 'available');
  const t = traceFor(r.quality, 'netIncome', 2025)!;
  assert.equal(t.rawStatementType, 'IS');
  assert.match(t.selection!, /same value in IS and CIS; counted once/);
  // 값이 다르면 ambiguous
  const diff = okRun([...without('당기순이익'), ...acc('당기순이익', 'IS', [15, 18, 21], 'ifrs-full_ProfitLoss', 'IS'), ...acc('당기순이익', 'IS', [1, 1, 1], 'ifrs-full_ProfitLoss', 'CIS')]);
  assert.equal(diff.quality.fields.netIncome?.status, 'ambiguous');
  // 실제 삼성전자: 포괄손익계산서(CIS)에도 같은 값이 있다
  const s = okRun(FX.samsung.accounts);
  assert.ok(FX.samsung.accounts.some((a) => a.accountName === '당기순이익' && a.rawStatementType === 'CIS'));
  assert.match(traceFor(s.quality, 'netIncome', 2025)!.selection!, /counted once/);
  // 손익계산서 없이 포괄손익계산서만 있는 SK하이닉스도 매핑된다
  assert.ok(!FX.hynix.accounts.some((a) => a.rawStatementType === 'IS'));
  assert.deepEqual(okRun(FX.hynix.accounts).data.incomeStatement.revenue, [32765719, 66192960, 97146675]);
});

// 6. 부채 구성
test('이자부부채는 구성 계정을 합산하고 components 를 기록하며 리스부채는 포함하지 않는다', () => {
  const r = okRun(withRows(BASE,
    acc('단기차입금', 'BS', [10, 11, 12]), acc('유동성장기부채', 'BS', [1, 1, 1], 'ifrs-full_CurrentPortionOfLongtermBorrowings'), acc('사채', 'BS', [5, 6, 7], 'ifrs-full_NoncurrentPortionOfNoncurrentBondsIssued'),
    acc('장기차입금', 'BS', [20, 21, 22], 'ifrs-full_NoncurrentPortionOfNoncurrentLoansReceived'),
    acc('리스부채', 'BS', [3, 3, 3], 'ifrs-full_CurrentLeaseLiabilities'), acc('리스부채', 'BS', [4, 4, 4], 'ifrs-full_NoncurrentLeaseLiabilities'),
    acc('예수부채가 아닌 부채', 'BS', [777, 777, 777])));
  assert.deepEqual(r.data.balanceSheet.interestBearingDebt, [36, 39, 42]);
  const t = traceFor(r.quality, 'interestBearingDebt', 2024)!;
  assert.equal(t.matchType, 'sum');
  assert.deepEqual(t.components?.map((c) => [c.accountName, c.value]), [['단기차입금', 11], ['유동성장기부채', 1], ['사채', 6], ['장기차입금', 21]]);
  assert.deepEqual(t.components?.map((c) => c.matchType), ['exact-name', 'account-id', 'account-id', 'account-id']);
  // 리스부채는 이자부부채에 섞이지 않고 따로 보존된다
  assert.deepEqual(r.data.balanceSheet.leaseLiabilities, [7, 7, 7]);
  assert.ok(r.quality.warnings.some((w) => w.startsWith('Lease liabilities found but not included')));
  // 같은 계정을 두 구성요소가 이중 집계하지 않는다
  const dup = okRun(withRows(BASE, acc('차입금', 'BS', [10, 10, 10], 'ifrs-full_CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings'), acc('차입금', 'BS', [20, 20, 20], 'ifrs-full_LongtermBorrowings')));
  assert.deepEqual(dup.data.balanceSheet.interestBearingDebt, [30, 30, 30]);
  // 실제 삼성전자: 4개 구성 / 리스부채 없음
  const s = okRun(FX.samsung.accounts);
  assert.deepEqual(traceFor(s.quality, 'interestBearingDebt', 2025)!.components!.map((c) => c.accountName), ['단기차입금', '유동성장기부채', '사채', '장기차입금']);
  assert.equal(s.data.balanceSheet.leaseLiabilities, undefined);
  // 실제 SK하이닉스: 차입금(유동/장기) 를 ID 로 찾는다
  assert.equal(okRun(FX.hynix.accounts).data.balanceSheet.interestBearingDebt?.[2], 22247905);
});

// 7·8. D&A / missing ≠ 0
test('D&A 는 missing 으로 유지되고, 어떤 필드도 missing 이 0 으로 바뀌지 않는다', () => {
  for (const fx of [FX.samsung, FX.hyundai, FX.hynix]) {
    const r = okRun(fx.accounts);
    assert.equal(r.data.cashFlow.depreciationAmortization, undefined);
    assert.equal(r.quality.fields.depreciationAmortization?.status, 'missing');
    assert.ok(r.quality.warnings.includes('D&A not available from current OpenDART financial statement source.'));
  }
  // 금액이 비어 있는(null) 계정은 값이 아니다
  const blank = okRun(withRows(BASE, YEARS.map((y): DartRawAccount => ({ accountName: '현금및현금성자산', accountId: 'ifrs-full_CashAndCashEquivalents', statementType: 'BS', basis: 'Consolidated', fiscalYear: y, amount: null, unit: 'KRW', raw: {} }))));
  assert.equal(blank.data.balanceSheet.cash, undefined);
  assert.equal(blank.quality.fields.cash?.status, 'missing');
  // 필수 계정이 비면 0 으로 채우지 않고 실패
  const r = run(without('재고자산'));
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.code, 'incomplete');
  // 직접 D&A 계정이 있으면 사용, 합산 계정이 있으면 합계만 사용 (이중 집계 방지)
  const direct = okRun(withRows(BASE, acc('감가상각비', 'CF', [30, 31, 32]), acc('무형자산상각비', 'CF', [3, 3, 4])));
  assert.deepEqual(direct.data.cashFlow.depreciationAmortization, [33, 34, 36]);
  const combined = okRun(withRows(BASE, acc('감가상각비 및 무형자산상각비', 'CF', [40, 41, 42]), acc('감가상각비', 'CF', [30, 31, 32])));
  assert.deepEqual(combined.data.cashFlow.depreciationAmortization, [40, 41, 42]);
  assert.equal(traceFor(combined.quality, 'depreciationAmortization', 2023)!.components!.length, 1);
});

// 9. CAPEX 정책
test('CAPEX: PPE / 무형 취득을 분리 보존하고 capexForValuation 이 두 정의를 제공한다', () => {
  const r = okRun(FX.samsung.accounts);
  assert.deepEqual(r.data.cashFlow.ppeAcquisition, [57611292, 51406355, 47522179]);
  assert.deepEqual(r.data.cashFlow.intangibleAcquisition, [2922875, 2335284, 4630970]);
  assert.deepEqual(capexForValuation(r.data), [57611292, 51406355, 47522179]);
  assert.deepEqual(capexForValuation(r.data, 'ppe+intangible'), [60534167, 53741639, 52153149]);
  assert.equal(DEFAULT_CAPEX_BASIS, 'ppe');
  assert.match(CAPEX_BASIS_LABELS.ppe, /PPE only/);
  assert.match(CAPEX_BASIS_LABELS['ppe+intangible'], /PPE \+ Intangible/);
  // 취득 계정은 부호와 무관하게 크기로 저장 (유형자산의 처분은 매핑하지 않는다)
  const neg = okRun(withRows(without('유형자산의 취득'), acc('유형자산의 취득', 'CF', [-12, -13, -14]), acc('유형자산의 처분', 'CF', [1, 1, 1])));
  assert.deepEqual(neg.data.cashFlow.ppeAcquisition, [12, 13, 14]);
  const hist = readFileSync(new URL('../engine/historicalView.ts', import.meta.url), 'utf8');
  assert.ok(hist.includes('CAPEX (PPE acquisition basis)'), 'Historical 화면이 CAPEX 기준을 표시한다');
});

// 10. 회계 항등식
test('회계 항등식 위반은 데이터를 고치지 않고 warning 만 추가한다 (tolerance 적용)', () => {
  const good = okRun(BASE);
  assert.ok(good.quality.checks.some((c) => c.name === 'assets = liabilities + equity' && c.status === 'pass'));
  assert.ok(good.quality.checks.some((c) => c.name === 'gross profit = revenue - cogs' && c.status === 'pass'));
  assert.ok(good.quality.checks.some((c) => c.name === 'operating margin in range' && c.status === 'pass'));
  assert.ok(good.quality.checks.some((c) => c.name === 'nwc computable'));
  assert.ok(!good.quality.warnings.some((w) => /differ|anomaly|mismatch/.test(w)));
  const bad = okRun([...without('자산총계', '매출총이익'), ...acc('자산총계', 'BS', [300, 400, 340], 'ifrs-full_Assets'), ...acc('매출총이익', 'IS', [40, 45, 99], 'ifrs-full_GrossProfit')]);
  assert.ok(bad.quality.warnings.some((w) => w.includes('differ from Liabilities + Equity') && w.includes('2024')));
  assert.ok(bad.quality.warnings.some((w) => w.includes('Gross Profit') && w.includes('2025')));
  assert.deepEqual(bad.data.balanceSheet.totalAssets, [300, 400, 340], '값은 수정하지 않는다');
  // 반올림 수준의 차이는 경고하지 않는다
  const rounding = okRun([...without('자산총계'), ...acc('자산총계', 'BS', [300, 320, 340], 'ifrs-full_Assets').map((a) => ({ ...a, amount: (a.amount ?? 0) + 400_000 }))]);
  assert.ok(!rounding.quality.warnings.some((w) => w.includes('differ from Liabilities + Equity')));
  // 실제 삼성전자 / 현대차 / SK하이닉스는 항등식을 모두 통과한다
  for (const fx of [FX.samsung, FX.hyundai, FX.hynix]) {
    const r = okRun(fx.accounts);
    assert.deepEqual(r.quality.checks.filter((c) => c.status === 'warn'), []);
    assert.ok(r.quality.checks.some((c) => c.name === 'assets = liabilities + equity' && c.status === 'pass'));
  }
});

// 11. 연도 간 검증
test('연도 간 검증: 한 해만 비면 partial, 부호 이상 · 단위 불일치 warning', () => {
  const missingYear = BASE.filter((a) => !(a.accountName === '재고자산' && a.fiscalYear === 2024));
  const r = run(missingYear);
  assert.ok(!r.ok);
  assert.equal(r.quality.fields.inventory?.status, 'partial');
  assert.deepEqual(r.quality.fields.inventory?.missingYears, [2024]);
  // 선택 계정도 한 해만 비면 partial 이고 값은 만들지 않는다
  const cashPartial = okRun(withRows(BASE, acc('현금및현금성자산', 'BS', [1, 2, 3], 'ifrs-full_CashAndCashEquivalents').filter((a) => a.fiscalYear !== 2023)));
  assert.equal(cashPartial.quality.fields.cash?.status, 'partial');
  assert.equal(cashPartial.data.balanceSheet.cash, undefined);
  assert.ok(cashPartial.quality.warnings.includes('Cash missing for 2023'));
  const sign = okRun([...without('재고자산'), ...acc('재고자산', 'BS', [8, -9, 10], 'ifrs-full_Inventories')]);
  assert.ok(sign.quality.warnings.includes('Sign anomaly: inventory is negative in 2024'));
  const unit = okRun([...without('매출액'), ...acc('매출액', 'IS', [100, 110, 120000], 'ifrs-full_Revenue')]);
  assert.ok(unit.quality.warnings.some((w) => w.startsWith('Possible unit mismatch: revenue')));
  // 같은 연도 중복값은 ambiguous (STEP 06-3 의 duplicate 와 연결)
  const dup = okRun(withRows(BASE, acc('매출액', 'IS', [1, 1, 1], 'ifrs-full_Revenue')));
  assert.equal(dup.quality.fields.revenue?.status, 'ambiguous');
});

// 12. mapping trace
test('Mapping trace: 어떤 계정에서 왔는지 역추적할 수 있다', () => {
  const r = okRun(FX.samsung.accounts);
  const t = traceFor(r.quality, 'revenue', 2025)!;
  assert.deepEqual([t.value, t.sourceAccountName, t.sourceAccountId, t.matchType, t.rawStatementType, t.basis], [333605938, '매출액', 'ifrs-full_Revenue', 'account-id', 'IS', 'CFS']);
  const ar = traceFor(r.quality, 'accountsReceivable', 2024)!;
  assert.deepEqual([ar.sourceAccountId, ar.matchType, ar.rawStatementType], ['ifrs-full_CurrentTradeReceivables', 'account-id', 'BS']);
  assert.equal(traceFor(r.quality, 'depreciationAmortization', 2025), undefined, '값이 없으면 trace 도 없다');
  for (const f of ['revenue', 'operatingProfit', 'netIncome', 'accountsReceivable', 'inventory', 'accountsPayable', 'cash', 'interestBearingDebt', 'cfo', 'ppeAcquisition', 'intangibleAcquisition'] as const) {
    for (const y of YEARS) assert.ok(traceFor(r.quality, f, y), `${f} ${y}`);
  }
  const sep = okRun(BASE.map((a) => ({ ...a, basis: 'Separate' as const })));
  assert.equal(traceFor(sep.quality, 'revenue', 2023)!.basis, 'OFS');
  assert.equal(sep.data.company.basis, 'Separate');
  assert.equal(r.quality.fields.revenue?.source, 'OpenDART Financial Statement');
});

// 13. 원본 불변
test('정규화는 원본 Raw 를 변경하지 않는다 (모든 fixture)', () => {
  for (const [name, fx] of Object.entries(FX)) {
    const accounts = structuredClone(fx.accounts);
    const freeze = (o: unknown): void => { if (typeof o === 'object' && o !== null) { Object.values(o).forEach(freeze); Object.freeze(o); } };
    freeze(accounts);
    const snap = JSON.stringify(accounts);
    assert.doesNotThrow(() => run(accounts), name);
    assert.equal(JSON.stringify(accounts), snap, name);
  }
});

// 14. Samsung 실제
test('삼성전자 실제 응답: 모든 canonical 필드가 account-id 로 매핑되고 학습용 fixture 와 같은 값이 나온다', () => {
  const r = okRun(FX.samsung.accounts);
  for (const sec of ['incomeStatement', 'balanceSheet', 'cashFlow'] as const) {
    for (const [k, v] of Object.entries(expected[sec])) assert.deepEqual((r.data[sec] as unknown as Record<string, number[]>)[k], v, `${sec}.${k}`);
  }
  const ids = ['revenue', 'operatingProfit', 'netIncome', 'accountsReceivable', 'inventory', 'accountsPayable', 'cash', 'cfo', 'ppeAcquisition', 'intangibleAcquisition'] as const;
  for (const f of ids) assert.equal(r.quality.fields[f]?.matchType, 'account-id', f);
  assert.equal(r.quality.fields.accountsPayable?.status, 'available');
  assert.deepEqual(r.quality.warnings, ['D&A not available from current OpenDART financial statement source.']);
  // 실제 응답에서 확인한 표준 accountId 가 규칙에 반영되어 있다
  const ruleIds = ACCOUNT_RULES.flatMap((x) => [...(x.ids ?? []), ...(x.parts ?? []).flatMap((p) => p.ids ?? [])]);
  for (const id of ['ifrs-full_CurrentTradeReceivables', 'ifrs-full_TradeAndOtherCurrentPayablesToTradeSuppliers', 'ifrs-full_CashAndCashEquivalents', 'ifrs-full_NoncurrentPortionOfNoncurrentBondsIssued']) assert.ok(ruleIds.includes(id), id);
});

// 15. 추가 기업
test('추가 기업(현대자동차 · SK하이닉스): 매핑 결과와 기업별 warning', () => {
  const hy = okRun(FX.hyundai.accounts);
  assert.deepEqual(hy.data.incomeStatement.revenue, [162663579, 175231153, 186254472]);
  assert.deepEqual(hy.data.incomeStatement.netIncome, [12272301, 13229908, 10364775]);
  assert.deepEqual(hy.data.incomeStatement.operatingProfit, [15126901, 14239592, 11467851]);
  assert.equal(hy.quality.fields.accountsPayable?.matchType, 'account-id'); // dart_ShortTermTradePayables
  assert.equal(hy.quality.fields.netIncome?.status, 'available'); // 연결당기순이익
  assert.ok(hy.data.balanceSheet.leaseLiabilities && hy.data.balanceSheet.leaseLiabilities.length === 3);
  // 금융 자회사를 연결하는 제조업: 부채 · 운전자본이 금융 부문을 포함할 수 있다는 경고
  assert.ok(hy.quality.warnings.some((w) => w.includes('financial-business')));
  const hx = okRun(FX.hynix.accounts);
  assert.deepEqual(hx.data.incomeStatement.operatingProfit.length, 3);
  assert.ok(!hx.quality.warnings.some((w) => w.includes('financial-business')));
  assert.equal(hx.data.company.basis, 'Consolidated');
});

// 16. 미지원 구조 / 금융업
test('금융업과 성격별 비용 구조는 숫자를 만들지 않고 미지원으로 돌려준다', () => {
  const kb = run(FX.kb.accounts);
  assert.ok(!kb.ok);
  if (!kb.ok) {
    assert.equal(kb.code, 'unsupported-industry');
    assert.match(kb.reason, /금융업/);
    assert.ok(kb.quality.warnings.some((w) => w.startsWith('Unsupported statement structure (financial)')));
    // 이름이 비슷한 계정으로 억지 매핑하지 않는다
    assert.equal(kb.quality.fields.revenue?.status, 'missing');
    assert.equal(kb.quality.fields.accountsReceivable?.status, 'missing');
  }
  const nv = run(FX.naver.accounts);
  assert.ok(!nv.ok);
  if (!nv.ok) {
    assert.equal(nv.code, 'unsupported-structure');
    assert.match(nv.reason, /성격별/);
    assert.equal(nv.quality.fields.revenue?.status, 'available'); // 찾은 것은 찾았다고 보고하되
    assert.ok(!('data' in nv)); // 데이터를 만들지 않는다
  }
  // Repository 는 unsupported 로 돌려주고 fixture 로 대체하지 않는다
  const client = new BackendDartClient({ fetch: async () => ({ ok: true, status: 200, json: async () => FX.kb }) });
  return new DartFinancialRepository(client).getHistoricalFinancials({ corpCode: '00688996', fiscalYears: YEARS }).then((res) => {
    assert.ok(!res.ok);
    if (!res.ok) { assert.equal(res.reason, 'unsupported'); assert.match(res.message, /금융업/); }
  });
});

test('품질 점수는 만들지 않고 상태 + warnings 로만 설명한다', () => {
  const r = okRun(FX.samsung.accounts);
  assert.ok(!('score' in r.quality));
  assert.ok(Object.values(r.quality.fields).every((f) => ['available', 'partial', 'missing', 'ambiguous'].includes(f!.status)));
});
