// External Provider Credential Policy: frontend 에는 어떤 API Key 도 없다 (모든 credential 은 backend 환경변수에만 있다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const NAMES = ['DART_API_KEY', 'OPENAI_API_KEY', 'MARKET_DATA_API_KEY', 'NEWS_API_KEY', 'RERANKER_API_KEY', 'COHERE_API_KEY', 'AI_STATE_SECRET', 'DATABASE_URL', 'crtfc_key'];
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

test('frontend 소스에는 credential 이름 · VITE_ KEY 변수 · Key 형태 문자열이 없다', () => {
  const files = walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'));
  assert.ok(files.length > 20);
  for (const f of files) {
    const code = readFileSync(f, 'utf8');
    for (const n of NAMES) assert.ok(!code.includes(n), `${f}: ${n}`);
    assert.ok(!/VITE_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/.test(code), `${f}: VITE_ credential 변수`);
    assert.ok(!/sk-[A-Za-z0-9]{16,}/.test(code), `${f}: Key 형태 문자열`);
  }
});

test('vite 설정 · env 파일 · 빌드 결과(dist)에 credential 이 들어가지 않는다', () => {
  for (const f of ['vite.config.ts', 'vite.config.js']) if (existsSync(join(root, f))) {
    const cfg = readFileSync(join(root, f), 'utf8');
    assert.ok(!/define\s*:/.test(cfg) || !NAMES.some((n) => cfg.includes(n)), f);
    for (const n of NAMES) assert.ok(!cfg.includes(n), `${f}: ${n}`);
  }
  for (const f of readdirSync(root).filter((n) => /^\.env/.test(n))) assert.ok(!/^\s*VITE_[A-Z_]*(KEY|SECRET|TOKEN)/m.test(readFileSync(join(root, f), 'utf8')), `${f}: VITE_ credential`);
  if (existsSync(join(root, 'dist'))) {
    for (const f of walk(join(root, 'dist')).filter((p) => /\.(js|html|css|map)$/.test(p))) {
      const code = readFileSync(f, 'utf8');
      for (const n of NAMES) assert.ok(!code.includes(n), `${f}: ${n}`);
      assert.ok(!/sk-[A-Za-z0-9]{16,}/.test(code), `${f}: Key 형태 문자열`);
    }
  }
});
