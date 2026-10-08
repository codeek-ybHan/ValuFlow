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
