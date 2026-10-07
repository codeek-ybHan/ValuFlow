// STEP 06-3 프론트: Raw 재무제표 fetch → DartRawAccount[] → repository → normalizeFinancials. 실제 네트워크 없음.
// fixtures/samsungDartFinancials.json 은 삼성전자 실제 OpenDART 응답(2023~2025, CFS)에서 관심 계정만 추린 backend 응답이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BackendDartClient } from './dart/client.ts';
import { DartFinancialRepository, defaultFiscalYears } from './repository/dartRepository.ts';
import { samsungHistoricalData as expected } from './samsungHistorical.ts';
import { normalizeFinancials } from './normalization/normalizeFinancials.ts';
import type { DartFinancialsResponse, DartRawAccount } from './dart/types.ts';

const RESPONSE = JSON.parse(readFileSync(new URL('./fixtures/samsungDartFinancials.json', import.meta.url), 'utf8')) as DartFinancialsResponse;
const clone = <T,>(v: T): T => structuredClone(v);

function fetchReturning(build: (url: string) => { status?: number; body: unknown }) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const r = build(url);
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.body };
  };
  return { fn, calls };
}
const ok = (resp: DartFinancialsResponse = RESPONSE) => fetchReturning(() => ({ body: resp }));
const repoWith = (f: ReturnType<typeof fetchReturning>) => new DartFinancialRepository(new BackendDartClient({ fetch: f.fn }), () => new Date('2026-10-07'));

test('fetchFinancials: backend 경로로만 요청하고 DartRawAccount[] 를 만든다 (raw / null 금액 보존)', async () => {
  const resp = clone(RESPONSE);
  resp.accounts.push({ ...clone(resp.accounts[0]), accountName: '빈 금액 계정', amount: null });
  const f = ok(resp);
  const r = await new BackendDartClient({ fetch: f.fn }).fetchFinancials({ corpCode: '00126380', years: [2025, 2023, 2024] });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0], '/api/companies/00126380/financials?years=2023%2C2024%2C2025&basis=auto'); // OpenDART 파라미터(reprt_code, fs_div …)는 없다
  assert.equal(r.accounts.length, resp.accounts.length);
  const rev = r.accounts.find((a) => a.accountName === '매출액' && a.fiscalYear === 2025)!;
  assert.equal(rev.statementType, 'IS');
  assert.equal(rev.basis, 'Consolidated');
  assert.equal(rev.unit, 'KRW');
  assert.equal(rev.raw.account_nm, '매출액'); // 원본 행 보존
  assert.equal(r.accounts.find((a) => a.accountName === '빈 금액 계정')!.amount, null, '빈 값은 0 이 아니다');
  assert.equal(r.quality.basisUsed, 'Consolidated');
  assert.deepEqual(r.quality.missingYears, []);
  assert.equal((await new BackendDartClient({ fetch: fetchReturning(() => ({ body: RESPONSE })).fn }).fetchFinancials({ corpCode: '00126380', years: [2025], basis: 'separate', refresh: true })).corpCode, '00126380');
});

test('fetchFinancials: 형식이 틀린 행은 버리고 warning 을 남기며, 응답이 깨졌으면 오류', async () => {
  const resp = clone(RESPONSE);
  (resp.accounts as unknown[]).push({ accountName: 'x', statementType: 'BS', basis: 'Consolidated', fiscalYear: 2025, amount: '123', raw: {} }, 'junk', { accountName: 'y', statementType: 'ZZ' });
  const r = await new BackendDartClient({ fetch: ok(resp).fn }).fetchFinancials({ corpCode: '00126380', years: [2025] });
  assert.equal(r.accounts.length, RESPONSE.accounts.length);
  assert.ok(r.quality.warnings.includes('3 malformed account row(s) dropped'));
  await assert.rejects(new BackendDartClient({ fetch: fetchReturning(() => ({ body: { accounts: 'x' } })).fn }).fetchFinancials({ corpCode: '1', years: [2025] }), /해석/);
});

