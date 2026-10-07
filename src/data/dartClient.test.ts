// STEP 06-2 프론트 테스트: backend 호출 client / DartFinancialRepository. 실제 네트워크는 쓰지 않는다 (fetch mock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BackendDartClient, DartClientError } from './dart/client.ts';
import { DartFinancialRepository } from './repository/dartRepository.ts';
import type { DartCompanyDetail } from './dart/types.ts';

type Call = { url: string; method?: string };
function mockFetch(handler: (url: string) => { status?: number; body?: unknown } | 'network-error') {
  const calls: Call[] = [];
  const fn = async (input: string, init?: { method?: string }) => {
    calls.push({ url: input, method: init?.method });
    const r = handler(input);
    if (r === 'network-error') throw new TypeError('Failed to fetch');
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } };
  };
  return { fn, calls };
}

const SUMMARY = { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', modifyDate: '20240101' };
const DETAIL: DartCompanyDetail = {
  corpCode: '00126380', corpName: '삼성전자(주)', corpNameEng: 'SAMSUNG ELECTRONICS', stockCode: '005930', ceoName: null, corpClass: 'Y', address: null, homepage: null,
  industryCode: '264', establishmentDate: '1969-01-13', fiscalMonth: 12, source: 'OpenDART', fetchedAt: '2026-01-01T00:00:00+00:00',
};

test('searchCompanies 는 backend /api/companies 만 호출한다 (OpenDART URL · Key 를 모른다)', async () => {
  const m = mockFetch(() => ({ body: { items: [SUMMARY, { ...SUMMARY, corpCode: '00100001', corpName: '삼성전자서비스', stockCode: null }] } }));
  const c = new BackendDartClient({ fetch: m.fn });
  const r = await c.searchCompanies({ query: ' 삼성전자 ', limit: 5 });
  assert.equal(r.length, 2);
  assert.equal(r[1].stockCode, null); // 비상장사 유지
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].url, `/api/companies?q=${encodeURIComponent('삼성전자')}&limit=5`);
  assert.deepEqual(await c.searchCompanies({ query: '   ' }), []); // 빈 검색어는 호출하지 않는다
  assert.equal(m.calls.length, 1);
});

test('getCompany 는 /api/companies/{corpCode} 를 호출한다', async () => {
  const m = mockFetch(() => ({ body: DETAIL }));
  const d = await new BackendDartClient({ fetch: m.fn }).getCompany('00126380');
  assert.equal(m.calls[0].url, '/api/companies/00126380');
  assert.equal(d.source, 'OpenDART');
});

test('backend 오류 코드를 DartClientError 로 변환하고, 연결 실패 / 비정상 응답도 정제된 오류가 된다', async () => {
  const err = (status: number, code: string) => mockFetch(() => ({ status, body: { error: { code, message: '정제된 문구' } } }));
  for (const [status, code] of [[404, 'no-data'], [429, 'rate-limit'], [503, 'dart-unavailable'], [502, 'invalid-key'], [400, 'invalid-request']] as const) {
    const m = err(status, code);
    await assert.rejects(new BackendDartClient({ fetch: m.fn }).getCompany('00126380'), (e: unknown) => e instanceof DartClientError && e.code === code && e.status === status && e.message === '정제된 문구');
  }
  await assert.rejects(new BackendDartClient({ fetch: mockFetch(() => 'network-error').fn }).searchCompanies({ query: 'a' }), (e: unknown) => e instanceof DartClientError && e.code === 'backend-unreachable' && !/Failed to fetch/.test(e.message));
  await assert.rejects(new BackendDartClient({ fetch: mockFetch(() => ({ status: 500 })).fn }).getCompany('00126380'), (e: unknown) => e instanceof DartClientError && e.code === 'backend-unreachable' && e.status === 500);
  await assert.rejects(new BackendDartClient({ fetch: mockFetch(() => ({ status: 404 })).fn }).getCompany('00126380'), (e: unknown) => e instanceof DartClientError && e.code === 'unknown');
  await assert.rejects(new BackendDartClient({ fetch: mockFetch(() => ({ status: 400, body: { error: { code: 'weird' } } })).fn }).getCompany('1'), (e: unknown) => e instanceof DartClientError && e.code === 'unknown');
});

test('Repository: 검색 결과 변환(비상장 포함) / 개황 조회 / corpCode 없으면 조회하지 않는다', async () => {
  const m = mockFetch((url) => (url.startsWith('/api/companies?') ? { body: { items: [SUMMARY, { ...SUMMARY, corpCode: '00100001', corpName: '비상장사', stockCode: null }] } } : { body: DETAIL }));
  const repo = new DartFinancialRepository(new BackendDartClient({ fetch: m.fn }));
  const found = await repo.searchCompanies('삼성');
  assert.deepEqual(found.map((c) => [c.name, c.stockCode, c.source]), [['삼성전자', '005930', 'OpenDART'], ['비상장사', undefined, 'OpenDART']]);
  const company = await repo.getCompany({ corpCode: '00126380' });
  assert.deepEqual([company?.name, company?.nameEng, company?.corpClass, company?.fetchedAt], ['삼성전자(주)', 'SAMSUNG ELECTRONICS', 'Y', '2026-01-01T00:00:00+00:00']);
  const before = m.calls.length;
  assert.equal(await repo.getCompany({ stockCode: '005930' }), null);
  assert.equal(m.calls.length, before);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('프론트 소스는 OpenDART URL / API Key / OpenDART 재무 endpoint 를 모르고, unconnected client 잔재가 없다', () => {
  const root = new URL('..', import.meta.url).pathname;
  const files = walk(root).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'));
  const all = files.map((f) => [f, readFileSync(f, 'utf8')] as const);
  for (const [f, text] of all) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/opendart\.fss\.or\.kr/i.test(code), `${f}: OpenDART URL`);
    assert.ok(!/crtfc_key|DART_API_KEY|VITE_DART/i.test(code), `${f}: API Key`);
    assert.ok(!/fnltt/i.test(code), `${f}: 재무 endpoint`);
    assert.ok(!/unconnectedDartClient/.test(code), `${f}: unconnected client 잔재`);
  }
  // API Key 가 번들 설정으로 새지 않는다
  const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
  assert.ok(!/\bdefine\s*:|VITE_DART|DART_API_KEY/.test(vite));
});
