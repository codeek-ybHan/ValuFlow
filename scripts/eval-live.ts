// STEP 08-8 라이브 평가: 고정 질문 세트를 실제 LLM · 실제 backend 로 실행하고 Tool selection · workflow · grounding · 지연 · 호출 수를 기록한다.
//   backend 를 띄운 뒤:  node scripts/eval-live.ts <baseUrl> <out.json> [repeat=1]
//   환경변수: ONLY=H1,V3 (일부 질문만) · CONC=3 (동시 실행 수) · DOCS=1 (합성 PDF 질문 P1,P2,I1,I2 포함; 없으면 제외)
// 결과는 비결정적이다: 반복 실행 결과를 함께 보고, 절대적인 성능 보장으로 읽지 않는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { AiClientError, BackendAiClient, buildAiContext, runAiQuery, runWorkflow, type AiGatewayClient, type AiQueryRequest, type AiRegenerateRequest, type AiToolResultRequest, type GatewayResponse } from '../src/ai/index.ts';
import { resolveMode } from '../src/ai/analyst/ask.ts';
import { buildQuickTurn, buildWorkflowTurn } from '../src/ai/analyst/view.ts';
import { DATASET, type EvalCase } from '../src/ai/eval/dataset.ts';
import { answerText, checkQuickAnswer, checkWorkflowAnswer, leaksSystemPrompt, type FinalCheck } from '../src/ai/eval/finalCheck.ts';
import { toolSelection, workflowReliability } from '../src/ai/eval/metrics.ts';
import { buildScenario } from '../src/ai/eval/scenarios.ts';

const root = new URL('..', import.meta.url).pathname;
const golden = JSON.parse(readFileSync(`${root}backend/tests/golden/samsung.json`, 'utf8')).expected;
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8000';
const outPath = process.argv[3] ?? '/tmp/eval-live.json';
const repeat = Number(process.argv[4] ?? 1);
const only = (process.env.ONLY ?? '').split(',').filter(Boolean);
const conc = Number(process.env.CONC ?? 3);
const withDocs = process.env.DOCS === '1';

/** LLM 호출 수 · 호출별 지연을 센다 (query / tool-result / regenerate 가 각각 모델 호출 1회). */
class Counting implements AiGatewayClient {
  calls: { kind: string; ms: number }[] = [];
  private readonly inner: AiGatewayClient;
  constructor(inner: AiGatewayClient) { this.inner = inner; }
  private async t<T>(kind: string, f: () => Promise<T>): Promise<T> { const s = Date.now(); try { return await f(); } finally { this.calls.push({ kind, ms: Date.now() - s }); } }
  query(r: AiQueryRequest): Promise<GatewayResponse> { return this.t('query', () => this.inner.query(r)); }
  sendToolResult(r: AiToolResultRequest): Promise<GatewayResponse> { return this.t('tool-result', () => this.inner.sendToolResult(r)); }
  regenerate = async (r: AiRegenerateRequest) => this.t('regenerate', () => this.inner.regenerate!(r));
}

const SEARCH_TOOLS = new Set(['searchDisclosures', 'searchUploadedDocuments', 'searchKnowledge']);
const EXTERNAL_TOOLS = new Set(['getMarketData', 'getMarketAssumptions', 'getComparableCompanies', 'searchCompanyNews']);

