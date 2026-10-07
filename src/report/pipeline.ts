// Report 생성 파이프라인 한 번에: ReportInput → validation → ReportModel → Template → Presentation → RenderModel → HTML / Bundle.
// UI(Preview)와 Export 는 이 결과의 같은 객체를 쓴다 (Preview 전용 계산 없음).
import { buildReport } from './buildReport.ts';
import { buildBundle, type ReportBundle } from './export/bundle.ts';
import type { ReportInput } from './input.ts';
import type { ReportModel } from './model.ts';
import { buildPresentation } from './presentation/buildPresentation.ts';
import type { Presentation } from './presentation/types.ts';
import { buildRenderModel } from './render/buildRenderModel.ts';
import { renderReportHtml } from './render/html.ts';
import type { RenderModel } from './render/types.ts';
import { buildReportDocument } from './templates/buildDocument.ts';
import { valuationStandardV1 } from './templates/standardTemplate.ts';
import type { ReportDocument, ReportTemplate, SectionId } from './templates/types.ts';
import type { ReportValidation } from './validation/validate.ts';

/** 선택 section 만 숨길 수 있다. 필수 section 은 무시한다 (무시한 id 를 돌려준다). */
export function withHiddenOptionalSections(template: ReportTemplate, hide: SectionId[]): { template: ReportTemplate; ignored: SectionId[] } {
  const optional = new Set(template.sections.filter((s) => !s.required).map((s) => s.sectionId));
  const ignored = hide.filter((id) => !optional.has(id));
  const hidden = new Set(hide.filter((id) => optional.has(id)));
  return { template: { ...template, sections: template.sections.map((s) => (hidden.has(s.sectionId) ? { ...s, visibility: 'never' as const } : s)) }, ignored };
}

export interface GenerateOptions { template?: ReportTemplate; hideOptional?: SectionId[]; reportId?: string; now?: () => number }

export type GenerateResult =
  | { status: 'blocked'; validation: ReportValidation }
  | {
    status: 'ok'; validation: ReportValidation; input: ReportInput; model: ReportModel; document: ReportDocument; presentation: Presentation; renderModel: RenderModel;
    /** Preview 에 넣는 HTML 본문 (fragment) */
    html: string; bundle: ReportBundle; ignoredHide: SectionId[];
    /** 단계별 소요 시간(ms): 기록용이며 성능 보장이 아니다 */
    timings: { buildModel: number; document: number; presentation: number; renderModel: number; html: number; total: number };
  };

export type GenerateOk = Extract<GenerateResult, { status: 'ok' }>;

export function generateReport(input: ReportInput, options: GenerateOptions = {}): GenerateResult {
  const clock = options.now ?? (() => performance.now());
  const t0 = clock();
  const built = buildReport(input, { reportId: options.reportId });
  const t1 = clock();
  if (built.status === 'blocked') return { status: 'blocked', validation: built.validation };
  const { template, ignored } = withHiddenOptionalSections(options.template ?? valuationStandardV1, options.hideOptional ?? []);
  const document = buildReportDocument(built.model, template);
  const t2 = clock();
  const presentation = buildPresentation(document);
  const t3 = clock();
  const renderModel = buildRenderModel(document, presentation);
  const t4 = clock();
  const html = renderReportHtml(renderModel, { mode: 'fragment' });
  const t5 = clock();
  return {
    status: 'ok', validation: built.validation, input, model: built.model, document, presentation, renderModel, html, bundle: buildBundle(built.model, document, presentation, renderModel), ignoredHide: ignored,
    timings: { buildModel: t1 - t0, document: t2 - t1, presentation: t3 - t2, renderModel: t4 - t3, html: t5 - t4, total: t5 - t0 },
  };
}
