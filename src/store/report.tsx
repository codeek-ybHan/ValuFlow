import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PERSIST_NOTE, defaultPersistence, type PersistenceClient, type PersistFailure, type SavedReportSummary, type SavedAnalysisSummary } from '../data/persist/client.ts';
import { buildAiContext } from '../ai/context.ts';
import { snapshotId } from '../ai/agent/run.ts';
import { buildReportInput } from '../report/input.ts';
import { generateReport, reopenReport } from '../report/pipeline.ts';
import { valuationStandardV1 } from '../report/templates/standardTemplate.ts';
import { requestPdf } from '../report/export/pdfClient.ts';
import { renderReportHtml } from '../report/render/html.ts';
import { analysisChoices, defaultAnalysisId, downloadNames, isReportStale, withSavedAnalyses, type AnalysisChoice, type PdfStatus, type ReportView } from '../report/ui/model.ts';
import type { SectionId } from '../report/templates/types.ts';
import type { ReportValidation } from '../report/validation/validate.ts';
import { useAnalyst } from './analyst';
import { useProject } from './project';

// Report Workspace 상태: Project 상태와 분리되어 있고 Project 를 바꾸지 않는다 (읽기 전용). 생성한 Report 는 그 시점의 snapshot 이다.

export interface ReportInitial { saved?: { analyses?: SavedAnalysisSummary[]; reports?: SavedReportSummary[]; note?: string | null }; generated?: ReportView | null; blocked?: ReportValidation | null; pdf?: PdfStatus; selectedAnalysisId?: string | null; touched?: boolean; hideOptional?: SectionId[] }

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
  /** 저장된 과거 Report 목록 · 저장소 상태 안내 (저장소가 없으면 이 세션에서만 유지) */
  savedReports: SavedReportSummary[];
  persistNote: string | null;
  /** 저장소(관리자 전용)를 쓰는 화면인가. 공개 화면은 false 이며 Saved reports 를 보이지 않는다. */
  persistenceEnabled: boolean;
  opening: boolean;
  openSaved: (reportId: string) => Promise<void>;
  select: (id: string | null) => void;
  toggleSection: (id: SectionId) => void;
  generate: () => Promise<void>;
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

export function ReportProvider({ children, initial = {}, pdfBaseUrl, persistence }: { children: ReactNode; initial?: ReportInitial; pdfBaseUrl?: string; persistence?: PersistenceClient | null }) {
  const { project, historicalStatus } = useProject();
  const { session } = useAnalyst();
  const [generated, setGenerated] = useState<ReportView | null>(initial.generated ?? null);
  const [blocked, setBlocked] = useState<ReportValidation | null>(initial.blocked ?? null);
  const [pdf, setPdf] = useState<PdfStatus>(initial.pdf ?? { status: 'idle' });
  const [picked, setPicked] = useState<{ touched: boolean; id: string | null }>({ touched: initial.touched ?? false, id: initial.selectedAnalysisId ?? null });
  const [hideOptional, setHide] = useState<SectionId[]>(initial.hideOptional ?? []);
  const store = useMemo(() => (persistence === undefined ? defaultPersistence() : persistence), [persistence]);   // 공개 화면 기본은 null (세션 메모리만)
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysisSummary[]>(initial.saved?.analyses ?? []);
  const [savedReports, setSavedReports] = useState<SavedReportSummary[]>(initial.saved?.reports ?? []);
  const [persistNote, setPersistNote] = useState<string | null>(initial.saved?.note ?? null);
  const [opening, setOpening] = useState(false);
  const corpCode = project.selectedCompany?.corpCode ?? project.historicalProvenance?.corpCode ?? null;
  const note = (reason: PersistFailure) => setPersistNote(PERSIST_NOTE[reason]);

  // 새로고침 뒤에도 저장된 분석 · Report 를 불러온다 (저장소가 없으면 조용히 이 세션 메모리만 쓴다)
  const reload = useCallback(async () => {
    if (!store || !corpCode) return;
    const [a, r] = await Promise.all([store.listAnalyses(corpCode), store.listReports(corpCode)]);
    if (a.ok) setSavedAnalyses(a.value); else note(a.reason);
    if (r.ok) setSavedReports(r.value);
    if (a.ok && r.ok) setPersistNote(null);
  }, [store, corpCode]);
  useEffect(() => { void reload(); }, [reload]);

  const currentSnapshotId = useMemo(() => snapshotId(buildAiContext(project, { historicalStatus })), [project, historicalStatus]);
  const choices = useMemo(() => withSavedAnalyses(analysisChoices(session.turns, currentSnapshotId), savedAnalyses, currentSnapshotId), [session.turns, currentSnapshotId, savedAnalyses]);
  const selectedAnalysisId = picked.touched ? picked.id : defaultAnalysisId(choices);

  const generate = useCallback(async () => {
    const choice = choices.find((c) => c.id === selectedAnalysisId) ?? null;
    let analysis = choice?.analysis ?? null;
    if (choice && !analysis && store) {   // 저장된 분석은 선택해서 생성할 때 불러온다
      const got = await store.getAnalysis(choice.id);
      if (got.ok) analysis = got.value; else note(got.reason);
    }
    const input = buildReportInput(project, { historicalStatus, aiAnalysis: analysis });   // 현재 Project 상태 그대로 (fixture 로 채우지 않는다)
    const r = generateReport(input, { hideOptional });
    setPdf({ status: 'idle' });
    if (r.status === 'blocked') { setBlocked(r.validation); setGenerated(null); return; }
    setBlocked(null);
    setGenerated({ result: r, analysisId: analysis ? choice?.id ?? null : null, hideOptional: [...hideOptional], generatedAt: new Date().toISOString() });
    if (store) {   // 생성한 Report 의 snapshot 을 저장해 과거 Report 를 다시 열 수 있게 한다 (실패해도 Preview · Export 는 그대로)
      const saved = await store.saveReport(r.model, `${valuationStandardV1.id}@${valuationStandardV1.version}`);
      if (saved.ok) void reload(); else note(saved.reason);
    }
  }, [project, historicalStatus, choices, selectedAnalysisId, hideOptional, store, reload]);

  const openSaved = useCallback(async (reportId: string) => {
    if (!store) return;
    setOpening(true);
    const got = await store.getReport(reportId);
    setOpening(false);
    if (!got.ok) { note(got.reason); return; }
    setBlocked(null);
    setPdf({ status: 'idle' });
    setGenerated({ result: reopenReport(got.value), analysisId: null, hideOptional: [], generatedAt: got.value.metadata.createdAt });   // 저장된 값 그대로 (Project 를 읽지 않는다)
  }, [store]);

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
    savedReports, persistNote, opening, openSaved, persistenceEnabled: store !== null,
    select: (id) => setPicked({ touched: true, id }), toggleSection: (id) => setHide((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id])), generate, downloadPdf, downloadHtml, downloadJson,
  }), [generated, blocked, choices, selectedAnalysisId, hideOptional, currentSnapshotId, pdf, savedReports, persistNote, opening, openSaved, store, generate, downloadPdf, downloadHtml, downloadJson]);
  return <ReportCtx.Provider value={value}>{children}</ReportCtx.Provider>;
}

export function useReport() {
  const c = useContext(ReportCtx);
  if (!c) throw new Error('ReportProvider 가 필요합니다.');
  return c;
}
