import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { buildAiContext } from '../ai/context.ts';
import { snapshotId } from '../ai/agent/run.ts';
import { buildReportInput } from '../report/input.ts';
import { generateReport } from '../report/pipeline.ts';
import { requestPdf } from '../report/export/pdfClient.ts';
import { renderReportHtml } from '../report/render/html.ts';
import { analysisChoices, defaultAnalysisId, downloadNames, isReportStale, type AnalysisChoice, type PdfStatus, type ReportView } from '../report/ui/model.ts';
import type { SectionId } from '../report/templates/types.ts';
import type { ReportValidation } from '../report/validation/validate.ts';
import { useAnalyst } from './analyst';
import { useProject } from './project';

// Report Workspace 상태: Project 상태와 분리되어 있고 Project 를 바꾸지 않는다 (읽기 전용). 생성한 Report 는 그 시점의 snapshot 이다.

export interface ReportInitial { generated?: ReportView | null; blocked?: ReportValidation | null; pdf?: PdfStatus; selectedAnalysisId?: string | null; touched?: boolean; hideOptional?: SectionId[] }

interface Ctx {
  generated: ReportView | null;
  blocked: ReportValidation | null;
  choices: AnalysisChoice[];
  /** 사용자가 고른 AI 분석 (null = AI 서술 없음). 고르지 않았으면 같은 snapshot 의 최근 Deep Analysis 를 기본으로 쓴다 */
  selectedAnalysisId: string | null;
  hideOptional: SectionId[];
  currentSnapshotId: string;
  stale: boolean;
  pdf: PdfStatus;
  select: (id: string | null) => void;
  toggleSection: (id: SectionId) => void;
  generate: () => void;
  downloadPdf: () => Promise<void>;
  downloadHtml: () => void;
  downloadJson: () => void;
}
const ReportCtx = createContext<Ctx | null>(null);

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportProvider({ children, initial = {}, pdfBaseUrl }: { children: ReactNode; initial?: ReportInitial; pdfBaseUrl?: string }) {
  const { project, historicalStatus } = useProject();
  const { session } = useAnalyst();
  const [generated, setGenerated] = useState<ReportView | null>(initial.generated ?? null);
  const [blocked, setBlocked] = useState<ReportValidation | null>(initial.blocked ?? null);
  const [pdf, setPdf] = useState<PdfStatus>(initial.pdf ?? { status: 'idle' });
  const [picked, setPicked] = useState<{ touched: boolean; id: string | null }>({ touched: initial.touched ?? false, id: initial.selectedAnalysisId ?? null });
  const [hideOptional, setHide] = useState<SectionId[]>(initial.hideOptional ?? []);

  const currentSnapshotId = useMemo(() => snapshotId(buildAiContext(project, { historicalStatus })), [project, historicalStatus]);
  const choices = useMemo(() => analysisChoices(session.turns, currentSnapshotId), [session.turns, currentSnapshotId]);
  const selectedAnalysisId = picked.touched ? picked.id : defaultAnalysisId(choices);

  const generate = useCallback(() => {
    const choice = choices.find((c) => c.id === selectedAnalysisId) ?? null;
    const input = buildReportInput(project, { historicalStatus, aiAnalysis: choice?.analysis ?? null });   // 현재 Project 상태 그대로 (fixture 로 채우지 않는다)
    const r = generateReport(input, { hideOptional });
    setPdf({ status: 'idle' });
    if (r.status === 'blocked') { setBlocked(r.validation); setGenerated(null); return; }
    setBlocked(null);
    setGenerated({ result: r, analysisId: choice?.id ?? null, hideOptional: [...hideOptional], generatedAt: new Date().toISOString() });
  }, [project, historicalStatus, choices, selectedAnalysisId, hideOptional]);

  const downloadPdf = useCallback(async () => {
    if (!generated) return;
    setPdf({ status: 'generating' });
    const rm = generated.result.renderModel;   // Preview 와 같은 RenderModel
    const r = await requestPdf(rm, { baseUrl: pdfBaseUrl });
    if (!r.ok) { setPdf({ status: 'error', code: r.code, message: r.message }); return; }
    saveBlob(r.blob, r.filename);
    setPdf({ status: 'ready', filename: r.filename, pages: r.pages, font: r.font, reportId: generated.result.model.metadata.reportId });
  }, [generated, pdfBaseUrl]);

  const downloadHtml = useCallback(() => {
    if (!generated) return;
    saveBlob(new Blob([renderReportHtml(generated.result.renderModel, { mode: 'document' })], { type: 'text/html;charset=utf-8' }), downloadNames(generated.result.renderModel.meta.filename).html);
  }, [generated]);
  const downloadJson = useCallback(() => {
    if (!generated) return;
    saveBlob(new Blob([JSON.stringify(generated.result.bundle)], { type: 'application/json' }), downloadNames(generated.result.renderModel.meta.filename).json);
  }, [generated]);

  const value = useMemo<Ctx>(() => ({
    generated, blocked, choices, selectedAnalysisId, hideOptional, currentSnapshotId, stale: isReportStale(generated?.result.model.metadata.snapshot.contextSnapshotId ?? null, currentSnapshotId), pdf,
    select: (id) => setPicked({ touched: true, id }), toggleSection: (id) => setHide((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id])), generate, downloadPdf, downloadHtml, downloadJson,
  }), [generated, blocked, choices, selectedAnalysisId, hideOptional, currentSnapshotId, pdf, generate, downloadPdf, downloadHtml, downloadJson]);
  return <ReportCtx.Provider value={value}>{children}</ReportCtx.Provider>;
}

export function useReport() {
  const c = useContext(ReportCtx);
  if (!c) throw new Error('ReportProvider 가 필요합니다.');
  return c;
}
