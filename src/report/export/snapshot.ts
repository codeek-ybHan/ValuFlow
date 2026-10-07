// Report snapshot 직렬화: schemaVersion 으로 형식을 구분한다. Renderer(PDF · HTML 등)는 STEP 09-2 이후이며, 여기서는 snapshot 의 보존 · 복원만 한다.
import { REPORT_SCHEMA_VERSION } from '../types.ts';
import type { ReportModel } from '../model.ts';

export function serializeReport(model: ReportModel): string {
  return JSON.stringify(model);
}

export type ParsedReport = { ok: true; model: ReportModel } | { ok: false; reason: 'invalid-json' | 'unsupported-schema'; schemaVersion?: string };

/** 저장된 snapshot 을 복원한다. 알 수 없는 schemaVersion 은 현재 형식으로 해석하지 않는다. */
export function parseReport(json: string): ParsedReport {
  let v: unknown;
  try { v = JSON.parse(json); } catch { return { ok: false, reason: 'invalid-json' }; }
  const ver = (v as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (ver !== REPORT_SCHEMA_VERSION) return { ok: false, reason: 'unsupported-schema', schemaVersion: typeof ver === 'string' ? ver : undefined };
  return { ok: true, model: v as ReportModel };
}
