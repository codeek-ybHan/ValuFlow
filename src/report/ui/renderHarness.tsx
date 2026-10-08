// 테스트 전용: Report 화면을 서버 렌더링(정적 HTML)해 화면에 나오는 문구를 검증한다.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ProjectProvider } from '../../store/project';
import { AnalystProvider } from '../../store/analyst';
import { ReportProvider, type ReportInitial } from '../../store/report';
import { ReportPage } from '../../pages/ReportPage';
import { PersistenceClient } from '../../data/persist/client.ts';
import { buildReportInput, type AiAnalysisInput } from '../input.ts';
import { generateReport } from '../pipeline.ts';
import { restoreProjectState } from '../../store/projectModel.ts';
import type { AnalystSession } from '../../ai/analyst/session';
import type { PdfStatus } from './model.ts';

export type HarnessOptions = { session?: AnalystSession; ai?: AiAnalysisInput | null; generated?: boolean; blocked?: boolean; pdf?: PdfStatus; selected?: string | null; touched?: boolean; hideOptional?: string[]; staleSnapshot?: boolean; saved?: ReportInitial['saved']; admin?: boolean; noCompany?: boolean };

/** 테스트용 선택 기업. 저장된 Project 에 선택 기업이 없으면 넣어 준다 (기업을 선택하기 전에는 화면이 빈 상태이므로). `noCompany` 로 빈 상태를 재현한다. */
const TEST_COMPANY = { corpCode: '00126380', corpName: '삼성전자', corpNameEng: 'SAMSUNG ELECTRONICS CO.,LTD', stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: '2026-10-08T00:00:00Z' };
function withCompany(json: string | null, noCompany?: boolean): string | null {
  if (noCompany) return json;
  const o = json ? JSON.parse(json) : {};
  return JSON.stringify(o.selectedCompany ? o : { ...o, selectedCompany: TEST_COMPANY });
}

export function renderReport(persistedProject: string | null, o: HarnessOptions = {}): string {
  const injected = withCompany(persistedProject, o.noCompany);
  const store = { getItem: () => injected, setItem: () => undefined, removeItem: () => undefined };
  (globalThis as { localStorage?: unknown }).localStorage = store;
  try {
    const initial: ReportInitial = { pdf: o.pdf, selectedAnalysisId: o.selected ?? null, touched: o.touched, saved: o.saved, hideOptional: (o.hideOptional ?? []) as never };
    if (o.generated || o.blocked) {
      const project = injected ? restoreProjectState(JSON.parse(injected)) : restoreProjectState({});
      const r = generateReport(buildReportInput(project, { aiAnalysis: o.ai ?? null, now: () => new Date('2026-10-08T01:02:03Z') }), { hideOptional: (o.hideOptional ?? []) as never });
      if (r.status === 'ok') {
        if (o.staleSnapshot) r.model.metadata.snapshot.contextSnapshotId = 'ctx-old00000';
        initial.generated = { result: r, analysisId: null, hideOptional: [], generatedAt: '2026-10-08T01:02:03Z' };
      } else initial.blocked = r.validation;
    }
    // 공개 화면은 저장소를 쓰지 않는다(null). 관리자 저장소를 켠 화면만 `admin`(또는 saved 초기값)으로 재현한다 — 네트워크는 호출하지 않는다.
    const admin = o.admin || o.saved !== undefined ? new PersistenceClient({ fetch: async () => ({ ok: false, status: 503, json: async () => null }) }) : null;
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={['/report']}><ProjectProvider><AnalystProvider initial={o.session} persistence={null}><ReportProvider initial={initial} persistence={admin}><ReportPage /></ReportProvider></AnalystProvider></ProjectProvider></MemoryRouter>,
    );
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
}
