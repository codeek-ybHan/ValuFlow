// STEP 08-7: 사용자 PDF(Knowledge Documents) 관리 repository. AI 폴더 밖의 데이터 계층에 둔다 (네트워크 호출은 data repository 와 ai/client.ts 에만 있다).
// Knowledge Documents(사용자 PDF) 관리 client: 업로드 · 목록 · 삭제 · 재인덱싱. backend(/api/knowledge/documents)만 부른다.
import { apiFetch } from '../http.ts';

export type DocumentState = 'ready' | 'indexing' | 'failed' | 'already-exists';

export interface KnowledgeDocument {
  documentId: number;
  sourceType: 'opendart' | 'user-upload';
  title: string;
  documentType: string | null;
  /** 문서가 연결된 기업 (null 이면 기업에 연결되지 않은 일반 문서) */
  corpCode: string | null;
  corpName: string | null;
  businessYear: number | null;
  uploadedAt: string | null;
  filingDate: string | null;
  chunkCount: number;
  sectionCount: number | null;
  embeddingModel: string | null;
  originalFilename: string | null;
  state: DocumentState;
}

export class KnowledgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'KnowledgeError'; this.code = code; }
}

/** 오류 코드 → 사용자 문구 (원문 오류를 그대로 보이지 않는다). */
export const KNOWLEDGE_ERROR_TEXT: Record<string, string> = {
  'backend-unreachable': 'ValuFlow 서버에 연결할 수 없습니다.',
  'rate-limited': 'Demo PDF 업로드 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
  'access-required': '삭제와 재인덱싱은 관리자 전용 기능입니다.',
  'access-not-configured': '삭제와 재인덱싱은 관리자 전용 기능입니다.',
  'document-limit': '데모에 올릴 수 있는 문서 수 한도에 도달했습니다.',
  'payload-too-large': '파일이 너무 큽니다.',
  'ai-not-configured': '문서 검색이 설정되어 있지 않습니다. 서버의 데이터베이스와 AI 서비스 설정이 필요합니다.',
  'empty-file': '빈 파일입니다.',
  'file-too-large': '파일이 너무 큽니다.',
  'unsupported-file-type': 'PDF 파일만 올릴 수 있습니다.',
  'encrypted-pdf': '암호가 걸린 PDF 는 읽을 수 없습니다.',
  'invalid-pdf': '올바른 PDF 파일이 아닙니다.',
  'too-many-pages': 'PDF 페이지 수가 너무 많습니다.',
  'text-unavailable': '검색에 쓸 수 있는 텍스트가 없습니다 (스캔 이미지 PDF 일 수 있습니다).',
  'text-too-large': '문서의 텍스트 양이 너무 많습니다.',
  'invalid-metadata': '문서 정보 형식이 올바르지 않습니다.',
  'document-not-found': '문서를 찾을 수 없습니다.',
  'delete-forbidden': '이 브라우저에서 업로드한 문서만 삭제할 수 있습니다.',
};
export const knowledgeErrorText = (code: string) => KNOWLEDGE_ERROR_TEXT[code] ?? '문서를 처리하지 못했습니다. 잠시 후 다시 시도하세요.';

type Json = Record<string, unknown>;
type FetchFn = (input: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * 업로드한 PDF 의 삭제 토큰 보관소. 소유권 모델(계정)이 없어서, 업로드할 때 서버가 한 번만 돌려주는 토큰을 이 브라우저가 가지고 있어야 자기 문서를 지울 수 있다.
 * 토큰은 문서 id 별로 localStorage 에만 두고 서버에는 해시만 있다. 접근할 수 없는 환경이면 삭제 기능만 꺼진다.
 */
export interface DeleteTokenStore { get(documentId: number): string | null; set(documentId: number, token: string): void; remove(documentId: number): void }
const TOKENS_KEY = 'valuflow:upload-owner';
export const browserTokenStore: DeleteTokenStore = (() => {
  const read = (): Record<string, string> => { try { const v = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}'); return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  const write = (v: Record<string, string>) => { try { localStorage.setItem(TOKENS_KEY, JSON.stringify(v)); } catch { /* 저장 불가: 삭제 기능만 꺼진다 */ } };
  return {
    get: (id) => (typeof read()[String(id)] === 'string' ? read()[String(id)]! : null),
    set: (id, token) => write({ ...read(), [String(id)]: token }),
    remove: (id) => { const v = read(); delete v[String(id)]; write(v); },
  };
})();

export function toDocument(raw: Json, state?: DocumentState): KnowledgeDocument {
  const s = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : null);
  const n = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : null);
  const status = s('status');
  return {
    documentId: n('documentId') ?? -1, sourceType: raw.sourceType === 'opendart' ? 'opendart' : 'user-upload', title: s('title') ?? s('originalFilename') ?? '제목 없음', documentType: s('documentType'), corpCode: s('corpCode'), corpName: s('corpName'),
    businessYear: n('businessYear'), uploadedAt: s('uploadedAt'), filingDate: s('filingDate'), chunkCount: n('chunkCount') ?? 0, sectionCount: n('sectionCount'), embeddingModel: s('embeddingModel'), originalFilename: s('originalFilename'),
    state: state ?? (status === 'ready' ? 'ready' : status === 'failed' ? 'failed' : status ? 'indexing' : 'ready'),
  };
}

