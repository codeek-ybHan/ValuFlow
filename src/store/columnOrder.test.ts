// 재무제표 표의 연도 열: 가장 최근 연도가 왼쪽 (DART 재무제표와 같다). 데이터는 그대로이고 표시 순서만 바뀐다.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { newestFirstOrder } from '../engine/columnOrder.ts';
import { emptyProjectState, toPersisted, withSamsungHistorical } from './projectModel.ts';
import { withTestCompany } from './testCompany.ts';
import { samsungHistoricalData } from '../data/samsungHistorical.ts';

type Harness = { renderGate(path: string, persisted: string | null): string };
let h: Harness;
before(() => {
  const out = join(mkdtempSync(join(tmpdir(), 'valuflow-cols-')), 'h.cjs');
  buildSync({ entryPoints: [new URL('../pages/gateHarness.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', logLevel: 'silent', define: { 'import.meta.env': '{}' } });
  h = createRequire(import.meta.url)(out) as Harness;
});

const persisted = JSON.stringify(toPersisted(withSamsungHistorical(withTestCompany(emptyProjectState))));
const at = (html: string, needle: string, from = 0) => { const i = html.indexOf(needle, from); assert.ok(i >= 0, `${needle} 가 있어야 한다`); return i; };

test('newestFirstOrder: 최근 연도가 먼저 오고, 원래 배열(과거→최근)은 바뀌지 않는다', () => {
  const periods = ['2023A', '2024A', '2025A'];
  assert.deepEqual(newestFirstOrder(periods), [2, 1, 0]);
  assert.deepEqual(periods, ['2023A', '2024A', '2025A']);
  assert.deepEqual(newestFirstOrder([]), []);
  assert.deepEqual(newestFirstOrder(['2025A', '2023A', '2024A']), [0, 2, 1], '입력 순서와 상관없이 연도로 정렬');
  assert.deepEqual(newestFirstOrder(['2026E', '2025A']), [0, 1]);
});

test('Workspace 재무제표 · 분석 표: 2025A 가 가장 왼쪽, 값도 같은 열을 따라간다', () => {
  const rev = samsungHistoricalData.incomeStatement.revenue as number[];
  const f = (n: number) => n.toLocaleString('ko-KR');
  const html = h.renderGate('/workspace', persisted);
  const head = html.slice(at(html, 'KRW million'));
  assert.ok(at(head, '2025A') < at(head, '2024A') && at(head, '2024A') < at(head, '2023A'), '헤더: 2025A → 2024A → 2023A');
  const row = head.slice(at(head, 'Revenue'));
  assert.ok(at(row, f(rev[2]!)) < at(row, f(rev[1]!)) && at(row, f(rev[1]!)) < at(row, f(rev[0]!)), 'Revenue 값: 최근 연도가 먼저');
});

test('Valuation Historical 단계 표(Key Financials · Metrics): 2025A 가 가장 왼쪽, 값이 열과 맞는다', () => {
  const rev = samsungHistoricalData.incomeStatement.revenue as number[];
  const f = (n: number) => n.toLocaleString('ko-KR');
  const html = h.renderGate('/valuation/historical', persisted);
  const start = at(html, 'Key Financials');
  const t = html.slice(start);
  assert.ok(at(t, '2025A') < at(t, '2024A') && at(t, '2024A') < at(t, '2023A'));
  const row = t.slice(at(t, '<th>Revenue</th>'));
  assert.ok(at(row, f(rev[2]!)) < at(row, f(rev[1]!)) && at(row, f(rev[1]!)) < at(row, f(rev[0]!)));
  // 지표 표(Metrics)도 같은 순서: 영업이익률은 최근 연도 값이 먼저
  const m = html.slice(at(html, 'Historical Metrics'));
  assert.ok(at(m, '2025A') < at(m, '2023A'));
});
