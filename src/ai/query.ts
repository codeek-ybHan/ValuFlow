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
import { routeContext, routeRetrieval, toolNamesFor, type RouteDecision } from './retrievalRoute.ts';
import { enforceQuickNumbers } from './quickGuard.ts';

/** 클라이언트 측 안전장치: backend 의 Tool 한도와 별개로 왕복 횟수를 제한한다 (무한 loop 방지). */
export const MAX_CLIENT_ROUNDS = 10;

export interface RunAiQueryOptions extends AiContextOptions {
  question: string;
  project: ProjectState;
  client: AiGatewayClient;
  now?: () => Date;
  /** 문서 질문의 검색 대상 라우팅 (없으면 질문에서 정한다). 허용되지 않은 검색 Tool 은 모델에 주어지지 않는다. */
  route?: RouteDecision;
}

/**
 * 기술부채: 일반 질문(runAiQuery)에는 Grounded Analysis(claim ↔ evidence 검증 · 교정 재생성)를 아직 적용하지 않는다 — 답변에 claim 구조가 없다.
 * (STEP 08-8 에서 요약 숫자는 문장 단위로 검증한다: quickGuard.ts. claim 연결 · 재생성은 여전히 Deep Analysis 에만 있다.)
 * 통합 지점: `groundWithRepair`(src/ai/grounding/repair.ts)는 claims 가 비어 있어도 summary 의 숫자 검증을 하므로, 일반 질문도 같은 경로에 태우면 된다
 * (답변 schema 에 claims 를 추가하거나 summary 숫자 검증만 적용). UI 는 `groundingLevel` 로 두 경로의 수준 차이를 구분해서 보여야 한다.
 */
export interface AiQueryOutcome {
  groundingLevel: 'tool-guardrails';
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
  const route = options.route ?? routeRetrieval(question);

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
    const docSources = results.flatMap((r) => r.sources).filter((s) => s.type === 'disclosure-document' || s.type === 'uploaded-document');
    const searches = (trace ?? []).filter((t) => t.runtime === 'backend');
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
      documentSources: [...new Set(docSources.map((s) => `${s.documentId ?? s.receiptNo ?? ''} | ${s.page != null ? `p.${s.page}` : (s.section ?? '')}`))],
      retrievedDocumentIds: [...new Set(docSources.map((s) => s.documentId ?? s.receiptNo).filter((x): x is string => !!x))],
      retrievalSourceTypes: [...new Set(searches.flatMap((t) => t.sourceTypes ?? []))],
      retrievalCount: searches.reduce((n, t) => n + (t.retrievalCount ?? 0), 0),
      rerankedCount: searches.reduce((n, t) => n + (t.rerankedCount ?? 0), 0),
      finalStatus: status,
      violations: (extra.violations ?? []).map((v) => v.code),
      corrections: extra.corrections ?? [],
      errorCode: extra.error?.code ?? null,
    };
    return { groundingLevel: 'tool-guardrails', status, answer, violations: extra.violations ?? [], corrections: extra.corrections ?? [], results, audit, message: extra.message ?? extra.error?.message ?? null, error: extra.error ?? null };
  };

  try {
    let res: GatewayResponse = await options.client.query({
      question, minimalContext: { ...buildMinimalContext(ctx), ...routeContext(route) }, toolNames: toolNamesFor(TOOL_NAMES, route.route),
      classification: { mode: classification.mode, capabilities: classification.capabilities, matched: classification.matched, suggestedTools: classification.suggestedTools },
    });
    for (let round = 0; round < MAX_CLIENT_ROUNDS; round++) {
      conversationId = res.conversationId;
      if (res.status === 'tool-limit') { trace = res.toolTrace ?? trace; results.push(...(res.backendToolResults ?? [])); return finish('tool-limit', { message: res.message }); }
      if (res.status === 'final') {
        trace = res.toolTrace ?? trace;
        results.push(...(res.backendToolResults ?? []));  // backend 가 실행한 Tool 결과(공시 검색 등)도 같은 grounding 대상이다
        const g = enforceGrounding(res.answer, results, { unsupported: ctx.support.status === 'unsupported' });
        const n = enforceQuickNumbers(g.answer, results);   // 요약의 근거 없는 숫자 · 엔진 값이 아닌 Valuation 숫자 제거 (문장 단위)
        const violations = [...g.violations, ...n.violations];
        const corrections = [...g.corrections, ...n.corrections];
        return finish(corrections.length > 0 ? 'answered-with-corrections' : 'answered', { answer: n.answer, violations, corrections });
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
