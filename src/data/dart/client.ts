// External API 의 경계. 프론트는 OpenDART URL 도 API Key 도 모른다: ValuFlow backend(/api/...)만 호출한다.
import type { DartCompanyQuery } from './company.ts';
import type { DartFinancialsRequest, DartHistoricalRequest } from './financials.ts';
import type { DartCompanyDetail, DartCompanySummary, DartErrorCode, DartFinancialsResponse, DartHistoricalResponse, DartRawAccount } from './types.ts';

export interface DartClient {
  searchCompanies(query: DartCompanyQuery): Promise<DartCompanySummary[]>;
  getCompany(corpCode: string): Promise<DartCompanyDetail>;
  fetchFinancials(request: DartFinancialsRequest): Promise<DartFinancialsResponse>;
  /** backend 가 정규화(+DB 저장)한 Historical. 프론트에서 다시 정규화하지 않는다. */
  getHistorical(request: DartHistoricalRequest): Promise<DartHistoricalResponse>;
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

type FetchFn = (input: string, init?: { method?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const STATEMENTS = ['BS', 'IS', 'CIS', 'CF', 'SCE'];
/** 형식이 맞는 행만 통과시킨다. 금액은 숫자 또는 null (빈 값을 0 으로 만들지 않는다). */
function isRawAccount(v: unknown): v is DartRawAccount {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return typeof a.accountName === 'string' && STATEMENTS.includes(a.statementType as string) && (a.basis === 'Consolidated' || a.basis === 'Separate')
    && typeof a.fiscalYear === 'number' && (a.amount === null || (typeof a.amount === 'number' && Number.isFinite(a.amount))) && typeof a.raw === 'object' && a.raw !== null;
}

/** 배포 환경의 API 주소 (data/http.ts 와 같은 규칙. dart/ 는 상위 계층을 import 하지 않으므로 여기에 둔다). 공개 조회만 하므로 access key 는 보내지 않는다. */
function deployedApiBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

const CODES: readonly DartErrorCode[] = ['invalid-key', 'no-data', 'rate-limit', 'dart-unavailable', 'invalid-request', 'unknown'];

/** backend 를 호출하는 구현. fetch 와 baseUrl 은 테스트에서 바꿔 끼울 수 있다. */
export class BackendDartClient implements DartClient {
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;

  constructor(options: { fetch?: FetchFn; baseUrl?: string } = {}) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(`${deployedApiBase()}${input}`, init));
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
    if (!res.ok && res.status >= 500 && !(body as { error?: unknown } | null)?.error) {
      // 개발 proxy / 게이트웨이가 backend 에 닿지 못한 경우 (JSON 오류 본문이 없다)
      throw new DartClientError('backend-unreachable', 'ValuFlow backend 에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.', res.status);
    }
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

  async getHistorical(request: DartHistoricalRequest): Promise<DartHistoricalResponse> {
    const params = new URLSearchParams({ years: [...request.years].sort((a, b) => a - b).join(','), basis: request.basis ?? 'auto' });
    if (request.refresh) params.set('refresh', 'true');
    const body = await this.request<Partial<DartHistoricalResponse>>(`/api/companies/${encodeURIComponent(request.corpCode)}/historical?${params.toString()}`);
    if ((body.status !== 'ok' && body.status !== 'unsupported' && body.status !== 'incomplete') || !body.quality || !body.fetch || typeof body.fetchedAt !== 'string') {
      throw new DartClientError('unknown', '서버 응답을 해석할 수 없습니다.');
    }
    if (body.status === 'ok' && !body.data) throw new DartClientError('unknown', '서버 응답을 해석할 수 없습니다.');
    return body as DartHistoricalResponse;
  }

  /** Raw 재무제표 행을 가져온다 (사업보고서 기준). 값은 어떤 기본값으로도 채우지 않는다. */
  async fetchFinancials(request: DartFinancialsRequest): Promise<DartFinancialsResponse> {
    const params = new URLSearchParams({ years: [...request.years].sort((a, b) => a - b).join(','), basis: request.basis ?? 'auto' });
    if (request.refresh) params.set('refresh', 'true');
    const body = await this.request<Partial<DartFinancialsResponse> & { accounts?: unknown }>(`/api/companies/${encodeURIComponent(request.corpCode)}/financials?${params.toString()}`);
    if (!Array.isArray(body.accounts) || !body.quality || typeof body.fetchedAt !== 'string') throw new DartClientError('unknown', '서버 응답을 해석할 수 없습니다.');
    const accounts = body.accounts.filter(isRawAccount);
    const dropped = body.accounts.length - accounts.length;
    const quality = dropped > 0 ? { ...body.quality, warnings: [...body.quality.warnings, `${dropped} malformed account row(s) dropped`] } : body.quality;
    return { corpCode: body.corpCode ?? request.corpCode, accounts, quality, source: 'OpenDART', fetchedAt: body.fetchedAt, cached: body.cached === true };
  }
}
