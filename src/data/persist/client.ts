// 검증된 AI 분석 · Report snapshot 의 저장/조회 client (backend /api/analyses · /api/report-snapshots). 저장은 best-effort 이고 실패해도 화면은 계속 동작한다 (이 세션 메모리만 쓴다).
import type { AiAnalysisInput } from '../../report/input.ts';
import type { ReportModel } from '../../report/model.ts';
import { apiFetch } from '../http.ts';

export type PersistFailure = 'unavailable' | 'access-required' | 'rate-limited' | 'too-large' | 'invalid' | 'not-found' | 'unreachable';
export type PersistResult<T> = { ok: true; value: T } | { ok: false; reason: PersistFailure };

export interface SavedAnalysisSummary { id: string; corpCode: string | null; companyName: string | null; contextSnapshotId: string; workflowType: string; question: string; createdAt: string; groundingSummary: { claims: number; supported: number; evidence: number } }
export interface SavedReportSummary { reportId: string; corpCode: string | null; companyName: string | null; contextSnapshotId: string; schemaVersion: string; templateVersion: string; createdAt: string }

type FetchFn = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const REASON: Record<string, PersistFailure> = { 'persistence-unavailable': 'unavailable', 'access-required': 'access-required', 'access-not-configured': 'access-required', 'rate-limited': 'rate-limited', 'payload-too-large': 'too-large', 'invalid-payload': 'invalid', 'not-found': 'not-found' };

export class PersistenceClient {
  private readonly fetchFn: FetchFn;
  constructor(options: { fetch?: FetchFn } = {}) { this.fetchFn = options.fetch ?? ((input, init) => apiFetch(input, init) as never); }

  private async call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<PersistResult<T>> {
    let res;
    try { res = await this.fetchFn(path, init?.body === undefined ? { method: init?.method } : { method: init?.method ?? 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }); }
    catch { return { ok: false, reason: 'unreachable' }; }
    let json: unknown = null;
    try { json = await res.json(); } catch { /* JSON 이 아니면 아래에서 처리 */ }
    if (!res.ok) {
      const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
      return { ok: false, reason: typeof code === 'string' && REASON[code] ? REASON[code]! : res.status === 404 ? 'not-found' : res.status === 503 ? 'unavailable' : 'unreachable' };
    }
    return { ok: true, value: json as T };
  }

  saveAnalysis(analysis: AiAnalysisInput, company: { corpCode: string | null; name: string | null }) {
    return this.call<{ id: string }>('/api/analyses', { body: { ...analysis, corpCode: company.corpCode, companyName: company.name } });
  }
  async listAnalyses(corpCode: string | null): Promise<PersistResult<SavedAnalysisSummary[]>> {
    const r = await this.call<{ items: SavedAnalysisSummary[] }>(`/api/analyses?limit=20${corpCode ? `&corpCode=${encodeURIComponent(corpCode)}` : ''}`);
    return r.ok ? { ok: true, value: Array.isArray(r.value.items) ? r.value.items : [] } : r;
  }
  async getAnalysis(id: string): Promise<PersistResult<AiAnalysisInput>> {
    const r = await this.call<{ analysis: AiAnalysisInput }>(`/api/analyses/${encodeURIComponent(id)}`);
    return r.ok ? (r.value.analysis?.groundingLevel === 'claim-evidence' ? { ok: true, value: r.value.analysis } : { ok: false, reason: 'invalid' }) : r;
  }
  saveReport(model: ReportModel, templateVersion: string) {
    return this.call<{ reportId: string }>('/api/report-snapshots', { body: { model, templateVersion } });
  }
  async listReports(corpCode: string | null): Promise<PersistResult<SavedReportSummary[]>> {
    const r = await this.call<{ items: SavedReportSummary[] }>(`/api/report-snapshots?limit=20${corpCode ? `&corpCode=${encodeURIComponent(corpCode)}` : ''}`);
    return r.ok ? { ok: true, value: Array.isArray(r.value.items) ? r.value.items : [] } : r;
  }
  async getReport(id: string): Promise<PersistResult<ReportModel>> {
    const r = await this.call<{ model: ReportModel }>(`/api/report-snapshots/${encodeURIComponent(id)}`);
    return r.ok ? (r.value.model?.schemaVersion === '1.0' && r.value.model.metadata ? { ok: true, value: r.value.model } : { ok: false, reason: 'invalid' }) : r;
  }
}

export const PERSIST_NOTE: Record<PersistFailure, string> = {
  unavailable: '서버에 저장소가 없어 이 세션에서만 유지됩니다.', 'access-required': '저장하려면 Access key 가 필요합니다. 이 세션에서만 유지됩니다.', 'rate-limited': '저장 요청이 많아 잠시 후 다시 시도됩니다.',
  'too-large': '데이터가 커서 저장하지 못했습니다.', invalid: '저장 형식이 올바르지 않습니다.', 'not-found': '저장된 항목을 찾을 수 없습니다.', unreachable: '서버에 연결할 수 없어 이 세션에서만 유지됩니다.',
};
