// Report Preview(HTML) 레이아웃: KPI 는 3열이라 WACC · Terminal Growth 가 두 번째 줄로 내려가고, 좁은 카드에서도 값이 옆으로 삐져나오지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReportInput, generateReport, renderReportHtml, type GenerateOk } from './index.ts';
import { buildScenario } from '../ai/eval/scenarios.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const ok = () => generateReport(buildReportInput(structuredClone(buildScenario('full', golden).project), { now: () => new Date('2026-10-08T01:02:03Z') })) as GenerateOk;

test('KPI: 3열 그리드(minmax(0,1fr)) · 카드는 min-width:0 + overflow-wrap — 5개 KPI 는 3 + 2 로 배치된다', () => {
  const html = renderReportHtml(ok().renderModel, { mode: 'document' });
  assert.match(html, /\.valuflow-report \.kpis\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(html, /\.valuflow-report \.kpi\{[^}]*min-width:0;overflow-wrap:anywhere\}/);
  assert.doesNotMatch(html, /repeat\(5,1fr\)/);
  const start = html.indexOf('<div class="kpis">');
  const cards = html.slice(start, html.indexOf('<h', start + 1) > 0 ? html.indexOf('<h', start + 1) : undefined);   // 다음 제목 전까지가 KPI 블록
  const labels = [...cards.matchAll(/<div class="kpi-label">([^<]+)/g)].map((m) => m[1]!.trim());
  assert.deepEqual(labels, ['Enterprise Value', 'Equity Value', 'Value per Share', 'WACC', 'Terminal Growth'], '앞 3개가 윗줄, WACC · Terminal Growth 가 아랫줄');
});

test('KPI 주석 표시([S#])는 값 옆 위첨자가 아니라 값 아래 줄에 놓인다 (표 · 문단의 마커는 그대로)', () => {
  const html = renderReportHtml(ok().renderModel, { mode: 'document' });
  assert.match(html, /\.valuflow-report \.kpi sup\.fn\{display:block;[^}]*vertical-align:baseline/);
  assert.match(html, /\.valuflow-report sup\.fn\{font-size:9px;margin-left:1px\}/, '일반 위첨자 마커 스타일은 그대로');
  const start = html.indexOf('<div class="kpis">');
  const kpi = html.slice(start, html.indexOf('<h', start + 1));
  const cards = kpi.split('<div class="kpi">').slice(1);
  assert.equal(cards.length, 5);
  for (const c of cards) assert.match(c, /<div class="kpi-value">[^<]*<sup class="fn">\[<a href="#src-S\d+"/, '각 KPI 값에 [S#] 마커가 있다 (CSS 로 아래 줄에 표시)');
});
