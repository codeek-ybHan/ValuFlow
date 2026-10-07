// TS normalizer(src/data/normalization)가 source of truth 다. backend(Python) 는 여기서 내보낸 규칙을 읽고,
// 같은 입력에 대해 같은 결과를 내는지를 golden 파일로 검증한다.
//   node scripts/export-normalization.ts        → backend/app/normalization/rules.json, backend/tests/golden/*.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ACCOUNT_RULES, OPTIONAL_FIELDS, REQUIRED_FIELDS } from '../src/data/normalization/accounts.ts';
import { FINANCIAL_BS_IDS, FINANCIAL_BS_NAME_LIST, FINANCIAL_IS_NAME_LIST } from '../src/data/normalization/industry.ts';
import { ABS_TOL, REL_TOL, UNIT_JUMP } from '../src/data/normalization/checks.ts';
import { normalizeFinancials, type NormalizeInput } from '../src/data/normalization/normalizeFinancials.ts';
import type { DartRawAccount } from '../src/data/dart/types.ts';

export const rulesJson = () => JSON.stringify({
  requiredFields: REQUIRED_FIELDS, optionalFields: OPTIONAL_FIELDS, rules: ACCOUNT_RULES,
  industry: { financialBsIds: FINANCIAL_BS_IDS, financialBsNames: FINANCIAL_BS_NAME_LIST, financialIsNames: FINANCIAL_IS_NAME_LIST },
  checks: { relTol: REL_TOL, absTol: ABS_TOL, unitJump: UNIT_JUMP },
}, null, 1) + '\n';

