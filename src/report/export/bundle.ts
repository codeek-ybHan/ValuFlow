// Report export bundle: JSON snapshot(재현 · audit 용). 같은 snapshot 의 ReportModel · Document · Presentation 과 RenderModel 해시를 함께 담는다.
import { hashOf } from '../hash.ts';
import type { ReportModel } from '../model.ts';
import type { Presentation } from '../presentation/types.ts';
import type { RenderModel } from '../render/types.ts';
import type { ReportDocument } from '../templates/types.ts';

export const BUNDLE_SCHEMA = 'valuflow-report-bundle' as const;

export interface ReportBundle {
  schema: typeof BUNDLE_SCHEMA;
  bundleVersion: '1.0';
  reportId: string;
  createdAt: string;
  snapshot: ReportModel['metadata']['snapshot'];
  /** RenderModel 의 해시: Preview / PDF 가 같은 snapshot 에서 나왔는지 대조한다 */
  renderHash: string;
  model: ReportModel;
  document: ReportDocument;
  presentation: Presentation;
}

export const renderHashOf = (rm: RenderModel): string => hashOf(rm);

export function buildBundle(model: ReportModel, document: ReportDocument, presentation: Presentation, rm: RenderModel): ReportBundle {
  return { schema: BUNDLE_SCHEMA, bundleVersion: '1.0', reportId: model.metadata.reportId, createdAt: model.metadata.createdAt, snapshot: model.metadata.snapshot, renderHash: renderHashOf(rm), model, document, presentation };
}

export type ParsedBundle = { ok: true; bundle: ReportBundle } | { ok: false; reason: 'invalid-json' | 'not-a-bundle' | 'unsupported-version' };
export function parseBundle(json: string): ParsedBundle {
  let v: Partial<ReportBundle> | null;
  try { v = JSON.parse(json); } catch { return { ok: false, reason: 'invalid-json' }; }
  if (!v || v.schema !== BUNDLE_SCHEMA) return { ok: false, reason: 'not-a-bundle' };
  if (v.bundleVersion !== '1.0') return { ok: false, reason: 'unsupported-version' };
  return { ok: true, bundle: v as ReportBundle };
}