export class KnowledgeClient {
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;
  private readonly tokens: DeleteTokenStore;
  constructor(options: { fetch?: FetchFn; baseUrl?: string; tokens?: DeleteTokenStore } = {}) {
    this.fetchFn = options.fetch ?? ((input, init) => apiFetch(input, init));
    this.baseUrl = options.baseUrl ?? '';
    this.tokens = options.tokens ?? browserTokenStore;
  }

  /** 이 브라우저가 올린 문서인가 (삭제 토큰이 있다). 삭제 버튼은 이 문서에만 보인다. */
  canDelete(documentId: number): boolean { return this.tokens.get(documentId) !== null; }

  private async call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ json: Json; status: number }> {
    let res;
    try { res = await this.fetchFn(`${this.baseUrl}${path}`, init); } catch { throw new KnowledgeError('backend-unreachable', knowledgeErrorText('backend-unreachable')); }
    let json: unknown = null;
    try { json = await res.json(); } catch { /* 본문이 JSON 이 아니면 아래에서 처리 */ }
    if (!res.ok) {
      const err = (json as { error?: { code?: unknown } } | null)?.error;
      const code = typeof err?.code === 'string' ? err.code : res.status >= 500 ? 'backend-unreachable' : 'unknown';
      throw new KnowledgeError(code, knowledgeErrorText(code));
    }
    return { json: (json ?? {}) as Json, status: res.status };
  }

  /** 사용자가 올린 문서 목록 (OpenDART 공시는 제외). */
  async list(): Promise<KnowledgeDocument[]> {
    const { json } = await this.call('/api/knowledge/documents?sourceType=user-upload');
    return (Array.isArray(json.items) ? (json.items as Json[]) : []).map((d) => toDocument(d));
  }

  /** PDF 를 올린다. 같은 파일(SHA-256)이면 already-exists 상태로 기존 문서를 돌려준다. */
  async upload(file: File, meta: { title?: string } = {}): Promise<KnowledgeDocument> {
    const form = new FormData();
    form.append('file', file);
    if (meta.title?.trim()) form.append('title', meta.title.trim());
    const { json } = await this.call('/api/knowledge/documents', { method: 'POST', body: form });
    const doc = toDocument((json.document ?? {}) as Json, json.status === 'already-exists' ? 'already-exists' : 'ready');
    if (typeof json.deleteToken === 'string' && json.deleteToken && doc.documentId >= 0) this.tokens.set(doc.documentId, json.deleteToken);   // 업로드한 사람에게만 한 번 온다
    return doc;
  }

  /** 삭제: 이 브라우저가 업로드할 때 받은 토큰으로만 된다 (관리자는 API 로 직접). 지워졌거나 권한이 없으면 토큰을 버려 버튼이 사라진다. */
  async remove(documentId: number): Promise<void> {
    const token = this.tokens.get(documentId);
    try { await this.call(`/api/knowledge/documents/${documentId}`, { method: 'DELETE', ...(token ? { headers: { 'X-ValuFlow-Delete-Token': token } } : {}) }); }
    catch (e) { if (e instanceof KnowledgeError && (e.code === 'document-not-found' || e.code === 'delete-forbidden')) this.tokens.remove(documentId); throw e; }
    this.tokens.remove(documentId);
  }

  async reindex(documentId: number): Promise<KnowledgeDocument> {
    const { json } = await this.call(`/api/knowledge/documents/${documentId}/reindex`, { method: 'POST' });
    return toDocument((json.document ?? {}) as Json);
  }
}

export const defaultKnowledgeClient = new KnowledgeClient();

/**
 * 현재 기업 범위에서 검색 가능한 업로드 문서 수: 현재 기업에 연결된 문서 + 기업에 연결되지 않은 일반 문서. 다른 기업에 연결된 문서는 세지 않는다
 * (backend 검색도 같은 범위로 고정된다). 목록을 못 받으면 null (모름: 질문을 막지 않는다).
 */
export async function countSearchableUploads(corpCode: string | null, client: Pick<KnowledgeClient, 'list'> = defaultKnowledgeClient): Promise<number | null> {
  try {
    const docs = await client.list();
    return docs.filter((d) => d.sourceType === 'user-upload' && d.state !== 'failed' && (d.corpCode === null || d.corpCode === corpCode)).length;
  } catch { return null; }
}
