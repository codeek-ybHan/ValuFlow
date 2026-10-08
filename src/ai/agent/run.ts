// Agent Workflow 실행기: Plan → Execute Tool → Observe → Continue / Human checkpoint / Complete → Grounded answer.
// 기존 08-2 Tool loop(backend LLM gateway ↔ frontend executeTool)를 재사용하고, 그 위에 계획 · 상태 · 관찰 · 사람 확인 지점 · 한도 · audit 을 얹는다.
//  - 한 workflow 동안 같은 context snapshot 을 쓴다 (시작 후 Project State 가 바뀌어도 섞이지 않는다).
//  - Agent 는 가정 · Forecast · WACC · Peer 배수 · 시나리오를 바꾸지 않는다. 변경이 필요해 보이면 proposedActions → HumanCheckpoint(waiting-for-user)로만 남긴다.
//  - 한 Tool 이 실패해도 workflow 는 계속되고 최종 답변에 한계(limitations)로 남는다.
import { routeContext, routeRetrieval, toolNamesFor, type RouteDecision } from '../retrievalRoute.ts';
import { buildAiContext, type AiContextOptions, type AiValuationContext } from '../context.ts';
import type { ProjectState } from '../../store/projectModel.ts';
import { CAPABILITIES, type CapabilityId } from '../capabilities.ts';
import { getToolDefinition, TOOL_NAMES, type ToolName } from '../tools/definitions.ts';
import { executeTool } from '../tools/registry.ts';
import type { ToolResult } from '../tools/result.ts';
import { AiClientError, type AiGatewayClient, type AiToolResultRequest, type GatewayResponse, type ToolCallResponse, type ToolTraceEntry } from '../client.ts';
import { enforceGrounding, type AnswerViolation } from '../answer.ts';
import { UNSUPPORTED_DISCLOSURE } from '../policy.ts';
import { buildMinimalContext } from '../minimalContext.ts';
import { classifyQuestion } from '../capabilities.ts';
import { observe } from './observation.ts';
import { groundWithRepair, type RawWorkflowAnswer } from '../grounding/repair.ts';
import type { Proposal } from '../grounding/wacc.ts';
import type { GroundingAuditEvent } from '../grounding/types.ts';
import { planWorkflow } from './planner.ts';
import { leaksSystemPrompt } from '../guard.ts';
import type { HumanCheckpoint, Observation, WorkflowAnswer, WorkflowAuditEvent, WorkflowOutcome, WorkflowPlan, WorkflowState, WorkflowStatus, WorkflowStep } from './types.ts';

/** workflow 단계 수 상한 (계획 + 관찰에 따라 추가된 동적 단계). */
export const MAX_WORKFLOW_STEPS = 14;

export interface RunWorkflowOptions extends AiContextOptions {
  question: string;
  /** 문서 질문의 검색 대상 라우팅 (없으면 질문에서 정한다). */
  route?: RouteDecision;
  project: ProjectState;
  client: AiGatewayClient;
  now?: () => Date;
  newId?: () => string;
  maxToolCalls?: number;
  /** 단계가 바뀔 때마다 호출된다 (UI 의 진행 표시용). 전달되는 state 는 복사본이라 UI 가 바꿔도 workflow 에 영향이 없다. */
  onProgress?: (state: WorkflowState) => void;
  /** 취소 신호: 다음 왕복 전에 확인해 안전하게 멈춘다 (진행 중인 요청 자체는 끊지 못한다). */
  signal?: { readonly aborted: boolean };
}

