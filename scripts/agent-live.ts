// Agent Workflow live smoke (개발용): backend(FastAPI, 실제 LLM · provider)를 띄워 둔 상태에서 실행한다.
//   node scripts/agent-live.ts [baseUrl]
// 삼성전자 golden Historical + 학습용 가정으로 대표 workflow 3종(WACC · Full · Risk)을 실행하고 계획 · 실행 순서 · 상태를 출력한다. 실제 LLM 호출이라 결과는 매번 조금 다를 수 있다.
import { readFileSync } from 'node:fs';
import { BackendAiClient, runWorkflow } from '../src/ai/index.ts';
import { emptyProjectState, withHistoricalLoaded, withPracticeAssumptions, withRelativeInputs, withSelectedCompany } from '../src/store/projectModel.ts';

const root = new URL('..', import.meta.url).pathname;
const g = JSON.parse(readFileSync(`${root}backend/tests/golden/samsung.json`, 'utf8')).expected;
const base = withSelectedCompany(emptyProjectState, { corpCode: '00126380', corpName: '삼성전자', corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: 'live' });
const project = withRelativeInputs(withPracticeAssumptions(withHistoricalLoaded(base, { data: g.data, quality: g.quality, provenance: { source: 'database', persisted: true, fetchedAt: 'live', fetchId: '1', corpCode: '00126380', fiscalYears: [2023, 2024, 2025] } })), { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 });
const client = new BackendAiClient({ baseUrl: process.argv[2] ?? 'http://127.0.0.1:8000' });

const questions = process.argv.slice(3).length ? process.argv.slice(3) : ['삼성전자 최근 영업이익률을 분석해줘.', '현재 삼성전자 WACC 가정을 검토해줘.', '삼성전자가 설비투자 확대 이유를 뭐라고 설명했어?', '최근 실적과 시장 상황을 같이 고려해서 valuation risk를 정리해줘.'];
for (const q of questions) {
  const t = Date.now();
  const out = await runWorkflow({ question: q, project, client });
  if (!out) { console.log('Q:', q, '→ workflow 아님'); continue; }
  const a = out.answer;
  console.log(`\nQ: ${q}\n  workflow=${out.plan.workflowType} status=${out.state.status} ${((Date.now() - t) / 1000).toFixed(0)}s error=${out.error?.code ?? '-'}`);
  console.log('  planned :', out.plan.steps.map((s) => s.tool).join(' → '));
  console.log('  executed:', out.state.toolsExecuted.map((x) => `${x.tool}(${x.status})`).join(' → '));
  console.log('  steps   :', out.state.steps.map((s) => `${s.id}:${s.status}${s.dynamic ? '*' : ''}`).join(' '));
  if (a) {
    console.log('  summary :', a.summary.slice(0, 260));
    console.log('  reviewed:', a.reviewedAreas.slice(0, 5).join(' | '));
    console.log('  limits  :', a.limitations.slice(0, 4).join(' | ') || '-');
    console.log('  judgment:', a.judgmentItems.slice(0, 3).join(' | ') || '-');
    for (const c of a.claims) console.log(`  claim ${c.claimId} [${c.type}/${c.basis}] ${c.status} conf=${c.confidence ?? '-'} ← ${c.evidenceIds.slice(0, 3).join(' | ') || '-'}${c.issues.length ? ` issues=${c.issues.join(',')}` : ''}\n        ${c.text.slice(0, 110)}`);
    const gr = a.grounding;
    if (gr) console.log(`  grounding: claims=${gr.stats.claims} supported=${gr.stats.supported} partial=${gr.stats.partial} unsupported=${gr.stats.unsupported} coverage=${gr.coverage === null ? '-' : gr.coverage.toFixed(2)} numbers=${gr.stats.numbersChecked}/ungrounded ${gr.stats.numbersUngrounded} evidence=${gr.evidenceCount} contradictions=${gr.contradictions.length} timeBasis=${JSON.stringify(gr.timeBasis)}`);
    console.log('  sources :', [...new Set(a.sources.map((s) => `${s.type}`))].join(', '));
  }
  console.log('  checkpoints:', out.state.checkpoints.map((c) => `${c.kind} ${c.currentValue}→${c.proposedValue} [${c.status}]`).join(' ; ') || '-');
  console.log('  violations:', out.violations.map((v) => v.code).join(',') || '-', '| corrections:', out.corrections.join(',') || '-');
  console.log('  audit:', JSON.stringify({ steps: out.audit.stepsExecuted.length, tools: out.audit.toolsExecuted.length, ms: out.audit.durationMs, grounding: out.audit.grounding && { regenerated: out.audit.grounding.regenerated, fallback: out.audit.grounding.fallbackUsed, unsupportedNumbers: out.audit.grounding.unsupportedNumbers, hallucinatedSources: out.audit.grounding.hallucinatedSources } }));
}
