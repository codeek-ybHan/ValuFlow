// 재무제표 기준(연결 / 개별) 선택: 선택값이 요청까지 전달되고, 출처에 기록되어 새로고침 때 같은 기준으로 다시 조회된다. (backend 는 mock)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { BackendDartClient } from '../data/dart/client.ts';
import { DatabaseFinancialRepository } from '../data/repository/databaseRepository.ts';
import type { DartHistoricalResponse } from '../data/dart/types.ts';
import { loadHistorical } from './historicalLoad.ts';
import { emptyProjectState, restoreProjectState, toPersisted, withHistoricalLoaded, withSelectedCompany } from './projectModel.ts';
import { TEST_COMPANY } from './testCompany.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const FETCH = { basisRequested: 'Consolidated', basisUsed: 'Consolidated', basisFallback: false, yearsRequested: [2023, 2024, 2025], yearsReceived: [2023, 2024, 2025], missingYears: [], rawAccountCount: 10, warnings: [] };
const ok = (): DartHistoricalResponse => ({ status: 'ok', corpCode: '00126380', source: 'database', persisted: true, fetchId: 7, fetchedAt: '2026-01-01T00:00:00+00:00', data: golden.data, quality: golden.quality, fetch: FETCH as DartHistoricalResponse['fetch'] });
function repo() {
  const calls: string[] = [];
  const fn = async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => ok() }; };
  return { r: new DatabaseFinancialRepository(new BackendDartClient({ fetch: fn }), () => new Date('2026-10-07')), calls };
}

type Harness = { renderBasis(v: string, loaded: string | null, disabled?: boolean): string };
let h: Harness;
before(() => {
  const out = join(mkdtempSync(join(tmpdir(), 'valuflow-basis-')), 'h.cjs');
  buildSync({ entryPoints: [new URL('../pages/basisHarness.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', logLevel: 'silent', define: { 'import.meta.env': '{}' } });
  h = createRequire(import.meta.url)(out) as Harness;
});

test('선택한 기준이 backend 요청의 basis 로 전달된다 (auto · consolidated · separate), 선택이 없으면 auto', async () => {
  for (const [choice, expected] of [['auto', 'auto'], ['consolidated', 'consolidated'], ['separate', 'separate'], [undefined, 'auto']] as const) {
    const { r, calls } = repo();
    const out = await loadHistorical(r, TEST_COMPANY, { fiscalYears: [2023, 2024, 2025], ...(choice ? { basis: choice } : {}) });
    assert.ok(out.ok);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, new RegExp(`basis=${expected}$`), String(choice));
    assert.equal(out.ok && out.provenance.basisChoice, choice, '선택은 출처에 기록된다');
  }
});

test('기준 선택은 출처에 저장되고 복원된다 (새로고침 때 같은 기준으로 다시 조회) · 잘못된 값은 버린다', async () => {
  const { r } = repo();
  const out = await loadHistorical(r, TEST_COMPANY, { fiscalYears: [2023, 2024, 2025], basis: 'separate' });
  assert.ok(out.ok);
  const loaded = withHistoricalLoaded(withSelectedCompany(emptyProjectState, TEST_COMPANY), { data: out.data, quality: out.quality, provenance: out.provenance });
  const persisted = JSON.parse(JSON.stringify(toPersisted(loaded)));
  assert.equal(persisted.historicalProvenance.basisChoice, 'separate');
  assert.equal(restoreProjectState(persisted).historicalProvenance?.basisChoice, 'separate');
  assert.equal(restoreProjectState({ ...persisted, historicalProvenance: { ...persisted.historicalProvenance, basisChoice: 'weird' } }).historicalProvenance?.basisChoice, undefined);
  // 다른 기업으로 바꾸면 이전 기업의 기준 선택이 남지 않는다
  assert.equal(withSelectedCompany(loaded, { ...TEST_COMPANY, corpCode: '00164779', corpName: 'SK하이닉스' }).historicalProvenance, null);
});

test('화면: 연결 · 개별 · 자동 선택, 선택한 값 표시, 불러온 기준과 다르면 안내, 불러오는 중에는 비활성', () => {
  const html = h.renderBasis('auto', null);
  assert.match(html, /재무제표 기준/);
  for (const label of ['자동 \\(연결 우선\\)', '연결', '개별']) assert.match(html, new RegExp(`>${label}<`), label);
  assert.match(html, /aria-checked="true"[^>]*>자동/);
  assert.match(html, /role="radiogroup"/);
  assert.doesNotMatch(html, /다시 누르면/);
  // 개별을 골랐는데 불러온 데이터는 연결 → 다시 불러오라는 안내
  const differs = h.renderBasis('separate', 'Consolidated');
  assert.match(differs, /지금 불러온 데이터는 연결 기준입니다/);
  assert.match(differs, /개별 기준으로 바뀝니다/);
  // 같은 기준이면 안내 없음, 자동은 항상 안내 없음
  assert.doesNotMatch(h.renderBasis('consolidated', 'Consolidated'), /다시 누르면/);
  assert.doesNotMatch(h.renderBasis('auto', 'Separate'), /다시 누르면/);
  // 연결만 고르면 연결이 없는 기업에 대한 안내
  assert.match(h.renderBasis('consolidated', null), /연결 재무제표가 없는 기업은 불러오지 못합니다/);
  assert.match(h.renderBasis('auto', null, true), /disabled=""/);
});

test('provider 와 화면 코드: 선택을 불러오기 · 새로고침 재조회에 쓰고, 기업이 바뀌면 처음(auto)으로 돌아간다', () => {
  const provider = readFileSync(new URL('./project.tsx', import.meta.url), 'utf8');
  assert.match(provider, /basis: basisRef\.current/);
  assert.match(provider, /basis: p\.historicalProvenance\.basisChoice/);
  assert.match(provider, /setBasisChoiceState\('auto'\)/);
  const hs = readFileSync(new URL('../components/HistoricalSource.tsx', import.meta.url), 'utf8');
  assert.match(hs, /<BasisChoiceControl value=\{basisChoice\} onChange=\{setBasisChoice\}/);
});