/** Tool 이 실패했을 때 최종 답변에 남길 한계 문구 (사용자에게 보이는 말). */
const LIMITATION_LABEL: Partial<Record<string, string>> = {
  searchCompanyNews: '뉴스 데이터는 현재 확인하지 못했습니다.',
  searchDisclosures: '공시 검색 결과를 확인하지 못했습니다.',
  searchKnowledge: '문서 검색 결과를 확인하지 못했습니다.',
  searchUploadedDocuments: '업로드 문서 검색 결과를 확인하지 못했습니다.',
  getMarketAssumptions: '시장 가정(무위험수익률 · 베타) 데이터는 현재 확인하지 못했습니다.',
  getMarketData: '시장 데이터(시세 · 시가총액)는 현재 확인하지 못했습니다.',
  getComparableCompanies: '비교기업 데이터는 현재 확인하지 못했습니다.',
  getValuationResult: 'Valuation 결과를 확인하지 못했습니다.',
  getForecastAssumptions: 'Forecast 가정을 확인하지 못했습니다.',
  getSensitivityAnalysis: 'Sensitivity 결과를 확인하지 못했습니다.',
  getScenarioAnalysis: 'Scenario 결과를 확인하지 못했습니다.',
  getRelativeValuation: '상대가치 입력 · 결과를 확인하지 못했습니다.',
  getHistoricalAnalysis: 'Historical 분석을 확인하지 못했습니다.',
  getHistoricalQuality: 'Historical 데이터 품질 정보를 확인하지 못했습니다.',
};
const limitationFor = (tool: string, why: string) => `${LIMITATION_LABEL[tool] ?? `${tool} 결과를 확인하지 못했습니다.`} (${why})`;
const APPLIED_CLAIM = /(변경했|바꿨|수정했|적용했|저장했|반영했|업데이트했)/;

/** context snapshot 식별자: 같은 내용이면 같은 id (FNV-1a). */
export function snapshotId(ctx: AiValuationContext): string {
  const s = JSON.stringify(ctx);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `ctx-${h.toString(16).padStart(8, '0')}`;
}

function runTool(name: string, ctx: AiValuationContext, input: unknown): ToolResult<unknown> {
  try { return executeTool(name, ctx, input); } catch { return { status: 'unavailable', tool: name, reason: 'Tool execution failed.', sources: [], warnings: [] }; }
}

const RETRIEVAL_TOOLS = new Set<string>(['searchDisclosures', 'searchUploadedDocuments', 'searchKnowledge']);
/** 같은 Tool 이거나 같은 retrieval 계열(검색 Tool 끼리)인가. */
export const sameFamily = (a: string, b: string) => a === b || (RETRIEVAL_TOOLS.has(a) && RETRIEVAL_TOOLS.has(b));
const capabilityOf = (tool: string): CapabilityId => CAPABILITIES.find((c) => (c.tools as string[]).includes(tool))?.id ?? 'historical';

/** 사람의 판단이 필요한 변경 제안을 승인 / 거절로 기록한다. 어떤 경우에도 값을 적용하지 않는다 (이 단계에는 write Tool 이 없다). */
export function resolveCheckpoint(state: WorkflowState, checkpointId: string, decision: 'approved' | 'rejected'): WorkflowState {
  const cps = state.checkpoints.map((c): HumanCheckpoint => (c.id === checkpointId && c.status === 'pending' ? { ...c, status: decision } : c));
  const pending = cps.some((c) => c.status === 'pending');
  const approved = cps.filter((c) => c.status === 'approved').length;
  return {
    ...state, checkpoints: cps, status: pending ? 'waiting-for-user' : 'completed',
    message: pending ? state.message : approved > 0 ? '승인된 제안이 있습니다. 이 단계에서는 값을 자동으로 바꾸지 않으므로 ValuFlow 에서 직접 입력한 뒤 다시 계산하세요.' : '모든 제안이 거절되었습니다. 가정은 그대로입니다.',
  };
}

function initialState(plan: WorkflowPlan, question: string, ctx: AiValuationContext, workflowId: string): WorkflowState {
  return {
    workflowId, workflowType: plan.workflowType, question, company: ctx.company ? { name: ctx.company.name, corpCode: ctx.company.corpCode } : null,
    contextSnapshotId: snapshotId(ctx), steps: plan.steps.map((s) => ({ ...s })), currentStep: null, toolsExecuted: [], observations: [], warnings: [], sources: [], checkpoints: [],
    status: 'planned', message: null,
  };
}

