// AI Analyst 질문 실행: 질문마다 새 context snapshot 으로 실행한다 (이전 질문의 기업 · 값이 섞이지 않는다).
// Project state 는 읽기만 한다: 이 모듈은 ProjectState 를 바꾸는 어떤 함수도 받지 않는다.
import { buildAiContext, type AiValuationContext } from '../context.ts';
import type { ProjectState } from '../../store/projectModel.ts';
import type { HistoricalLoadStatus } from '../../store/historicalLoad.ts';
import type { AiGatewayClient } from '../client.ts';
import { planWorkflow } from '../agent/planner.ts';
import { runWorkflow, snapshotId } from '../agent/run.ts';
import { runAiQuery } from '../query.ts';
import type { WorkflowState } from '../agent/types.ts';
import {
  buildQuickTurn, buildWorkflowTurn, errorView, progressText, QUICK_PROGRESS_TEXT, waccPanel,
  type AnalystMode, type AnalystTurn, type BuildContext, type ModePreference, type StepView,
} from './view.ts';

const WACC_QUESTION = /WACC|할인율|베타|\bbeta\b|무위험|위험\s*프리미엄|자본\s*비용/i;
const WACC_WORKFLOWS = new Set(['wacc-review', 'dcf-review', 'full-valuation-review']);

export interface Progress { mode: AnalystMode; label: string | null; steps: StepView[]; text: string }

export interface AskOptions {
  question: string;
  project: ProjectState;
  client: AiGatewayClient;
  preference?: ModePreference;
  historicalStatus?: HistoricalLoadStatus;
  now?: () => Date;
  newId?: () => string;
  onProgress?: (p: Progress) => void;
  signal?: { readonly aborted: boolean };
}

/** Quick / Workflow 선택: 자동이면 workflow 질문일 때만 Deep Analysis. Deep Analysis 를 골라도 workflow 로 계획할 수 없는 질문은 Quick 이다. */
export function resolveMode(question: string, ctx: AiValuationContext, preference: ModePreference = 'auto'): AnalystMode {
  if (preference === 'quick') return 'quick';
  return planWorkflow(question, ctx) ? 'workflow' : 'quick';
}

const stepViews = (s: WorkflowState): StepView[] => s.steps.map((x) => ({ id: x.id, label: x.purpose, tool: x.tool, status: x.status, reason: x.reason ?? null, optional: x.optional }));

export async function askAnalyst(o: AskOptions): Promise<AnalystTurn> {
  const now = o.now ?? (() => new Date());
  const ctx = buildAiContext(o.project, { historicalStatus: o.historicalStatus });   // 질문 시작 시점의 snapshot
  const mode = resolveMode(o.question, ctx, o.preference);
  const id = (o.newId ?? (() => `turn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`))();
  const company = ctx.company ? { name: ctx.company.name, stockCode: ctx.company.stockCode, corpCode: ctx.company.corpCode } : null;
  const base: BuildContext = {
    id, now: now().toISOString(), snapshotId: snapshotId(ctx), company, showWacc: WACC_QUESTION.test(o.question),
    wacc: waccPanel(o.project.valuationAssumptions as Record<string, unknown> | null, o.project.valuationResult),
  };

  if (!ctx.company) {   // 기업이 없으면 질문하지 않는다 (샘플 데이터를 자동으로 채우지 않는다)
    return { ...emptyTurn(base, o.question, mode), status: 'failed', error: errorView('no-company') };
  }

  try {
    if (mode === 'workflow') {
      const outcome = await runWorkflow({
        question: o.question, project: o.project, client: o.client, historicalStatus: o.historicalStatus, now, signal: o.signal,
        onProgress: o.onProgress ? (s) => o.onProgress!({ mode, label: null, steps: stepViews(s), text: progressText(s.steps) }) : undefined,
      });
      if (outcome) {
        const turn = buildWorkflowTurn(outcome, { ...base, showWacc: base.showWacc || WACC_WORKFLOWS.has(outcome.plan.workflowType) }, o.question);
        return turn;
      }
    }
    o.onProgress?.({ mode: 'quick', label: null, steps: [], text: QUICK_PROGRESS_TEXT });
    return buildQuickTurn(await runAiQuery({ question: o.question, project: o.project, client: o.client, historicalStatus: o.historicalStatus, now }), base, o.question);
  } catch {
    return { ...emptyTurn(base, o.question, mode), status: 'failed', error: errorView('unknown') };
  }
}

export function emptyTurn(base: BuildContext, question: string, mode: AnalystMode): AnalystTurn {
  return {
    id: base.id, question, mode, askedAt: base.now, company: base.company, workflowType: null, workflowLabel: null, contextSnapshotId: base.snapshotId, status: 'failed', steps: [], usedSources: [],
    answer: null, evidence: [], sources: [], timeBasis: null, warnings: [], grounding: null, checkpoints: [], wacc: null, error: null, debug: null, analysis: null,
  };
}

/** 사용자가 취소했을 때 기록하는 turn (결과는 버린다). */
export function cancelledTurn(o: Pick<AskOptions, 'question' | 'project' | 'historicalStatus' | 'now' | 'newId'>, mode: AnalystMode): AnalystTurn {
  const ctx = buildAiContext(o.project, { historicalStatus: o.historicalStatus });
  const company = ctx.company ? { name: ctx.company.name, stockCode: ctx.company.stockCode, corpCode: ctx.company.corpCode } : null;
  const id = (o.newId ?? (() => `turn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`))();
  return { ...emptyTurn({ id, now: (o.now ?? (() => new Date()))().toISOString(), snapshotId: snapshotId(ctx), company, wacc: null, showWacc: false }, o.question, mode), status: 'cancelled', error: errorView('cancelled') };
}
