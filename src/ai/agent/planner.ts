// Workflow Planner: 질문 → workflow 종류 · 필요한 capability · 예상 Tool · 순서를 정한다 (규칙 기반; classifyQuestion 은 routing hint 로 재사용한다).
// Planner 는 Tool 입력 값이나 데이터를 만들어 내지 않는다: 계획에는 Tool 이름과 목적만 있고, 값은 Tool 실행 결과에서만 온다.
import type { RetrievalRoute } from '../retrievalRoute.ts';
import type { WorkflowTemplateStep } from './workflows.ts';
import type { AiValuationContext } from '../context.ts';
import { getToolDefinition, type ToolRequirement } from '../tools/definitions.ts';
import { classifyQuestion } from '../capabilities.ts';
import { UNSUPPORTED_DISCLOSURE } from '../policy.ts';
import { WORKFLOWS } from './workflows.ts';
import type { WorkflowPlan, WorkflowStep } from './types.ts';

/** Agent Workflow 의 Tool 호출 한도 기본값 (일반 질문은 5회). backend 가 설정의 상한(AI_AGENT_MAX_TOOL_CALLS)으로 다시 제한한다. */
export const AGENT_MAX_TOOL_CALLS = 10;

/** 질문이 workflow 업무인가? 아니면 null (일반 질문은 기존 runAiQuery 로 처리한다). */
export function classifyWorkflow(question: string) {
  return WORKFLOWS.find((w) => w.pattern.test(question)) ?? null;
}

function met(req: ToolRequirement, ctx: AiValuationContext): { ok: boolean; reason: string } {
  switch (req) {
    case 'none': return { ok: true, reason: '' };
    case 'historical': return { ok: ctx.historicalData !== null, reason: 'Historical 데이터가 없습니다.' };
    case 'quality': return { ok: ctx.historicalQuality !== null, reason: '데이터 품질 정보가 없습니다 (학습용 fixture 이거나 Historical 이 없습니다).' };
    case 'assumptions': return { ok: ctx.valuationAssumptions !== null, reason: 'Forecast 가정이 입력되지 않았습니다.' };
    case 'valuation': return { ok: ctx.valuationResult !== null, reason: 'Valuation 이 실행되지 않았습니다.' };
    case 'sensitivity': return { ok: ctx.sensitivityResult !== null, reason: 'Sensitivity 결과가 없습니다.' };
  }
}

export interface PlanOptions { maxToolCalls?: number; route?: RetrievalRoute }

/** 문서 질문의 라우팅을 workflow 단계에 반영한다: 업로드 문서를 가리키면 공시 검색 단계를 업로드 문서 검색으로 바꾸고, 공시만 명시하면 업로드 문서 검색 단계를 뺀다. */
export function routeSteps(steps: readonly WorkflowTemplateStep[], route: RetrievalRoute | undefined): WorkflowTemplateStep[] {
  if (route === undefined || route === 'default' || route === 'both') return [...steps];
  const out: WorkflowTemplateStep[] = [];
  for (const s of steps) {
    if (route === 'uploaded' && (s.tool === 'searchDisclosures' || s.tool === 'searchKnowledge')) {
      const prior = out.find((x) => x.tool === 'searchUploadedDocuments');
      if (prior) { if (!s.optional) prior.optional = false; continue; }
      out.push({ ...s, capability: 'knowledge', tool: 'searchUploadedDocuments', purpose: '업로드한 문서에서 근거 확인' });
    } else if (route === 'disclosure' && (s.tool === 'searchUploadedDocuments' || s.tool === 'searchKnowledge')) continue;
    else out.push({ ...s });
  }
  return out;
}

/** 질문과 context 로 계획을 만든다. workflow 질문이 아니면 null. */
export function planWorkflow(question: string, ctx: AiValuationContext, options: PlanOptions = {}): WorkflowPlan | null {
  const template = classifyWorkflow(question);
  if (!template) return null;
  const hints = classifyQuestion(question);
  const maxToolCalls = options.maxToolCalls ?? AGENT_MAX_TOOL_CALLS;
  const unsupported = ctx.support.status === 'unsupported';
  const steps: WorkflowStep[] = routeSteps(template.steps, options.route).map((s): WorkflowStep => {
    const def = getToolDefinition(s.tool)!;
    const r = met(def.requires, ctx);
    const base: WorkflowStep = { id: s.id, capability: s.capability, tool: s.tool, purpose: s.purpose, optional: s.optional, status: 'pending' };
    if (unsupported && !def.allowedWhenUnsupported) return { ...base, status: 'skipped', reason: '지원하지 않는 기업이라 실행하지 않습니다.' };
    if (!r.ok) return { ...base, status: 'skipped', reason: r.reason };
    return base;
  });
  const runnable = steps.filter((s) => s.status === 'pending');
  const core = runnable.filter((s) => !s.optional);
  let blocked: WorkflowPlan['blocked'] = null;
  if (unsupported) blocked = { code: 'unsupported', reason: UNSUPPORTED_DISCLOSURE };
  else if (core.length === 0) blocked = { code: 'no-data', reason: `검토에 필요한 데이터가 없습니다: ${steps.filter((s) => !s.optional && s.reason).map((s) => `${s.tool} (${s.reason})`).join(' · ') || '실행 가능한 필수 단계가 없습니다.'}` };
  return { workflowType: template.type, label: template.label, steps, maxToolCalls, blocked, routingHints: [...hints.capabilities] };
}
