// External API 의 경계. 프론트는 OpenDART URL 도 API Key 도 모른다: ValuFlow backend(/api/...)만 호출한다.
import type { DartCompanyQuery } from './company.ts';
import type { DartFinancialsRequest } from './financials.ts';
import type { DartCompanyDetail, DartCompanySummary, DartErrorCode, DartRawAccount } from './types.ts';

export interface DartClient {
  searchCompanies(query: DartCompanyQuery): Promise<DartCompanySummary[]>;
  getCompany(corpCode: string): Promise<DartCompanyDetail>;
  /** STEP 06-3 에서 구현. 그 전에는 DartNotImplementedError 를 던진다. */
  fetchFinancials(request: DartFinancialsRequest): Promise<DartRawAccount[]>;
}

/** backend 가 오류를 돌려줬거나 backend 에 닿지 못했을 때. message 는 사용자에게 보여 줘도 되는 정제된 문구다. */
export class DartClientError extends Error {
  readonly code: DartErrorCode;
  readonly status: number | null;
  constructor(code: DartErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'DartClientError';
    this.code = code;
    this.status = status;
  }
}

export class DartNotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} 은(는) STEP 06-3 에서 구현됩니다.`);
    this.name = 'DartNotImplementedError';
  }
}

type FetchFn = (input: string, init?: { method?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const CODES: readonly DartErrorCode[] = ['invalid-key', 'no-data', 'rate-limit', 'dart-unavailable', 'invalid-request', 'unknown'];

/** backend 를 호출하는 구현. fetch 와 baseUrl 은 테스트에서 바꿔 끼울 수 있다. */
export class BackendDartClient implements DartClient {
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;

  constructor(options: { fetch?: FetchFn; baseUrl?: string } = {}) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? '';
  }

  private async request<T>(path: string): Promise<T> {
    let res;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`);
    } catch {
      throw new DartClientError('backend-unreachable', 'ValuFlow backend 에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.');
    }
    let body: unknown = null;
    try { body = await res.json(); } catch { /* JSON 이 아니면 아래에서 unknown 처리 */ }
    if (!res.ok) {
      const err = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      const code = CODES.find((c) => c === err?.code) ?? 'unknown';
      throw new DartClientError(code, typeof err?.message === 'string' ? err.message : '알 수 없는 오류가 발생했습니다.', res.status);
    }
    if (body === null || typeof body !== 'object') throw new DartClientError('unknown', '서버 응답을 해석할 수 없습니다.', res.status);
    return body as T;
  }

  async searchCompanies(query: DartCompanyQuery): Promise<DartCompanySummary[]> {
    const q = query.query.trim();
    if (q === '') return [];
    const params = new URLSearchParams({ q });
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const body = await this.request<{ items?: DartCompanySummary[] }>(`/api/companies?${params.toString()}`);
    return Array.isArray(body.items) ? body.items : [];
  }

  getCompany(corpCode: string): Promise<DartCompanyDetail> {
    return this.request<DartCompanyDetail>(`/api/companies/${encodeURIComponent(corpCode)}`);
  }

  fetchFinancials(): Promise<DartRawAccount[]> {
    return Promise.reject(new DartNotImplementedError('재무제표 수집'));
  }
}