test('Repository: Raw fetch → normalizeFinancials → HistoricalData (실제 삼성전자 응답)', async () => {
  const f = ok();
  const r = await repoWith(f).getHistoricalFinancials({ corpCode: '00126380', stockCode: '005930', companyName: '삼성전자', fiscalYears: [2023, 2024, 2025] });
  assert.ok(r.ok);
  assert.equal(f.calls.length, 1);
  assert.deepEqual([r.data.company.name, r.data.company.ticker, r.data.company.basis, r.data.company.period], ['삼성전자', '005930', 'Consolidated', ['2023A', '2024A', '2025A']]);
  assert.deepEqual([r.data.meta?.source, r.data.meta?.corpCode, r.data.meta?.fetchedAt], ['DART Annual Report', '00126380', RESPONSE.fetchedAt]);
  // 실제 공시 값이 학습용 fixture 와 같다 (KRW → KRW million 환산 포함)
  for (const sec of ['incomeStatement', 'balanceSheet', 'cashFlow'] as const) {
    for (const [k, v] of Object.entries(expected[sec])) assert.deepEqual((r.data[sec] as unknown as Record<string, number[]>)[k], v, `${sec}.${k}`);
  }
  // 선택 계정: Cash / 이자부부채(4개 계정 합) 는 있고, D&A 는 삼성전자 재무제표 본문에 없다
  assert.deepEqual(r.data.balanceSheet.cash, [69080893, 53705579, 57856378]);
  const debt = (y: number) => RESPONSE.accounts.filter((x) => x.statementType === 'BS' && ['단기차입금', '유동성장기부채', '사채', '장기차입금'].includes(x.accountName) && x.fiscalYear === y)
    .reduce((s, x) => s + (x.amount ?? 0) / 1_000_000, 0);
  assert.deepEqual(r.data.balanceSheet.interestBearingDebt, [2023, 2024, 2025].map(debt));
  assert.equal(r.data.balanceSheet.interestBearingDebt?.[2], 25239139); // 17,574,980 + 1,177,508 + 7,134 + 6,479,517
  assert.equal(r.data.cashFlow.depreciationAmortization, undefined);
  assert.ok(r.quality.warnings.includes('D&A account not found'));
  assert.deepEqual([r.fetch?.basisUsed, r.fetch?.yearsReceived], ['Consolidated', [2023, 2024, 2025]]);
  assert.equal(r.quality.basisFallback, false);
});

test('Repository: 기본 연도는 직전 3개 사업연도이고, corpCode 가 없으면 요청하지 않는다', async () => {
  assert.deepEqual(defaultFiscalYears(new Date('2026-10-07')), [2023, 2024, 2025]);
  assert.deepEqual(defaultFiscalYears(new Date('2026-02-01')), [2022, 2023, 2024]); // 아직 전년도 사업보고서 제출 전
  const f = ok();
  const repo = repoWith(f);
  await repo.getHistoricalFinancials({ corpCode: '00126380' });
  assert.ok(f.calls[0].includes('years=2023%2C2024%2C2025'));
  const n = f.calls.length;
  const r = await repo.getHistoricalFinancials({ stockCode: '005930' });
  assert.ok(!r.ok && r.reason === 'not-found');
  assert.equal(f.calls.length, n);
});

