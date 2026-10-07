// STEP 06-2: 기업 선택 / 출처 표시 / Fixture 와 OpenDART 구분.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { companyView, errorMessage, historicalSourceView, selectCompany } from './companySelection.ts';
import { emptyProjectState, restoreProjectState, toPersisted, withSamsungHistorical, withSelectedCompany, withPracticeAssumptions } from './projectModel.ts';
import { DartClientError } from '../data/dart/client.ts';
import type { CompanyProfile, FinancialRepository } from '../data/repository/financialRepository.ts';
import { samsungHistoricalData } from '../data/samsungHistorical.ts';
import { fromSamsungFixture } from '../data/repository/fixtureAdapter.ts';

const FETCHED = '2026-01-01T00:00:00+00:00';
const profile: CompanyProfile = { name: '삼성전자', corpCode: '00126380', stockCode: '005930', source: 'OpenDART' };

function repo(over: Partial<FinancialRepository> = {}): FinancialRepository & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    searchCompanies: async () => { calls.push('search'); return [profile]; },
    getCompany: async (ref) => { calls.push(`company:${ref.corpCode}`); return { ...profile, name: '삼성전자(주)', nameEng: 'SAMSUNG ELECTRONICS', corpClass: 'Y', fetchedAt: FETCHED }; },
    getHistoricalFinancials: async () => { calls.push('financials'); return { ok: false, reason: 'not-implemented', message: 'x' }; },
    ...over,
  };
}

test('기업 선택: 개황을 조회해 SelectedCompany 를 만들고 재무데이터는 요청하지 않는다', async () => {
  const r = repo();
  const res = await selectCompany(r, profile);
  assert.ok(res.ok);
  assert.deepEqual(res.company, { corpCode: '00126380', corpName: '삼성전자(주)', corpNameEng: 'SAMSUNG ELECTRONICS', stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: FETCHED });
  assert.deepEqual(r.calls, ['company:00126380']);
});

test('기업 선택 실패: corpCode 없음 / 조회 실패는 정제된 문구, 상태는 바뀌지 않는다', async () => {
  assert.equal((await selectCompany(repo(), { name: 'x', source: 'OpenDART' })).ok, false);
  const failing = repo({ getCompany: async () => { throw new DartClientError('rate-limit', '요청 한도를 초과했습니다.'); } });
  const res = await selectCompany(failing, profile);
  assert.ok(!res.ok && res.message === '요청 한도를 초과했습니다.');
  const leaky = repo({ getCompany: async () => { throw new Error('secret crtfc_key=abc'); } });
  const r2 = await selectCompany(leaky, profile);
  assert.ok(!r2.ok && !r2.message.includes('abc'));
  assert.equal(errorMessage(new Error('x')), '요청을 처리하지 못했습니다.');
  assert.ok(!(await selectCompany(repo({ getCompany: async () => null }), profile)).ok);
});

test('선택 기업 표시: Stock Code / Corp Code / Source=OpenDART / Fetched at', async () => {
  const res = await selectCompany(repo(), profile);
  assert.ok(res.ok);
  const v = companyView(res.company);
  assert.equal(v.title, '삼성전자(주)');
  const get = (l: string) => v.lines.find((x) => x.label === l)?.value;
  assert.deepEqual([get('Stock Code'), get('Corp Code'), get('Source'), get('Fetched at'), get('Market')], ['005930', '00126380', 'OpenDART', FETCHED, '유가증권']);
  assert.equal(companyView({ ...res.company, stockCode: null, corpNameEng: null, corpClass: null }).lines.find((x) => x.label === 'Stock Code')?.value, '비상장');
});

test('Fixture 와 OpenDART 는 상태와 표시가 모두 구분된다', async () => {
  const res = await selectCompany(repo(), profile);
  assert.ok(res.ok);
  // 기업을 선택해도 재무데이터가 붙지 않는다
  const picked = withSelectedCompany(emptyProjectState, res.company);
  assert.equal(picked.historicalData, null);
  // fixture 를 불러와도 선택 기업은 그대로, 선택 기업에 fixture 가 붙지도 않는다
  const both = withSamsungHistorical(picked);
  assert.equal(both.selectedCompany, res.company);
  assert.equal(both.historicalData, samsungHistoricalData);
  assert.equal(withSelectedCompany(both, null).historicalData, samsungHistoricalData);
  assert.equal(withPracticeAssumptions(both).selectedCompany, res.company);
  // 출처 표시
  assert.deepEqual(historicalSourceView(samsungHistoricalData), { source: 'Fixture', label: 'Fixture (학습용)', fetchedAt: null });
  assert.equal(historicalSourceView(fromSamsungFixture(FETCHED)).fetchedAt, FETCHED);
  assert.equal(historicalSourceView({ ...samsungHistoricalData, meta: undefined }).source, 'Fixture');
  assert.equal(historicalSourceView({ ...samsungHistoricalData, meta: { source: 'DART Annual Report', fetchedAt: FETCHED } }).source, 'OpenDART');
  assert.notEqual(companyView(res.company).lines.find((l) => l.label === 'Source')?.value, historicalSourceView(samsungHistoricalData).label);
  // 버튼도 구분된다
  const ws = readFileSync(new URL('../pages/Workspace.tsx', import.meta.url), 'utf8');
  const cs = readFileSync(new URL('../components/CompanySearch.tsx', import.meta.url), 'utf8');
  assert.ok(cs.includes('OpenDART 기업 검색'));
  assert.ok(ws.includes('삼성전자 학습용 Historical 불러오기'));
  assert.ok(ws.includes('<CompanySearch'));
});

test('선택 기업은 저장 / 복원되고, 손상된 값은 버려진다. 기업 선택은 가정 결과를 건드리지 않는다', async () => {
  const res = await selectCompany(repo(), profile);
  assert.ok(res.ok);
  const s = withSelectedCompany(withPracticeAssumptions(emptyProjectState), res.company);
  assert.equal(s.valuationResult, withPracticeAssumptions(emptyProjectState).valuationResult === null ? null : s.valuationResult);
  assert.ok(s.valuationResult, '가정 / 결과 유지');
  const restored = restoreProjectState(JSON.parse(JSON.stringify(toPersisted(s))));
  assert.deepEqual(restored.selectedCompany, res.company);
  for (const bad of [{ ...res.company, corpCode: '123' }, { ...res.company, source: 'Fixture' }, { ...res.company, fetchedAt: '' }, 'x', 5, null]) {
    assert.equal(restoreProjectState({ selectedCompany: bad }).selectedCompany, null);
  }
  assert.equal(restoreProjectState({ historicalData: null }).selectedCompany, null); // 이전 버전 저장값 호환
});

test('UI: 오래된 응답이 최신 결과를 덮어쓰지 않고, 재무 API 는 UI 에서도 호출하지 않는다', () => {
  const cs = readFileSync(new URL('../components/CompanySearch.tsx', import.meta.url), 'utf8');
  assert.ok(cs.includes('seq.current'));
  assert.ok(!/getHistoricalFinancials|fetchFinancials/.test(cs));
});
