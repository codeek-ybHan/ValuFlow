// Report Workspace(UI) 의 순수 로직: AI 분석 선택 · 신선도 · 검증 표시 · 내보내기 상태. React 를 모른다 (테스트 대상).
import type { AnalystTurn } from '../../ai/analyst/view.ts';
import type { AiAnalysisInput } from '../input.ts';
import type { GenerateResult } from '../pipeline.ts';
import type { SectionId } from '../templates/types.ts';
import type { ReportIssue, ReportValidation } from '../validation/validate.ts';

export interface AnalysisChoice {
  id: string;
  question: string;
  workflowLabel: string;
  askedAt: string;
  claims: number;
  supported: number;
  /** current: 현재 Project snapshot 과 같다 · stale: 이전 Project 상태 기준이라 Report 서술에 쓸 수 없다 */
  freshness: 'current' | 'stale';
  analysis: AiAnalysisInput;
}

/** Report 에 포함할 수 있는 Deep Analysis 목록 (최근 순). Quick Answer 와 실패한 분석은 제외한다. */
export function analysisChoices(turns: AnalystTurn[], currentSnapshotId: string): AnalysisChoice[] {
  return turns.filter((t) => t.analysis !== null).reverse().map((t) => ({
    id: t.id, question: t.question, workflowLabel: t.workflowLabel ?? 'Deep Analysis', askedAt: t.askedAt, claims: t.analysis!.claims.length, supported: t.analysis!.claims.filter((c) => c.status === 'supported').length,
    freshness: t.analysis!.contextSnapshotId === currentSnapshotId ? 'current' as const : 'stale' as const, analysis: t.analysis!,
  }));
}

/** 기본 선택: 같은 snapshot 의 가장 최근 Deep Analysis. stale 분석은 자동 선택하지 않는다. 없으면 null (AI 서술 없음). */
export const defaultAnalysisId = (choices: AnalysisChoice[]): string | null => choices.find((c) => c.freshness === 'current')?.id ?? null;

/** 생성된 Report 의 snapshot 이 현재 Project 와 다른가. */
export const isReportStale = (generatedSnapshotId: string | null, currentSnapshotId: string): boolean => generatedSnapshotId !== null && generatedSnapshotId !== currentSnapshotId;

export const OPTIONAL_SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'sensitivity', label: 'Sensitivity Analysis' }, { id: 'scenario', label: 'Scenario Analysis' }, { id: 'relativeValuation', label: 'Relative Valuation' },
  { id: 'marketReference', label: 'Market & Peer Reference' }, { id: 'keyRisks', label: 'Key Risks / Considerations' },
];

export interface ValidationMessage { severity: 'error' | 'warning'; code: string; text: string; /** 해결을 위해 이동할 화면 */ to: string | null; action: string | null }

const FIX: Record<string, { to: string; action: string }> = {
  'no-company': { to: '/workspace', action: 'Workspace 로 이동' }, 'no-historical': { to: '/workspace', action: 'Workspace 로 이동' }, 'unsupported-company': { to: '/workspace', action: 'Workspace 로 이동' },
  'no-assumptions': { to: '/valuation', action: 'Valuation 으로 이동' }, 'assumptions-incomplete': { to: '/valuation', action: 'Valuation 으로 이동' }, 'no-valuation-result': { to: '/valuation', action: 'Valuation 으로 이동' }, 'invalid-wacc-g': { to: '/valuation', action: 'Valuation 으로 이동' },
};

export function validationMessages(v: ReportValidation): ValidationMessage[] {
  const m = (severity: ValidationMessage['severity']) => (i: ReportIssue): ValidationMessage => ({ severity, code: i.code, text: i.message, to: FIX[i.code]?.to ?? null, action: FIX[i.code]?.action ?? null });
  return [...v.errors.map(m('error')), ...v.warnings.map(m('warning'))];
}

export type PdfStatus = { status: 'idle' } | { status: 'generating' } | { status: 'ready'; filename: string; pages: number | null; font: string | null; reportId: string } | { status: 'error'; code: string; message: string };

export interface ReportView {
  result: Extract<GenerateResult, { status: 'ok' }>;
  /** 생성에 쓴 선택: 재현 · 표시용 */
  analysisId: string | null;
  hideOptional: SectionId[];
  generatedAt: string;
}

export const downloadNames = (filename: string) => ({ pdf: filename, html: filename.replace(/\.pdf$/, '.html'), json: filename.replace(/\.pdf$/, '.json') });
