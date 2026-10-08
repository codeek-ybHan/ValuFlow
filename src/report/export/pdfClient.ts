// PDF Export client: RenderModel(Preview 와 같은 객체)을 backend(/api/report/pdf)에 보내 PDF 를 받는다. 값은 backend 가 계산하지 않고 표시 문자열을 그대로 그린다.
import type { RenderModel } from '../render/types.ts';
import { apiFetch } from '../../data/http.ts';

export type PdfResult =
  | { ok: true; blob: Blob; filename: string; pages: number | null; font: string | null }
  | { ok: false; code: string; message: string };

type FetchFn = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; blob(): Promise<Blob>; json(): Promise<unknown> }>;

/** 오류 코드 → 사용자 문구 (원문 오류 · 내부 메시지를 그대로 보이지 않는다). */
export const PDF_ERROR_TEXT: Record<string, string> = {
  'rate-limited': 'Demo PDF 내보내기 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
  'payload-too-large': 'Report 가 너무 커서 PDF 로 만들 수 없습니다.',
  'backend-unreachable': 'ValuFlow 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인한 뒤 다시 시도하세요.',
  'pdf-render-failed': 'PDF 를 만들지 못했습니다. 잠시 후 다시 시도하세요.',
  'render-model-too-large': 'Report 가 너무 커서 PDF 로 만들 수 없습니다.',
  'unsupported-render-model': '서버가 이 Report 형식을 지원하지 않습니다. 앱을 새로고침한 뒤 다시 시도하세요.',
  'invalid-render-model': 'Report 데이터 형식이 올바르지 않습니다. Report 를 다시 생성하세요.',
  unknown: 'PDF 를 만들지 못했습니다.',
};

export async function requestPdf(rm: RenderModel, options: { fetch?: FetchFn; baseUrl?: string } = {}): Promise<PdfResult> {
  const f: FetchFn = options.fetch ?? ((input, init) => apiFetch(input, init) as never);
  let res;
  try { res = await f(`${options.baseUrl ?? ''}/api/report/pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rm) }); }
  catch { return { ok: false, code: 'backend-unreachable', message: PDF_ERROR_TEXT['backend-unreachable']! }; }
  if (!res.ok) {
    let code = res.status >= 500 ? 'pdf-render-failed' : 'unknown';
    try { const j = (await res.json()) as { error?: { code?: unknown } }; if (typeof j.error?.code === 'string') code = j.error.code; } catch { if (res.status >= 502) code = 'backend-unreachable'; }
    return { ok: false, code, message: PDF_ERROR_TEXT[code] ?? PDF_ERROR_TEXT.unknown! };
  }
  const blob = await res.blob();
  const pages = Number(res.headers.get('x-report-pages'));
  return { ok: true, blob, filename: rm.meta.filename, pages: Number.isFinite(pages) && pages > 0 ? pages : null, font: res.headers.get('x-report-font') };
}