function partialAnswer(state: WorkflowState, why: string): WorkflowAnswer {
  const done = state.steps.filter((s) => s.status === 'completed');
  return {
    mode: 'explain', summary: `${why} 지금까지 확인한 영역만 정리합니다.`, evidence: [], warnings: [], sources: [], suggestedNextActions: ['남은 단계는 질문을 나눠서 다시 요청하세요.'],
    reviewedAreas: done.map((s) => s.purpose), limitations: [why, ...state.steps.filter((s) => s.status === 'pending').map((s) => `${s.tool}: 한도 때문에 실행하지 못했습니다.`)], judgmentItems: [], claims: [], evidenceMap: [], grounding: null, proposedActions: [],
  };
}

export async function runWorkflow(options: RunWorkflowOptions): Promise<WorkflowOutcome | null> {
  const now = options.now ?? (() => new Date());
  const t0 = now().getTime();
  const ctx = buildAiContext(options.project, { historicalStatus: options.historicalStatus });   // immutable snapshot: workflow 끝까지 같은 값을 쓴다
  const route = options.route ?? routeRetrieval(options.question);
  const plan = planWorkflow(options.question, ctx, { maxToolCalls: options.maxToolCalls, route: route.route });
  if (!plan) return null;
  const classification = classifyQuestion(options.question);
  const workflowId = (options.newId ?? (() => `wf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`))();
  let state = initialState(plan, options.question, ctx, workflowId);
  const results: ToolResult<unknown>[] = [];
  const violations: AnswerViolation[] = [];
  const corrections: string[] = [];
  let conversationId: string | null = null;
  let answer: WorkflowAnswer | null = null;
  let error: WorkflowOutcome['error'] = null;
  const groundingSink: { audit: GroundingAuditEvent | null } = { audit: null };

  const finish = (): WorkflowOutcome => {
    const audit: WorkflowAuditEvent = {
      timestamp: now().toISOString(), workflowId, workflowType: plan.workflowType, question: options.question, conversationId, contextSnapshotId: state.contextSnapshotId,
      stepsPlanned: plan.steps.map((s) => s.id), stepsExecuted: state.steps.filter((s) => s.status === 'completed' || s.status === 'failed').map((s) => s.id),
      toolsExecuted: state.toolsExecuted.map((t) => ({ ...t })), sourcesUsed: [...state.sources], warnings: [...state.warnings],
      humanCheckpoint: { count: state.checkpoints.length, kinds: state.checkpoints.map((c) => c.kind), pending: state.checkpoints.filter((c) => c.status === 'pending').length },
      status: state.status, durationMs: Math.max(0, now().getTime() - t0), violations: violations.map((v) => v.code), corrections: [...corrections], grounding: groundingSink.audit,
    };
    return { groundingLevel: 'claim-evidence', state, plan, answer, results, violations, corrections, audit, error };
  };

  // ---- 실행할 수 없는 계획: unsupported 기업은 Valuation workflow 를 실행하지 않는다 (이전 기업의 값이 섞이지 않는다) ----
  if (plan.blocked) {
    if (plan.blocked.code === 'unsupported') {
      const overview = runTool('getCompanyOverview', ctx, undefined);
      results.push(overview);
      state = { ...state, steps: state.steps.map((s) => ({ ...s, status: 'skipped' as const, reason: s.reason ?? '지원하지 않는 기업' })), toolsExecuted: [{ tool: 'getCompanyOverview', status: overview.status }], observations: [observe(overview)], status: 'completed', message: UNSUPPORTED_DISCLOSURE };
      answer = { mode: 'explain', summary: UNSUPPORTED_DISCLOSURE, evidence: [], warnings: [], sources: [], suggestedNextActions: ['지원되는 기업을 선택하세요.'], reviewedAreas: [], limitations: [UNSUPPORTED_DISCLOSURE], judgmentItems: [], claims: [], evidenceMap: [], grounding: null, proposedActions: [] };
    } else {
      state = { ...state, steps: state.steps.map((s) => (s.status === 'pending' ? { ...s, status: 'skipped' as const, reason: plan.blocked!.reason } : s)), status: 'failed', message: plan.blocked.reason };
    }
    return finish();
  }

  // ---- 실행 ----
  const steps = state.steps;
  const setStep = (tool: string, patch: Partial<WorkflowStep>) => {
    // 검색 Tool(공시 · 업로드 문서 · 통합 지식 검색)은 같은 retrieval 계열이다: 업로드 문서를 묻는 질문에서 searchUploadedDocuments 로 확인했다면 대기 중인 검색 단계(searchDisclosures)를 충족한 것이다
    const s = steps.find((x) => x.tool === tool && (x.status === 'pending' || x.status === 'running')) ?? (RETRIEVAL_TOOLS.has(tool) && patch.status === 'completed' ? steps.find((x) => RETRIEVAL_TOOLS.has(x.tool) && x.status === 'pending') ?? null : null);
    if (s) { Object.assign(s, patch, s.tool !== tool && patch.status === 'completed' ? { reason: `같은 검색 계열 Tool(${tool})로 확인했습니다.` } : {}); return; }
    if (patch.status === 'completed' || patch.status === 'failed') {  // 계획에 없던 Tool: 관찰에 따라 모델이 추가로 호출한 동적 단계
      if (steps.length >= MAX_WORKFLOW_STEPS) { state.status = 'tool-limit'; return; }
      steps.push({ id: `dynamic-${steps.length + 1}`, capability: capabilityOf(tool), tool: tool as ToolName, purpose: `${getToolDefinition(tool)?.description.slice(0, 40) ?? tool} (관찰에 따라 추가)`, optional: true, status: 'pending', dynamic: true, ...patch });
    }
  };
  const emit = () => options.onProgress?.({ ...state, steps: state.steps.map((s) => ({ ...s })), toolsExecuted: [...state.toolsExecuted], warnings: [...state.warnings], sources: [...state.sources] });
  const record = (result: ToolResult<unknown>, obs: Observation) => {
    results.push(result);
    state.observations.push(obs);
    state.toolsExecuted.push({ tool: result.tool, status: result.status });
    if (result.status === 'ok') {
      setStep(result.tool, { status: 'completed' });
      for (const w of result.warnings.filter((x) => x.level === 'review')) if (!state.warnings.includes(w.text)) state.warnings.push(w.text);
      for (const s of result.sources) { const label = `${s.type ?? s.kind}:${s.origin}`; if (!state.sources.includes(label)) state.sources.push(label); }
    } else {
      setStep(result.tool, { status: 'failed', reason: obs.findings[0] ?? result.status });
    }
    emit();
  };

  state.status = 'running';
  emit();
  let backendSeen = 0;
  const pendingHints: Observation['nextHints'] = [];
  const takeBackend = (list: ToolResult<unknown>[] | undefined, cumulative: boolean) => {
    const fresh = (list ?? []).slice(cumulative ? backendSeen : 0);
    for (const r of fresh) { const o = observe(r); record(r, o); pendingHints.push(...o.nextHints); }
    backendSeen += fresh.length;
  };
  const absorbGateway = (trace: ToolTraceEntry[] | undefined) => {  // gateway 가 차단한 호출(반복 · 승인 필요 · 잘못된 입력)도 audit 에 남긴다
    for (const t of trace ?? []) if (t.runtime === 'gateway') state.toolsExecuted.push({ tool: t.tool, status: t.status });
  };

  try {
    let res: GatewayResponse = await options.client.query({
      question: options.question, minimalContext: { ...buildMinimalContext(ctx), ...routeContext(route) }, toolNames: toolNamesFor(TOOL_NAMES, route.route),
      classification: { mode: classification.mode, capabilities: classification.capabilities, matched: classification.matched, suggestedTools: classification.suggestedTools },
      workflow: { type: plan.workflowType, steps: steps.filter((s) => s.status === 'pending').map((s) => ({ id: s.id, tool: s.tool, purpose: s.purpose, optional: s.optional })), maxToolCalls: plan.maxToolCalls },
    });
    for (let round = 0; round < plan.maxToolCalls + 2; round++) {
      if (options.signal?.aborted) throw new AiClientError('cancelled', '사용자가 분석을 취소했습니다.');
      conversationId = res.conversationId;
      if (res.status === 'tool-limit') {
        takeBackend(res.backendToolResults, true);
        absorbGateway(res.toolTrace);
        state.status = 'tool-limit';
        state.message = res.message;
        answer = partialAnswer(state, `Tool 호출 한도(${plan.maxToolCalls}회)에 도달했습니다.`);
        break;
      }
      if (res.status === 'final') {
        takeBackend(res.backendToolResults, true);
        absorbGateway(res.toolTrace);
        answer = await finalize(res.answer as RawWorkflowAnswer, state, results, ctx, violations, corrections, { question: options.question, client: options.client, sink: groundingSink });
        break;
      }
      takeBackend(res.backendToolResults, false);
      const call = res as ToolCallResponse;
      const step = steps.find((s) => s.tool === call.tool && s.status === 'pending');
      if (step) { step.status = 'running'; state.currentStep = step.id; } else state.currentStep = call.tool;
      emit();
      const result = runTool(call.tool, ctx, call.input);
      const obs = observe(result);
      record(result, obs);
      const hints = [...pendingHints.splice(0), ...obs.nextHints];
      const req: AiToolResultRequest = {
        conversationId: call.conversationId, state: call.state, callId: call.callId, toolResult: result,
        workflowObservation: { tool: obs.tool, status: obs.status, findings: obs.findings, missing: obs.missing, warnings: obs.warnings, nextHints: hints },
      };
      if ((state.status as WorkflowStatus) === 'tool-limit') { answer = partialAnswer(state, `workflow 단계 수 한도(${MAX_WORKFLOW_STEPS}개)에 도달했습니다.`); break; }
      res = await options.client.sendToolResult(req);
    }
    if (!answer && state.status === 'running') { state.status = 'tool-limit'; state.message = '왕복 한도에 도달해 안전하게 종료했습니다.'; answer = partialAnswer(state, '왕복 한도에 도달했습니다.'); }
  } catch (e) {
    error = e instanceof AiClientError ? { code: e.code, message: e.message } : { code: 'unknown', message: 'Workflow 를 처리하지 못했습니다.' };
    state.status = 'failed';
    state.message = error.message;
  }

  // ---- 마무리: 남은 단계 정리, 사람 확인 지점 ----
  for (const s of state.steps) if (s.status === 'pending' || s.status === 'running') { s.status = 'skipped'; s.reason = s.reason ?? (s.optional ? '필요하지 않아 호출하지 않았습니다.' : '호출되지 않았습니다.'); }
  state.currentStep = null;
  if (answer && state.status === 'running') {
    state.checkpoints = answer.proposedActions.map((a, i): HumanCheckpoint => ({ id: `${workflowId}-cp${i + 1}`, kind: a.type, target: a.target, currentValue: a.currentValue, proposedValue: a.proposedValue, rationale: a.rationale, status: 'pending', applied: false }));
    state.status = state.checkpoints.length > 0 ? 'waiting-for-user' : 'completed';
    if (state.checkpoints.length > 0) state.message = `${state.checkpoints.length}개의 변경 제안이 사용자 승인을 기다립니다. 승인 전에는 아무 값도 바뀌지 않습니다.`;
  }
  return finish();
}

