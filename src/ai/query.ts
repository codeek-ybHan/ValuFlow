// AI 질문 실행기: Backend LLM ↔ Frontend Tool Runtime.
//   질문 → (backend) 모델 → Tool 요청 → executeTool(같은 context snapshot) → Tool 결과 → (backend) 모델 → … → 최종 답변
// - 질문 시작 시 만든 immutable context snapshot 을 loop 내내 쓴다 (loop 중 Project State 가 바뀌어도 한 답변 안에서 섞이지 않는다). 새 질문은 새 snapshot 이다.
// - 계산은 backend 도 LLM 도 하지 않는다. Tool 결과가 deterministic source of truth 다.
import { buildAiContext, type AiContextOptions, type AiValuationContext } from './context.ts';
import type { ProjectState } from '../store/projectModel.ts';
import { classifyQuestion } from './capabilities.ts';
import { TOOL_NAMES } from './tools/definitions.ts';
import { executeTool } from './tools/registry.ts';
import type { ToolResult } from './tools/result.ts';
import { AiClientError, type AiGatewayClient, type GatewayResponse, type ToolTraceEntry } from './client.ts';
import { enforceGrounding, type AiAnalystAnswer, type AnswerViolation } from './answer.ts';
import type { AiFinalStatus, AiQueryAuditEvent } from './audit.ts';
import { buildMinimalContext } from './minimalContext.ts';

/** 클라이언트 측 안전장치: backend 의 Tool 한도와 별개로 왕복 횟수를 제한한다 (무한 loop 방지). */
export const MAX_CLIENT_ROUNDS = 10;

export interface RunAiQueryOptions extends AiContextOptions {
  question: string;
  project: ProjectState;
  client: AiGatewayClient;
  now?: () => Date;
}

export interface AiQueryOutcome {
  status: AiFinalStatus;
  answer: AiAnalystAnswer | null;
  /** 모델 답변에서 감지한 위반 (보정 전) */
  violations: AnswerViolation[];
  corrections: string[];
  results: ToolResult<unknown>[];
  audit: AiQueryAuditEvent;
  /** tool-limit 안내 또는 오류 사유 */
  message: string | null;
  error: { code: string; message: string } | null;
}

function runTool(name: string, ctx: AiValuationContext, input: unknown): ToolResult<unknown> {
  try {
    return executeTool(name, ctx, input);
  } catch {
    return { status: 'unavailable', tool: name, reason: 'Tool execution failed.', sources: [], warnings: [] };
  }
}

export async function runAiQuery(options: RunAiQueryOptions): Promise<AiQueryOutcome> {
  const now = options.now ?? (() => new Date());
  const question = options.question;
  // 질문 시작 시점의 immutable snapshot (loop 동안 같은 snapshot 사용)
  const ctx = buildAiContext(options.project, { historicalStatus: options.historicalStatus });
  const classification = classifyQuestion(question);

  const requested: string[] = [];
  const executed: { tool: string; status: string }[] = [];
  const results: ToolResult<unknown>[] = [];
  let conversationId: string | null = null;
  let trace: ToolTraceEntry[] | null = null;

  const finish = (status: AiFinalStatus, extra: Partial<AiQueryOutcome> & { violations?: AnswerViolation[]; corrections?: string[]; error?: { code: string; message: string } } = {}): AiQueryOutcome => {
    const answer = extra.answer ?? null;
    const warnings = answer ? answer.warnings : [...new Set(results.flatMap((r) => r.warnings).map((w) => w.text))];
    // gateway 가 알려 준 실행 순서 · 위치 (backend Tool 포함). 없으면 frontend 가 실행한 Tool 만 있다.
    const runtimes = trace ? trace.map((t) => ({ tool: t.tool, runtime: t.runtime })) : executed.map((e) => ({ tool: e.tool, runtime: 'frontend' }));
    let fi = 0;
    const toolsExecuted = trace ? trace.map((t) => ({ tool: t.tool, status: t.runtime === 'frontend' ? (executed[fi++]?.status ?? t.status) : t.status })) : executed.map((e) => ({ ...e }));
    const docSources = results.flatMap((r) => r.sources).filter((s) => s.type === 'disclosure-document');
    const audit: AiQueryAuditEvent = {
      timestamp: now().toISOString(),
      question,
      toolUsed: [...new Set(toolsExecuted.map((e) => e.tool))],
      sourceUsed: [...new Set(results.flatMap((r) => r.sources).map((s) => `${s.kind}:${s.origin}${s.basis ? `:${s.basis}` : ''}`))],
      warningsIncluded: warnings,
      conversationId,
      classification: { mode: classification.mode, capabilities: [...classification.capabilities], matched: classification.matched, suggestedTools: [...classification.suggestedTools] },
      toolsRequested: trace ? trace.map((t) => t.tool) : [...requested],
      toolsExecuted,
      toolRuntimes: runtimes,
      documentSources: [...new Set(docSources.map((s) => `${s.receiptNo ?? ''} | ${s.section ?? ''}`))],
      retrievedDocumentIds: [...new Set(docSources.map((s) => s.receiptNo).filter((x): x is string => !!x))],
      finalStatus: status,
      violations: (extra.violations ?? []).map((v) => v.code),
      corrections: extra.corrections ?? [],
      errorCode: extra.error?.code ?? null,
    };
    return { status, answer, violations: extra.violations ?? [], corrections: extra.corrections ?? [], results, audit, message: extra.message ?? extra.error?.message ?? null, error: extra.error ?? null };
  };

  try {
    let res: GatewayResponse = await options.client.query({
      question, minimalContext: buildMinimalContext(ctx), toolNames: [...TOOL_NAMES],
      classification: { mode: classification.mode, capabilities: classification.capabilities, matched: classification.matched, suggestedTools: classification.suggestedTools },
    });
    for (let round = 0; round < MAX_CLIENT_ROUNDS; round++) {
      conversationId = res.conversationId;
      if (res.status === 'tool-limit') { trace = res.toolTrace ?? trace; results.push(...(res.backendToolResults ?? [])); return finish('tool-limit', { message: res.message }); }
      if (res.status === 'final') {
        trace = res.toolTrace ?? trace;
        results.push(...(res.backendToolResults ?? []));  // backend 가 실행한 Tool 결과(공시 검색 등)도 같은 grounding 대상이다
        const g = enforceGrounding(res.answer, results, { unsupported: ctx.support.status === 'unsupported' });
        return finish(g.corrections.length > 0 ? 'answered-with-corrections' : 'answered', { answer: g.answer, violations: g.violations, corrections: g.corrections });
      }
      requested.push(res.tool);
      const result = runTool(res.tool, ctx, res.input);
      executed.push({ tool: res.tool, status: result.status });
      results.push(result);
      res = await options.client.sendToolResult({ conversationId: res.conversationId, state: res.state, callId: res.callId, toolResult: result });
    }
    return finish('tool-limit', { message: `왕복 한도(${MAX_CLIENT_ROUNDS}회)에 도달해 안전하게 종료했습니다.` });
  } catch (e) {
    const error = e instanceof AiClientError ? { code: e.code, message: e.message } : { code: 'unknown', message: 'AI 질문을 처리하지 못했습니다.' };
    return finish('error', { error });
  }
}
