export { valuationStandardV1, TEMPLATES, DEFAULT_TEMPLATE_ID, getTemplate } from './standardTemplate.ts';
export { buildReportDocument, validateTemplate, TemplateError } from './buildDocument.ts';
export { SECTION_REGISTRY, LEARNING_TITLE } from './sectionRegistry.ts';
export { buildFootnoteIndex, markersOf, markerText, sourceEntries, collectSourceIds } from './footnotes.ts';
export { SECTION_IDS } from './types.ts';
export type { ReportTemplate, SectionTemplate, SectionId, SectionContentMap, ResolvedSection, ReportDocument, ReportBanner, SourceEntry, SectionStatus, Visibility, LayoutHint } from './types.ts';
