// ReportModel + ReportTemplate → ReportDocument. section 의 순서 · 제목 · 번호 · 가시성 · layout 힌트 · 상태 · footnote marker 를 확정한다.
// 이 함수는 숫자를 계산하거나 문장을 만들지 않는다 (모델의 Cell · narrative 를 section 구조로 옮기고 고지 · 상태만 붙인다).
import type { ReportModel } from '../model.ts';
import { buildFootnoteIndex, collectSourceIds, markersOf, sourceEntries } from './footnotes.ts';
import { collectMissing, LEARNING_TITLE, SECTION_REGISTRY, type ResolveContext } from './sectionRegistry.ts';
import { valuationStandardV1 } from './standardTemplate.ts';
import { SECTION_IDS, type MissingDataEntry, type ReportBanner, type ReportDocument, type ReportTemplate, type ResolvedSection, type SectionId, type SectionStatus } from './types.ts';

export class TemplateError extends Error {
  constructor(message: string) { super(message); this.name = 'TemplateError'; }
}

/** Template 정의 자체의 검증 (section id 중복 · 알 수 없는 id · order 중복 · 필수 section 을 숨기는 설정). */
export function validateTemplate(t: ReportTemplate): string[] {
  const issues: string[] = [];
  const ids = t.sections.map((s) => s.sectionId);
  for (const id of ids) if (!(SECTION_IDS as readonly string[]).includes(id)) issues.push(`알 수 없는 sectionId: ${id}`);
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) issues.push(`sectionId 중복: ${id}`);
  const orders = t.sections.map((s) => s.order);
  if (new Set(orders).size !== orders.length) issues.push('section order 가 중복되었습니다.');
  for (const s of t.sections) if (s.required && s.visibility === 'never') issues.push(`필수 section 을 숨길 수 없습니다: ${s.sectionId}`);
  if (!t.id || !t.version) issues.push('template id · version 이 필요합니다.');
  return issues;
}

export function buildReportDocument(model: ReportModel, template: ReportTemplate = valuationStandardV1): ReportDocument {
  const bad = validateTemplate(template);
  if (bad.length > 0) throw new TemplateError(`잘못된 template(${template.id}): ${bad.join('; ')}`);

  const ordered = [...template.sections].sort((a, b) => a.order - b.order);
  const ctx: ResolveContext = { template, missingData: [] };
  const hidden: ReportDocument['diagnostics']['hiddenSections'] = [];
  type Shown = { t: (typeof ordered)[number]; res: ReturnType<(typeof SECTION_REGISTRY)[SectionId]> };
  const shown = new Map<SectionId, Shown>();

  const resolve = (t: (typeof ordered)[number]) => {
    const res = (SECTION_REGISTRY[t.sectionId] as (m: ReportModel, c: ResolveContext) => Shown['res'])(model, ctx);
    if (t.visibility === 'never') { hidden.push({ sectionId: t.sectionId, title: t.title, reason: 'Template 이 이 section 을 사용하지 않습니다.' }); return; }
    if (res.availability.status !== 'ok' && t.visibility === 'when-available') { hidden.push({ sectionId: t.sectionId, title: t.title, reason: res.availability.reason }); return; }
    shown.set(t.sectionId, { t, res });
    if (res.content) ctx.missingData.push(...collectMissing(t.sectionId, res.content));
  };
  // 부록의 Missing Data 목록은 다른 section 을 모두 해석한 뒤에 만든다
  for (const t of ordered) if (t.sectionId !== 'appendix') resolve(t);
  const appendixT = ordered.find((t) => t.sectionId === 'appendix');
  if (appendixT) resolve(appendixT);

  // 숨겨진 section 에서만 쓰인 출처는 Sources 에서도 뺀다 (인용되지 않는 출처 0). 번호는 남은 출처로 S1.. 다시 매긴다.
  const usedIds = new Set<string>();
  for (const [id, s] of shown) if (id !== 'sources' && s.res.content) collectSourceIds(s.res.content, usedIds);
  const sources = model.sources.filter((x) => usedIds.has(x.id));
  const footnoteIndex = buildFootnoteIndex(sources);

  let n = 0;
  const sections: ResolvedSection[] = [];
  const status: Record<string, SectionStatus> = {};
  for (const t of ordered) {
    const s = shown.get(t.sectionId);
    if (!s) continue;
    const number = t.numbering === 'none' ? null : t.numbering === 'appendix' ? 'A' : String(++n);
    const avail = s.res.availability;
    const missing = s.res.content ? collectMissing(t.sectionId, s.res.content).filter((m) => m.state !== 'not-applicable') : [];
    const st: SectionStatus = avail.status !== 'ok' ? avail.status : s.res.notices.length > 0 || (missing.length > 0 && t.sectionId !== 'appendix') ? 'warning' : 'ok';
    const reason = avail.status !== 'ok' ? avail.reason : st === 'warning' ? s.res.notices[0] ?? `값이 없는 항목 ${missing.length}개가 있습니다 (부록 Missing Data 참고).` : null;
    status[t.sectionId] = st;
    sections.push({
      sectionId: t.sectionId, number, title: t.title, required: t.required, layout: t.layout, status: st, reason, notices: s.res.notices,
      sourceMarkers: t.sectionId === 'sources' || !s.res.content ? [] : markersOf(footnoteIndex, [...collectSourceIds(s.res.content)]),
      content: s.res.content,
    } as ResolvedSection);
  }

  const learning = model.metadata.dataBasis.assumptions === 'learning';
  const fixture = model.metadata.dataBasis.historical === 'fixture';
  const banners: ReportBanner[] = learning || fixture
    ? [{ id: 'learning-data', title: LEARNING_TITLE, text: [learning ? '가정이 STEP 04 학습용 가상값입니다.' : null, fixture ? 'Historical 이 학습용 fixture 입니다.' : null, '이 보고서는 학습 · 시연용이며 실제 가치평가 보고서가 아닙니다.'].filter(Boolean).join(' ') }]
    : [];

  return {
    documentVersion: '1.0',
    template: { id: template.id, name: template.name, version: template.version },
    metadata: model.metadata, banners, sections, sources: sourceEntries(sources, footnoteIndex), footnoteIndex,
    diagnostics: { hiddenSections: hidden, sectionStatus: status },
  };
}

export type { MissingDataEntry };
