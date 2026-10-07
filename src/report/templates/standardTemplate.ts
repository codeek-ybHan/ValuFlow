// 기본 Valuation Report template. section 의 순서 · 제목 · 필수 여부 · 가시성 · 번호 · layout 힌트만 가진다 (숫자 · 문장은 ReportModel).
// 향후 valuation-summary · valuation-detailed · deal-team-internal 같은 template 을 같은 형식으로 추가한다.
import type { ReportTemplate, SectionTemplate } from './types.ts';

const S = (order: number, s: Omit<SectionTemplate, 'order'>): SectionTemplate => ({ ...s, order });

export const valuationStandardV1: ReportTemplate = {
  id: 'valuation-standard-v1',
  name: 'Valuation Report (Standard)',
  version: '1.0',
  sections: [
    S(1, { sectionId: 'cover', title: 'Cover', required: true, visibility: 'always', numbering: 'none', layout: { kind: 'cover' } }),
    S(2, { sectionId: 'executiveSummary', title: 'Executive Summary', required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'summary', pageBreakBefore: true } }),
    S(3, { sectionId: 'companyOverview', title: 'Company Overview', required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'key-value' } }),
    S(4, { sectionId: 'historicalPerformance', title: 'Historical Financial Performance', required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'table', pageBreakBefore: true } }),
    S(5, { sectionId: 'forecast', title: 'Forecast Assumptions', required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'table' } }),
    S(6, { sectionId: 'wacc', title: 'WACC', required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'key-value' } }),
    S(7, { sectionId: 'dcf', title: 'DCF Valuation', required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'table', pageBreakBefore: true } }),
    S(8, { sectionId: 'sensitivity', title: 'Sensitivity Analysis', required: false, visibility: 'when-available', numbering: 'decimal', layout: { kind: 'matrix' } }),
    S(9, { sectionId: 'scenario', title: 'Scenario Analysis', required: false, visibility: 'when-available', numbering: 'decimal', layout: { kind: 'columns', columns: 3 } }),
    S(10, { sectionId: 'relativeValuation', title: 'Relative Valuation', required: false, visibility: 'when-available', numbering: 'decimal', layout: { kind: 'table' } }),
    S(11, { sectionId: 'marketReference', title: 'Market & Peer Reference', required: false, visibility: 'when-available', numbering: 'decimal', layout: { kind: 'table' } }),
    S(12, { sectionId: 'keyRisks', title: 'Key Risks / Considerations', required: false, visibility: 'when-available', numbering: 'decimal', layout: { kind: 'list' } }),
    S(13, { sectionId: 'conclusion', title: 'Conclusion', required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'narrative' } }),
    S(14, { sectionId: 'sources', title: 'Sources', required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'sources', pageBreakBefore: true } }),
    S(15, { sectionId: 'appendix', title: 'Appendix', required: true, visibility: 'always', numbering: 'appendix', layout: { kind: 'appendix' } }),
  ],
};

export const TEMPLATES: Record<string, ReportTemplate> = { [valuationStandardV1.id]: valuationStandardV1 };
export const DEFAULT_TEMPLATE_ID = valuationStandardV1.id;

export const getTemplate = (id: string): ReportTemplate | null => TEMPLATES[id] ?? null;