test('별도재무제표만 받으면 Separate 로 기록하고 fallback warning 을 남긴다 (연결/별도를 섞지 않는다)', async () => {
  const sep = clone(RESPONSE);
  sep.accounts = sep.accounts.map((a) => ({ ...a, basis: 'Separate' as const }));
  sep.quality = { ...sep.quality, basisUsed: 'Separate', basisFallback: true, warnings: ['Separate statements used because consolidated data unavailable'] };
  const r = await repoWith(ok(sep)).getHistoricalFinancials({ corpCode: '00126380', fiscalYears: [2023, 2024, 2025] });
  assert.ok(r.ok);
  assert.equal(r.data.company.basis, 'Separate');
  assert.equal(r.quality.basisFallback, true);
  assert.ok(r.quality.warnings.includes('Separate statements used because consolidated data unavailable'));
  // 한 dataset 에 두 기준이 섞여 오면 선호 기준(연결) 쪽만 쓴다
  const mixed = clone(RESPONSE);
  const sepRows = clone(RESPONSE).accounts.map((a) => ({ ...a, basis: 'Separate' as const, amount: (a.amount ?? 0) * 2 }));
  mixed.accounts = [...mixed.accounts.filter((a) => a.statementType !== 'CF'), ...sepRows.filter((a) => a.statementType === 'CF')];
  const m = await repoWith(ok(mixed)).getHistoricalFinancials({ corpCode: '00126380', fiscalYears: [2023, 2024, 2025] });
  // 현재 데이터(연결 IS/BS + 별도 CF)는 어느 기준으로도 완전하지 않으므로 값을 섞어 쓰지 않고 실패한다
  assert.ok(!m.ok);
});

test('fixture fallback 없음: 정규화 실패 → incomplete, 요청 실패 → unavailable, 데이터 없음 → not-found', async () => {
  // 필수 계정(재고자산)이 빠진 응답
  const partial = clone(RESPONSE);
  partial.accounts = partial.accounts.filter((a) => a.accountName !== '재고자산');
  const inc = await repoWith(ok(partial)).getHistoricalFinancials({ corpCode: '00126380', fiscalYears: [2023, 2024, 2025] });
  assert.ok(!inc.ok);
  if (!inc.ok) {
    assert.equal(inc.reason, 'incomplete');
    assert.match(inc.message, /inventory/);
    assert.equal((inc as { data?: unknown }).data, undefined);
    assert.ok(inc.quality?.warnings.some((w) => w.startsWith('Inventory account not found')));
  }
  const err = (status: number, code: string) => fetchReturning(() => ({ status, body: { error: { code, message: '메시지' } } }));
  const down = await repoWith(err(503, 'dart-unavailable')).getHistoricalFinancials({ corpCode: '00126380' });
  assert.ok(!down.ok && down.reason === 'unavailable' && down.message === '메시지');
  const none = await repoWith(err(404, 'no-data')).getHistoricalFinancials({ corpCode: '00126380' });
  assert.ok(!none.ok && none.reason === 'not-found');
  const dead = await repoWith({ fn: async () => { throw new TypeError('x'); }, calls: [] }).getHistoricalFinancials({ corpCode: '00126380' });
  assert.ok(!dead.ok && dead.reason === 'unavailable');
  // 코드에 fixture 대체 경로가 없다
  const src = readFileSync(new URL('./repository/dartRepository.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/import[^;]*(fixture|samsungHistorical)/i.test(src));
});

test('normalizeFinancials 가 받는 Raw 는 backend 응답 그대로의 DartRawAccount 이다 (변환 없이 연결)', () => {
  const accounts: DartRawAccount[] = RESPONSE.accounts;
  const r = normalizeFinancials({ company: { name: '삼성전자', corpCode: '00126380', stockCode: '005930' }, accounts, fiscalYears: [2023, 2024, 2025], fetchedAt: RESPONSE.fetchedAt });
  assert.ok(r.ok);
  // 포괄손익계산서(CIS)는 backend 가 IS 로 묶었고 raw 구분은 남아 있다
  assert.ok(accounts.some((a) => a.statementType === 'IS' && a.rawStatementType === 'CIS'));
  const before = JSON.stringify(accounts);
  normalizeFinancials({ company: { name: 'x' }, accounts, fiscalYears: [2025], fetchedAt: RESPONSE.fetchedAt });
  assert.equal(JSON.stringify(accounts), before);
});
