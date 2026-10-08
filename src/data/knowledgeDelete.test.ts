// 업로드한 PDF 삭제: 업로드 응답의 삭제 토큰을 이 브라우저가 보관하고, 삭제 요청에 헤더로 보낸다. 토큰이 없으면 삭제 버튼도 요청도 없다. (backend 는 mock)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KnowledgeClient, KnowledgeError, type DeleteTokenStore } from './repository/knowledgeRepository.ts';

function memoryTokens(initial: Record<number, string> = {}): DeleteTokenStore & { all: Record<number, string> } {
  const all = { ...initial };
  return { all, get: (id) => all[id] ?? null, set: (id, t) => { all[id] = t; }, remove: (id) => { delete all[id]; } };
}
type Call = { url: string; method?: string; headers?: Record<string, string> };
function client(handler: (c: Call) => { status?: number; body: unknown }, tokens = memoryTokens()) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: { method?: string; headers?: Record<string, string> }) => { const c = { url, method: init?.method, headers: init?.headers }; calls.push(c); const r = handler(c); const status = r.status ?? 200; return { ok: status < 400, status, json: async () => r.body }; };
  return { c: new KnowledgeClient({ fetch, tokens }), calls, tokens };
}
const DOC = { documentId: 7, sourceType: 'user-upload', title: 'Outlook', status: 'ready', chunkCount: 5 };
const file = () => ({ name: 'a.pdf' }) as unknown as File;
const origFormData = globalThis.FormData;

test('업로드 응답의 삭제 토큰을 이 브라우저(문서 id 별)에 보관한다 · 이미 있는 문서(already-exists)에는 토큰이 없다', async () => {
  (globalThis as { FormData?: unknown }).FormData = class { append() { /* 테스트용 */ } };
  try {
    const up = client(() => ({ status: 201, body: { status: 'ingested', document: DOC, deleteToken: 'tok-abc' } }));
    const doc = await up.c.upload(file());
    assert.equal(doc.documentId, 7);
    assert.deepEqual(up.tokens.all, { 7: 'tok-abc' });
    assert.equal(up.c.canDelete(7), true);
    assert.equal(up.c.canDelete(8), false, '다른 문서는 지울 수 없다');
    const dup = client(() => ({ body: { status: 'already-exists', document: { ...DOC, documentId: 9 } } }));
    await dup.c.upload(file());
    assert.deepEqual(dup.tokens.all, {}, '같은 파일을 다시 올려도 삭제 권한이 생기지 않는다');
    assert.equal(dup.c.canDelete(9), false);
  } finally { (globalThis as { FormData?: unknown }).FormData = origFormData; }
});

test('삭제 요청은 토큰을 헤더로 보내고, 성공하면 토큰을 버린다 (버튼이 사라진다)', async () => {
  const k = client(() => ({ body: { deleted: 7 } }), memoryTokens({ 7: 'tok-abc' }));
  await k.c.remove(7);
  assert.equal(k.calls[0]!.method, 'DELETE');
  assert.match(k.calls[0]!.url, /\/api\/knowledge\/documents\/7$/);
  assert.equal(k.calls[0]!.headers?.['X-ValuFlow-Delete-Token'], 'tok-abc');
  assert.equal(k.c.canDelete(7), false);
});

test('권한 없음(403)이거나 이미 지워진 문서(404)면 토큰을 버리고 사용자용 문구를 낸다 · 연결 실패는 토큰을 유지한다', async () => {
  const forbidden = client(() => ({ status: 403, body: { error: { code: 'delete-forbidden' } } }), memoryTokens({ 7: 'stale' }));
  await assert.rejects(forbidden.c.remove(7), (e: unknown) => e instanceof KnowledgeError && e.code === 'delete-forbidden' && /이 브라우저에서 업로드한 문서만 삭제할 수 있습니다/.test(e.message));
  assert.equal(forbidden.c.canDelete(7), false);
  const gone = client(() => ({ status: 404, body: { error: { code: 'document-not-found' } } }), memoryTokens({ 7: 't' }));
  await assert.rejects(gone.c.remove(7), KnowledgeError);
  assert.equal(gone.c.canDelete(7), false);
  const down = client(() => ({ status: 502, body: null }), memoryTokens({ 7: 't' }));
  await assert.rejects(down.c.remove(7), KnowledgeError);
  assert.equal(down.c.canDelete(7), true, '일시적 오류면 다시 시도할 수 있다');
  // 토큰이 없으면 헤더 없이 요청한다 (서버가 403 으로 거부 — 버튼은 애초에 보이지 않는다)
  const none = client(() => ({ status: 403, body: { error: { code: 'delete-forbidden' } } }));
  await assert.rejects(none.c.remove(5), KnowledgeError);
  assert.equal(none.calls[0]!.headers, undefined);
});

test('삭제 토큰은 localStorage 한 곳에만 있고 번들 · 로그 · 화면에 노출되지 않는다', () => {
  const repo = readFileSync(new URL('./repository/knowledgeRepository.ts', import.meta.url), 'utf8');
  assert.equal((repo.match(/localStorage/g) ?? []).length, 3, 'token store 의 읽기 · 쓰기 · 키 접근만');
  const panel = readFileSync(new URL('../components/analyst/KnowledgePanel.tsx', import.meta.url), 'utf8');
  assert.ok(!/deleteToken|X-ValuFlow-Delete-Token/.test(panel), '화면 코드는 토큰을 다루지 않는다');
});
