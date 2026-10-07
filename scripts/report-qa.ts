// STEP 09-8 Report QA 산출물 생성: 실제 Report 를 만들고 QA 를 돌린 뒤 RenderModel / HTML / JSON 번들을 파일로 쓴다.
// PDF 검증은 이어서:  backend/.venv/bin/python backend/scripts/verify_report_pdf.py <outDir>
//   node scripts/report-qa.ts [outDir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildReportInput, generateReport, renderReportHtml, runReportQa, keyTexts } from '../src/report/index.ts';
import { buildScenario } from '../src/ai/eval/scenarios.ts';

const root = new URL('..', import.meta.url).pathname;
const out = process.argv[2] ?? '/tmp/valuflow-report-qa';
const golden = JSON.parse(readFileSync(`${root}backend/tests/golden/samsung.json`, 'utf8')).expected;
const project = buildScenario('full', golden).project;
project.historicalData!.company = { ...project.historicalData!.company, name: '삼성전자', stockCode: '005930' } as never;   // golden 의 회사명은 'test' — 한글 PDF 검증용으로 실제 이름을 쓴다

const t = performance.now();
const input = buildReportInput(project, { now: () => new Date() });
const r = generateReport(input);
if (r.status !== 'ok') { console.error('blocked', r.validation.errors); process.exit(1); }
const qa = runReportQa(r, input);
const counts = Object.entries(qa.counts).map(([k, v]) => `${k} ${v.checked - v.failed}/${v.checked}`).join(' · ');
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/render_model.json`, JSON.stringify(r.renderModel));
writeFileSync(`${out}/key_texts.json`, JSON.stringify(keyTexts(r.renderModel)));
writeFileSync(`${out}/report.html`, renderReportHtml(r.renderModel, { mode: 'document' }));
writeFileSync(`${out}/report.json`, JSON.stringify(r.bundle));
console.log(`QA: ${counts}`);
console.log(`failures: ${qa.failures.length}`);
for (const f of qa.failures) console.log(`  ${f.category}/${f.check}: ${f.detail}`);
console.log(`blocks ${r.renderModel.blocks.length} · charts ${r.renderModel.blocks.filter((b) => b.type === 'chart').length} · html ${(renderReportHtml(r.renderModel, { mode: 'document' }).length / 1024).toFixed(0)}KB · filename ${r.renderModel.meta.filename}`);
console.log(`timings(ms) ${JSON.stringify(Object.fromEntries(Object.entries(r.timings).map(([k, v]) => [k, +v.toFixed(1)])))} · wall ${(performance.now() - t).toFixed(0)}ms`);
process.exit(qa.failures.length ? 1 : 0);
