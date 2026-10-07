// 테스트 전용: Report 화면을 서버 렌더링(정적 HTML)해 화면에 나오는 문구를 검증한다.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ProjectProvider } from '../../store/project';
import { AnalystProvider } from '../../store/analyst';
import { ReportProvider, type ReportInitial } from '../../store/report';
import { ReportPage } from '../../pages/ReportPage';
import { buildReportInput, type AiAnalysisInput } from '../input.ts';
import { generateReport } from '../pipeline.ts';
import { restoreProjectState } from '../../store/projectModel.ts';
import type { AnalystSession } from '../../ai/analyst/session';
import type { PdfStatus } from './model.ts';

export type HarnessOptions = { session?: AnalystSession; ai?: AiAnalysisInput | null; generated?: boolean; blocked?: boolean; pdf?: PdfStatus; selected?: string | null; touched?: boolean; hideOptional?: string[]; staleSnapshot?: boolean; saved?: ReportInitial['saved'] };

export function renderReport(persistedProject: string | null, o: HarnessOptions = {}): string {
  const store = { getItem: () => persistedProject, setItem: () => undefined, removeItem: () => undefined };
  (globalThis as { localStorage?: unknown }).localStorage = store;
  try {
    const initial: ReportInitial = { pdf: o.pdf, selectedAnalysisId: o.selected ?? null, touched: o.touched, saved: o.saved, hideOptional: (o.hideOptional ?? []) as never };
    if (o.generated || o.blocked) {
      const project = persistedProject ? restoreProjectState(JSON.parse(persistedProject)) : restoreProjectState({});
      const r = generateReport(buildReportInput(project, { aiAnalysis: o.ai ?? null, now: () => new Date('2026-10-08T01:02:03Z') }), { hideOptional: (o.hideOptional ?? []) as never });
      if (r.status === 'ok') {
        if (o.staleSnapshot) r.model.metadata.snapshot.contextSnapshotId = 'ctx-old00000';
        initial.generated = { result: r, analysisId: null, hideOptional: [], generatedAt: '2026-10-08T01:02:03Z' };
      } else initial.blocked = r.validation;
    }
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={['/report']}><ProjectProvider><AnalystProvider initial={o.session} persistence={null}><ReportProvider initial={initial} persistence={null}><ReportPage /></ReportProvider></AnalystProvider></ProjectProvider></MemoryRouter>,
    );
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
}
