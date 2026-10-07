// Report 공개 API (STEP 09-1). Project State → ReportInput → ReportModel → (Renderer / Export, STEP 09-2)
export { buildReportInput, aiAnalysisFromWorkflow } from './input.ts';
export type { ReportInput, AiAnalysisInput, ReportSnapshotInfo, BuildReportInputOptions } from './input.ts';
export { buildReport } from './buildReport.ts';
export type { ReportBuildResult, BuildReportOptions } from './buildReport.ts';
export { validateReportInput } from './validation/validate.ts';
export type { ReportValidation, ReportIssue } from './validation/validate.ts';
export { serializeReport, parseReport } from './export/snapshot.ts';
export type { ReportModel } from './model.ts';
export { REPORT_SCHEMA_VERSION } from './types.ts';
export type { Cell, DataKind, CellState, SourceRef, Narrative, NarrativeItem } from './types.ts';
export { REPORT_UNIT_POLICY } from './units.ts';