/** 모델의 workflow 답변을 보정한다: Grounded Analysis(claim ↔ evidence 검증 · 교정 재생성 · safe fallback) + 한계 복원 + 변경 완료 주장 감지. 모델의 해석은 바꾸지 않는다. */
async function finalize(raw: RawWorkflowAnswer, state: WorkflowState, results: ToolResult<unknown>[], ctx: AiValuationContext, violations: AnswerViolation[], corrections: string[],
  opts: { question: string; client: AiGatewayClient; sink: { audit: GroundingAuditEvent | null } }): Promise<WorkflowAnswer> {
  // 변경 제안은 구체적일 때만 사람에게 올린다: 대상 · 현재 값 · 제안 값 · 근거가 모두 있어야 한다 (모호한 제안은 판단 대상(judgmentItems)으로만 남는다)
  const proposed = ((raw.proposedActions ?? []) as Proposal[]).filter((a) => {
    const text = [a.target, a.currentValue, a.proposedValue, a.rationale].every((x) => typeof x === 'string' && x.trim().length > 0);
    // 값을 바꾸는 제안은 현재 값과 제안 값이 숫자여야 한다 ("재검토 권고" 같은 서술은 제안 값이 아니라 judgmentItems 다)
    const numeric = !/^change-/.test(a.type) || (/\d/.test(String(a.currentValue)) && /\d/.test(String(a.proposedValue)));
    const complete = text && numeric;
    if (!complete) violations.push({ code: 'proposal-incomplete', detail: `proposal "${a.type} ${String(a.target).slice(0, 40)}" has no concrete current/proposed value and was not sent to the analyst` });
    return complete;
  });
  if (proposed.length !== (raw.proposedActions ?? []).length) corrections.push('proposals-filtered');
  const r = await groundWithRepair({ question: opts.question, raw: { ...raw, proposedActions: proposed }, results, unsupported: ctx.support.status === 'unsupported', client: opts.client });
  violations.push(...r.violations);
  corrections.push(...r.corrections);
  opts.sink.audit = r.audit;

  const limitations = [...(raw.limitations ?? []), ...r.extraLimitations.filter((l) => !(raw.limitations ?? []).includes(l))];
  const restore = (tool: string, why: string) => {
    const word = LIMITATION_LABEL[tool]?.split(' ')[0];
    if (!limitations.some((l) => l.includes(tool) || (word !== undefined && l.includes(word)))) { limitations.push(limitationFor(tool, why)); if (!corrections.includes('limitations-restored')) corrections.push('limitations-restored'); }
  };
  // 같은 Tool 이 나중에 성공했다면(예: 첫 검색이 결과 없음 → 질의를 바꿔 재검색 성공) 그 실패는 한계가 아니다
  for (const s of state.steps) if (s.status === 'failed' && !state.steps.some((x) => sameFamily(x.tool, s.tool) && x.status === 'completed')) restore(s.tool, s.reason ?? 'unavailable');
  for (const s of state.steps) if (s.status === 'skipped' && !s.optional && s.reason && !s.reason.startsWith('지원하지')) restore(s.tool, s.reason === '호출되지 않았습니다.' ? '필수 단계가 실행되지 않았습니다' : s.reason);
  const reviewedAreas = (raw.reviewedAreas ?? []).length > 0 ? [...raw.reviewedAreas!] : state.steps.filter((s) => s.status === 'completed').map((s) => s.purpose);
  if ((raw.reviewedAreas ?? []).length === 0 && reviewedAreas.length > 0) corrections.push('reviewed-areas-filled');
  const text = `${raw.summary} ${r.answer.summary} ${r.claims.map((c) => c.text).join(' ')}`;   // 보정 전 원문도 검사한다
  if ((APPLIED_CLAIM.test(text) && r.proposals.length === 0) || /(WACC|Forecast|가정|배수).{0,15}(변경|수정|적용|저장)(했|되었|됐)/.test(text)) {
    violations.push({ code: 'applied-change-claimed', detail: 'the answer states that an assumption was changed/applied, but the agent never changes anything' });
  }
  const leak = (s: string) => leaksSystemPrompt(s);   // claim · 한계 · 판단 항목 · 제안에 system instruction 이 들어간 경우도 제거한다
  const clean = <T,>(list: T[], text: (x: T) => string): T[] => { const kept = list.filter((x) => !leak(text(x))); if (kept.length !== list.length && !corrections.includes('prompt-leak-removed')) { corrections.push('prompt-leak-removed'); violations.push({ code: 'prompt-leak', detail: 'the answer contains text from the system instruction' }); } return kept; };
  return { ...r.answer, reviewedAreas: clean(reviewedAreas, (x) => x), limitations: clean(limitations, (x) => x), judgmentItems: clean(raw.judgmentItems ?? [], (x) => x), claims: clean(r.claims, (c) => c.text), evidenceMap: r.report.evidenceMap, grounding: r.report, proposedActions: r.proposals };
}