const root = new URL('..', import.meta.url).pathname;
if (process.argv[1] && process.argv[1].endsWith('export-normalization.ts')) {
  mkdirSync(`${root}backend/app/normalization`, { recursive: true });
  mkdirSync(`${root}backend/tests/golden`, { recursive: true });
  writeFileSync(`${root}backend/app/normalization/rules.json`, rulesJson());

  const YEARS = [2023, 2024, 2025];
  const AT = '2026-01-01T00:00:00.000Z';
  const company = { name: 't', corpCode: '00000001', stockCode: '000001' };
  const load = (n: string) => JSON.parse(readFileSync(`${root}src/data/fixtures/${n}DartFinancials.json`, 'utf8')).accounts as DartRawAccount[];
  const out = (name: string, input: Partial<NormalizeInput> & { accounts: DartRawAccount[] }, embed: boolean, inputFile?: string) => {
    const full: NormalizeInput = { company, fiscalYears: YEARS, fetchedAt: AT, ...input };
    const r = normalizeFinancials(full);
    const { accounts, ...opts } = full;
    const body = { name, inputFile, accounts: embed ? accounts : undefined, options: opts, expected: r };
    writeFileSync(`${root}backend/tests/golden/${name}.json`, JSON.stringify(body, null, 1) + '\n');
  };
  for (const n of ['samsung', 'hyundai', 'hynix', 'naver', 'kb']) out(n, { accounts: load(n) }, false, `src/data/fixtures/${n}DartFinancials.json`);

  // 합성 케이스 (경계 동작)
  let k = 0;
  const acc = (name: string, st: DartRawAccount['statementType'], v: number[], id?: string, raw?: string, basis: DartRawAccount['basis'] = 'Consolidated'): DartRawAccount[] =>
    v.map((x, i) => ({ accountName: name, accountId: id, statementType: st, rawStatementType: raw ?? st, basis, fiscalYear: YEARS[i], amount: x * 1_000_000, unit: 'KRW' as const, raw: { k: ++k } }));
  const base = (basis: DartRawAccount['basis'] = 'Consolidated') => [
    ...acc('매출액', 'IS', [100, 110, 120], 'ifrs-full_Revenue', 'IS', basis), ...acc('매출원가', 'IS', [60, 65, 70], 'ifrs-full_CostOfSales', 'IS', basis), ...acc('매출총이익', 'IS', [40, 45, 50], 'ifrs-full_GrossProfit', 'IS', basis),
    ...acc('판매비와관리비', 'IS', [20, 21, 22], undefined, 'IS', basis), ...acc('영업이익', 'IS', [20, 24, 28], 'dart_OperatingIncomeLoss', 'IS', basis), ...acc('당기순이익', 'IS', [15, 18, 21], 'ifrs-full_ProfitLoss', 'IS', basis),
    ...acc('매출채권', 'BS', [10, 11, 12], 'ifrs-full_CurrentTradeReceivables', 'BS', basis), ...acc('재고자산', 'BS', [8, 9, 10], 'ifrs-full_Inventories', 'BS', basis),
    ...acc('매입채무', 'BS', [5, 6, 7], 'ifrs-full_TradeAndOtherCurrentPayablesToTradeSuppliers', 'BS', basis),
    ...acc('자산총계', 'BS', [300, 320, 340], 'ifrs-full_Assets', 'BS', basis), ...acc('부채총계', 'BS', [100, 110, 120], 'ifrs-full_Liabilities', 'BS', basis), ...acc('자본총계', 'BS', [200, 210, 220], 'ifrs-full_Equity', 'BS', basis),
    ...acc('영업활동현금흐름', 'CF', [30, 33, 36], undefined, 'CF', basis), ...acc('유형자산의 취득', 'CF', [-12, -13, -14], undefined, 'CF', basis), ...acc('무형자산의 취득', 'CF', [2, 3, 4], undefined, 'CF', basis),
  ];
  const without = (...names: string[]) => base().filter((a) => !names.includes(a.accountName));
  out('syn-base', { accounts: base() }, true);
  out('syn-separate-only', { accounts: base('Separate') }, true);
  out('syn-no-fallback', { accounts: base('Separate'), allowBasisFallback: false }, true);
  out('syn-weak-ap-ar', { accounts: [...without('매입채무', '매출채권'), ...acc('매입채무및기타채무', 'BS', [50, 60, 70], 'ifrs-full_TradeAndOtherCurrentPayables'), ...acc('매출채권및기타채권', 'BS', [500, 500, 500], 'ifrs-full_NoncurrentReceivables'), ...acc('매출채권및기타채권', 'BS', [90, 91, 92], 'ifrs-full_TradeAndOtherCurrentReceivables')] }, true);
  out('syn-is-cis-dup', { accounts: [...without('당기순이익'), ...acc('당기순이익', 'IS', [15, 18, 21], 'ifrs-full_ProfitLoss', 'IS'), ...acc('당기순이익', 'IS', [15, 18, 21], 'ifrs-full_ProfitLoss', 'CIS'), ...acc('당기순이익', 'IS', [1, 1, 1], 'ifrs-full_ProfitLoss', 'CIS')] }, true);
  out('syn-debt-lease-da', { accounts: [...base(), ...acc('단기차입금', 'BS', [10, 11, 12]), ...acc('유동성장기부채', 'BS', [1, 1, 1], 'ifrs-full_CurrentPortionOfLongtermBorrowings'), ...acc('사채', 'BS', [5, 6, 7], 'ifrs-full_NoncurrentPortionOfNoncurrentBondsIssued'), ...acc('차입금', 'BS', [20, 21, 22], 'ifrs-full_LongtermBorrowings'), ...acc('리스부채', 'BS', [3, 3, 3], 'ifrs-full_CurrentLeaseLiabilities'), ...acc('리스부채', 'BS', [4, 4, 4], 'ifrs-full_NoncurrentLeaseLiabilities'), ...acc('감가상각비 및 무형자산상각비', 'CF', [40, 41, 42]), ...acc('감가상각비', 'CF', [30, 31, 32]), ...acc('현금및현금성자산', 'BS', [1, 2, 3], 'ifrs-full_CashAndCashEquivalents')] }, true);
  out('syn-partial-da-cash', { accounts: [...base(), ...acc('감가상각비', 'CF', [30, 31, 32]), ...acc('현금및현금성자산', 'BS', [1, 2, 3], 'ifrs-full_CashAndCashEquivalents').filter((a) => a.fiscalYear !== 2023)] }, true);
  out('syn-missing-inventory', { accounts: without('재고자산') }, true);
  out('syn-identity-sign-unit', { accounts: [...without('자산총계', '재고자산', '매출액'), ...acc('자산총계', 'BS', [300, 400, 340], 'ifrs-full_Assets'), ...acc('재고자산', 'BS', [8, -9, 10], 'ifrs-full_Inventories'), ...acc('매출액', 'IS', [100, 110, 120000], 'ifrs-full_Revenue')] }, true);
  out('syn-relative-periods', { accounts: base().map((a) => ({ ...a, fiscalYear: null, reportYear: 2025, periodLabel: ['전전기', '전기', '당기'][YEARS.indexOf(a.fiscalYear!)] })) }, true);
  out('syn-blank-amount', { accounts: [...base(), ...acc('현금및현금성자산', 'BS', [0, 0, 0], 'ifrs-full_CashAndCashEquivalents').map((a) => ({ ...a, amount: null }))] }, true);
  console.log('exported');
}
