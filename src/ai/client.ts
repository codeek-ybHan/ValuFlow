// backend AI Gateway(FastAPI) 호출 client. LLM API Key 는 backend 에만 있고, 이 파일은 /api/ai 만 부른다.
import type { AiAnalystAnswer } from './answer.ts';
import type { ToolResult } from './tools/result.ts';

export interface AiQueryRequest {
  question: string;
  /** 수치를 담지 않는 가벼운 context 요약 (전체 ProjectState 를 보내지 않는다) */
  minimalContext: Record<string, unknown>;
  toolNames: string[];
  /** routing hint (기록용). 모델의 Tool 선택을 대체하지 않는다 */
  classification?: Record<string, unknown>;
}

export interface AiToolResultRequest {
  conversationId: string;
  state: string;
  callId: string;
  toolResult: ToolResult<unknown>;
}

export interface ToolCallResponse { status: 'tool-call'; conversationId: string; state: string; callId: string; tool: string; input: Record<string, unknown>; toolCalls: number }
/** gateway 가 이 질문에서 실행한 Tool 의 순서와 실행 위치 (frontend Tool 의 status 는 'requested', 결과는 frontend 가 안다). */
export interface ToolTraceEntry {
  tool: string; runtime: 'frontend' | 'backend' | 'gateway'; status: string;
  /** 검색 Tool 의 audit 정보 (문서 id · source type · 건수). 문서 본문은 담지 않는다. */
  documentIds?: string[]; sourceTypes?: string[]; retrievalCount?: number; rerankedCount?: number;
}
export interface FinalResponse { status: 'final'; conversationId: string; answer: AiAnalystAnswer; toolCalls: number; toolTrace?: ToolTraceEntry[]; backendToolResults?: ToolResult<unknown>[] }
export interface ToolLimitResponse { status: 'tool-limit'; conversationId: string; toolCalls: number; message: string; toolTrace?: ToolTraceEntry[]; backendToolResults?: ToolResult<unknown>[] }
export type GatewayResponse = ToolCallResponse | FinalResponse | ToolLimitResponse;

export interface AiGatewayClient {
  query(request: AiQueryRequest): Promise<GatewayResponse>;
  sendToolResult(request: AiToolResultRequest): Promise<GatewayResponse>;
}

export class AiClientError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = 'AiClientError';
    this.code = code;
    this.status = status;
  }
}

type FetchFn = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class BackendAiClient implements AiGatewayClient {
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;
  constructor(options: { fetch?: FetchFn; baseUrl?: string } = {}) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? '';
  }

  private async post(path: string, body: unknown): Promise<GatewayResponse> {
    let res;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new AiClientError('backend-unreachable', 'ValuFlow backend 에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.');
    }
    let json: unknown = null;
    try { json = await res.json(); } catch { /* JSON 이 아니면 아래에서 처리 */ }
    if (!res.ok) {
      const err = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      if (res.status >= 500 && !err) throw new AiClientError('backend-unreachable', 'ValuFlow backend 에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.', res.status);
      throw new AiClientError(typeof err?.code === 'string' ? err.code : 'unknown', typeof err?.message === 'string' ? err.message : '알 수 없는 오류가 발생했습니다.', res.status);
    }
    const r = json as Partial<GatewayResponse> | null;
    const known = r && (r.status === 'tool-call' || r.status === 'final' || r.status === 'tool-limit') && typeof r.conversationId === 'string';
    if (!known) throw new AiClientError('invalid-response', '서버 응답을 해석할 수 없습니다.', res.status);
    if (r.status === 'tool-call' && !(typeof (r as ToolCallResponse).callId === 'string' && typeof (r as ToolCallResponse).tool === 'string' && typeof (r as ToolCallResponse).state === 'string')) throw new AiClientError('invalid-response', '서버 응답을 해석할 수 없습니다.', res.status);
    if (r.status === 'final' && !(r as FinalResponse).answer) throw new AiClientError('invalid-response', '서버 응답을 해석할 수 없습니다.', res.status);
    return r as GatewayResponse;
  }

  query(request: AiQueryRequest): Promise<GatewayResponse> {
    return this.post('/api/ai/query', request);
  }

  sendToolResult(request: AiToolResultRequest): Promise<GatewayResponse> {
    return this.post('/api/ai/tool-result', request);
  }
}
