// STEP 06-6 프론트: DatabaseFinancialRepository (backend 가 정규화 · 저장한 결과를 받는다) + 규칙 내보내기 최신 여부.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BackendDartClient } from './dart/client.ts';
import { DatabaseFinancialRepository } from './repository/databaseRepository.ts';
import type { FinancialRepository } from './repository/financialRepository.ts';
import type { DartHistoricalResponse } from './dart/types.ts';
import { rulesJson } from '../../scripts/export-normalization.ts';
import { buildHistoricalView } from '../engine/historicalView.ts';
import { analyzeHistorical } from '../engine/historicalAnalysis.ts';

const golden = (n: string) => JSON.parse(readFileSync(new URL(`../../backend/tests/golden/${n}.json`, import.meta.url), 'utf8')).expected;
const FETCH = { basisRequested: 'Consolidated', basisUsed: 'Consolidated', basisFallback: false, yearsRequested: [2023, 2024, 2025], yearsReceived: [2023, 2024, 2025], missingYears: [], rawAccountCount: 78, warnings: [] };

function backendOk(source: 'database' | 'opendart' = 'database'): DartHistoricalResponse {
  const g = golden('samsung');
  return { status: 'ok', corpCode: '00126380', source, persisted: true, fetchId: 7, fetchedAt: '2026-01-01T00:00:00+00:00', data: g.data, quality: g.quality, fetch: FETCH as DartHistoricalResponse['fetch'] };
}
function backendUnsupported(name: string, code: string): DartHistoricalResponse {
  const g = golden(name);
  return { status: 'unsupported', corpCode: '00688996', source: 'database', persisted: true, fetchId: 9, fetchedAt: '2026-01-01T00:00:00+00:00', quality: g.quality, fetch: FETCH as DartHistoricalResponse['fetch'], code: code as 'unsupported-industry', reason: g.reason, missingRequired: g.missingRequired };
}
function repoWith(handler: (url: string) => { status?: number; body: unknown }) {
  const calls: string[] = [];
  const fn = async (url: string) => { calls.push(url); const r = handler(url); const status = r.status ?? 200; return { ok: status < 300, status, json: async () => r.body }; };
  return { repo: new DatabaseFinancialRepository(new BackendDartClient({ fetch: fn }), () => new Date('2026-10-07')) as FinancialRepository, calls };
}

test('DatabaseFinancialRepository: backend /historical 를 호출하고 정규화된 결과를 그대로 돌려준다 (프론트에서 다시 정규화하지 않는다)', async () => {
  const { repo, calls } = repoWith(() => ({ body: backendOk() }));
  const r = await repo.getHistoricalFinancials({ corpCode: '00126380', fiscalYears: [2023, 2024, 2025] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], '/api/companies/00126380/historical?years=2023%2C2024%2C2025&basis=auto'); // OpenDART / DB 파라미터를 모른다
  assert.ok(r.ok);
  assert.deepEqual(r.provenance, { source: 'database', persisted: true, fetchedAt: '2026-01-01T00:00:00+00:00', fetchId: 7 });
  assert.equal(r.data.company.name, 't');
  assert.equal(r.quality.fields.revenue?.matchType, 'account-id');
  assert.ok(r.quality.trace.length > 0 && r.quality.checks.length > 0, 'MappingTrace / checks 가 전달된다');
  // 기존 domain model 과 호환: Historical View / Analysis 에 그대로 쓸 수 있다
  assert.ok(buildHistoricalView(r.data, r.quality));
  assert.equal(analyzeHistorical(r.data, r.quality).metrics.operatingMargin.quality.status, 'available');
});

test('refresh / basis 요청은 backend 파라미터로만 전달된다', async () => {
  const { repo, calls } = repoWith(() => ({ body: backendOk('opendart') }));
  await repo.getHistoricalFinancials({ corpCode: '00126380', fiscalYears: [2025, 2023, 2024], preferredBasis: 'Separate', refresh: true });
  assert.equal(calls[0], '/api/companies/00126380/historical?years=2023%2C2024%2C2025&basis=separate&refresh=true');
  const r = await repo.getHistoricalFinancials({ corpCode: '00126380' });
  assert.ok(calls[1].includes('years=2023%2C2024%2C2025'), '연도를 주지 않으면 직전 3개 사업연도');
  assert.ok(r.ok && r.provenance?.source === 'opendart');
});