async function runOne(c: EvalCase, run: number) {
  const { project, historicalStatus } = buildScenario(c.scenario, golden);
  const ctx = buildAiContext(project, { historicalStatus });
  const mode = resolveMode(c.question, ctx, 'auto');
  const gateway: AiGatewayClient = c.noLlm ? { query: () => { throw new Error('LLM must not be called'); }, sendToolResult: () => { throw new Error('unused'); } } : new BackendAiClient({ baseUrl });
  const client = new Counting(gateway);
  const t0 = Date.now();
  const base = { id: c.id, category: c.category, run, question: c.question, expectedMode: c.expectedMode, mode };
  const company = ctx.company ? { name: ctx.company.name, stockCode: ctx.company.stockCode, corpCode: ctx.company.corpCode } : null;
  const bctx = { id: 't', now: new Date().toISOString(), snapshotId: 's', company, wacc: null, showWacc: false };
  let record: Record<string, unknown>;
  try {
    if (mode === 'workflow') {
      const out = await runWorkflow({ question: c.question, project, client, historicalStatus });
      if (!out) throw new Error('no plan');
      const turn = buildWorkflowTurn(out, bctx, c.question);
      const a = out.answer;
      const fin: FinalCheck | null = a ? checkWorkflowAnswer(a, out.results) : null;
      const g = out.audit.grounding;
      const text = a ? answerText(a) : '';
      record = {
        ...base, workflow: out.plan.workflowType, expectedWorkflow: c.workflow, groundingLevel: out.groundingLevel, status: turn.status, stateStatus: out.state.status, uiGrounding: turn.grounding, error: out.error?.code ?? null,
        tools: out.state.toolsExecuted, steps: out.state.steps.map((s) => ({ tool: s.tool, optional: s.optional, status: s.status, reason: s.reason ?? null })), final: fin, text, claims: a?.claims.map((x) => ({ id: x.claimId, type: x.type, status: x.status, confidence: x.confidence, text: x.text })),
        firstPass: g ? { coverage: g.firstPass.coverage, claims: g.firstPass.claims, blocking: g.firstPass.blocking, unitSlips: g.firstPass.unitSlips, ungrounded: g.firstPass.unsupportedNumbers } : null, regenerated: g?.regenerated ?? false, fallback: g?.fallbackUsed ?? false,
        afterRegeneration: g?.afterRegeneration ? { coverage: g.afterRegeneration.coverage, blocking: g.afterRegeneration.blocking } : null, hallucinatedFirstPass: g?.hallucinatedSources ?? 0, violations: out.violations.map((v) => v.code),
        proposals: a?.proposedActions.map((p) => `${p.type}:${p.proposedValue}`) ?? [], checkpoints: out.state.checkpoints.length, sources: turn.sources.map((s) => ({ badge: s.badge, title: s.title, page: s.page, reliability: s.reliability?.label ?? null })),
        _results: out.results, leak: leaksSystemPrompt(text), evidenceSources: (a?.evidenceMap ?? []).filter((e) => e.sourceType === 'uploaded-document').map((e) => ({ title: e.sourceLabel, page: e.page ?? null })),
      };
    } else {
      const out = await runAiQuery({ question: c.question, project, client, historicalStatus });
      const turn = buildQuickTurn(out, bctx, c.question);
      const a = out.answer;
      const text = a ? answerText(a as never) : '';
      record = {
        ...base, groundingLevel: out.groundingLevel, status: turn.status, stateStatus: out.status, uiGrounding: turn.grounding, error: out.error?.code ?? null, tools: out.audit.toolsExecuted, final: a ? checkQuickAnswer(a, out.results) : null, text,
        regenerated: false, fallback: false, violations: out.violations.map((v) => v.code), sources: turn.sources.map((s) => ({ badge: s.badge, title: s.title, page: s.page, reliability: s.reliability?.label ?? null })), _results: out.results, leak: leaksSystemPrompt(text),
        evidenceSources: (a?.sources ?? []).filter((s) => s.type === 'uploaded-document').map((s) => ({ title: s.title, page: s.page ?? null })),
      };
    }
  } catch (e) {
    record = { ...base, status: 'failed', error: e instanceof AiClientError ? e.code : `exception:${(e as Error).message}`, tools: [], final: null, text: '', violations: [], sources: [], evidenceSources: [] };
  }
  const ms = Date.now() - t0;
  const tools = (record.tools as { tool: string; status: string }[]) ?? [];
  const sel = toolSelection(c, tools);
  const text = String(record.text ?? '');
  const sourceHit = c.expectSource ? (record.evidenceSources as { title: string | null; page: number | null }[]).some((s) => c.expectSource!.title.test(s.title ?? '') && (!c.expectSource!.page || s.page != null)) : null;
  const proposals = (record.proposals as string[] | undefined) ?? [];
  const injected = c.injection ? c.injection.forbid.test(text) || proposals.some((p) => c.injection!.forbid.test(p)) : null;
  const exposed = c.injection ? JSON.stringify((record as { _results?: unknown })._results ?? '').includes('999,999') : null;
  delete (record as { _results?: unknown })._results;
  const wf = record.steps ? workflowReliability(record.steps as { tool: string; optional: boolean; status: string; reason: string | null }[]) : null;
  const done = {
    ...record, sec: Math.round(ms / 100) / 10, ms, llmCalls: client.calls.length, llmMs: client.calls.map((x) => x.ms), regenCalls: client.calls.filter((x) => x.kind === 'regenerate').length,
    toolSel: sel, wf, injectionExposed: exposed, acknowledged: c.mustAcknowledge ? c.mustAcknowledge.test(text) : null, sourceHit, injected, modeOk: mode === c.expectedMode, noLlmOk: c.noLlm ? client.calls.length === 0 : null,
    searchCalls: sel.executed.filter((t) => SEARCH_TOOLS.has(t)).length, externalCalls: sel.executed.filter((t) => EXTERNAL_TOOLS.has(t)).length,
  };
  console.log(`${c.id}#${run} ${mode} ${done.status} ${done.sec}s llm=${done.llmCalls} tools=${sel.executed.join('>')} hit=${sel.hit}${sel.missing.length ? ` missing=${sel.missing}` : ''}${sel.unnecessary.length ? ` extra=${sel.unnecessary}` : ''}${injected ? ' INJECTED' : ''}${record.leak ? ' LEAK' : ''}`);
  return done;
}

const cases = DATASET.filter((c) => (only.length === 0 || only.includes(c.id)) && (c.needsDocs ? withDocs : true));
const jobs: { c: EvalCase; run: number }[] = [];
for (let r = 1; r <= repeat; r++) for (const c of cases) jobs.push({ c, run: r });
const results: Record<string, unknown>[] = [];
let next = 0;
await Promise.all(Array.from({ length: conc }, async () => { while (next < jobs.length) { const j = jobs[next++]!; results.push(await runOne(j.c, j.run)); } }));
results.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }) || Number(a.run) - Number(b.run));
writeFileSync(outPath, JSON.stringify({ baseUrl, at: new Date().toISOString(), repeat, results }, null, 1));
console.log(`\nwrote ${results.length} records → ${outPath}`);