test('미지원 / 불완전 / 조회 실패는 사유 그대로 전달하고 fixture 로 대체하지 않는다', async () => {
  const kb = await repoWith(() => ({ body: backendUnsupported('kb', 'unsupported-industry') })).repo.getHistoricalFinancials({ corpCode: '00688996' });
  assert.ok(!kb.ok);
  if (!kb.ok) { assert.equal(kb.reason, 'unsupported'); assert.equal(kb.code, 'unsupported-industry'); assert.match(kb.message, /금융업/); assert.equal(kb.provenance?.source, 'database'); assert.ok(kb.quality); }
  const nv = await repoWith(() => ({ body: backendUnsupported('naver', 'unsupported-structure') })).repo.getHistoricalFinancials({ corpCode: '00266961' });
  assert.ok(!nv.ok && nv.reason === 'unsupported' && nv.code === 'unsupported-structure');
  const inc = await repoWith(() => ({ body: { ...backendUnsupported('syn-missing-inventory', 'incomplete'), status: 'incomplete' } })).repo.getHistoricalFinancials({ corpCode: '00126380' });
  assert.ok(!inc.ok && inc.reason === 'incomplete');
  const err = (status: number, code: string) => repoWith(() => ({ status, body: { error: { code, message: '정제된 메시지' } } })).repo.getHistoricalFinancials({ corpCode: '00126380' });
  const down = await err(503, 'dart-unavailable');
  assert.ok(!down.ok && down.reason === 'unavailable' && down.message === '정제된 메시지');
  const none = await err(404, 'no-data');
  assert.ok(!none.ok && none.reason === 'not-found');
  const bad = await repoWith(() => ({ body: { status: 'ok' } })).repo.getHistoricalFinancials({ corpCode: '00126380' });
  assert.ok(!bad.ok && bad.reason === 'unavailable');
  assert.ok(!(await repoWith(() => ({ body: {} })).repo.getHistoricalFinancials({})).ok);
  const src = readFileSync(new URL('./repository/databaseRepository.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/normalizeFinancials|fixture|samsungHistorical/i.test(src), '정규화는 backend 가 하며 fixture 를 쓰지 않는다');
});

test('검색 / 개황은 backend 를 통한다 (기존 FinancialRepository interface 그대로)', async () => {
  const { repo, calls } = repoWith((url) => (url.startsWith('/api/companies?')
    ? { body: { items: [{ corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', modifyDate: '20240101' }, { corpCode: '00999999', corpName: '비상장', stockCode: null, modifyDate: null }] } }
    : { body: { corpCode: '00126380', corpName: '삼성전자(주)', corpNameEng: 'S', stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: 'x' } }));
  assert.deepEqual((await repo.searchCompanies('삼성')).map((c) => [c.name, c.stockCode]), [['삼성전자', '005930'], ['비상장', undefined]]);
  assert.equal((await repo.getCompany({ corpCode: '00126380' }))?.corpClass, 'Y');
  assert.equal(await repo.getCompany({ stockCode: '005930' }), null);
  assert.equal(calls.length, 2);
});

test('backend 의 정규화 규칙 파일(rules.json)은 TS normalizer 의 현재 규칙과 같다 (source of truth 동기화)', () => {
  const committed = readFileSync(new URL('../../backend/app/normalization/rules.json', import.meta.url), 'utf8');
  assert.equal(committed, rulesJson(), 'npm run export:normalization 으로 다시 내보내세요');
});

test('프론트는 DB 에 직접 연결하지 않고 DATABASE_URL 을 모른다', () => {
  const walk = (dir: URL): string[] => [];
  void walk;
  for (const f of ['./dart/client.ts', './repository/databaseRepository.ts', './repository/defaultRepository.ts']) {
    const code = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/DATABASE_URL|postgres|psycopg|sqlalchemy/i.test(code), f);
  }
  const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
  assert.ok(!/DATABASE_URL|VITE_DATABASE/.test(vite));
});
