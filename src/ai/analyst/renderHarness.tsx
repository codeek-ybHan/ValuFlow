// 테스트 전용: AI Analyst 화면을 서버 렌더링(정적 HTML)해서 화면에 실제로 나오는 문구를 검증한다 (browser 없이 React 렌더링을 확인).
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ProjectProvider } from '../../store/project';
import { AnalystProvider } from '../../store/analyst';
import { AiAnalyst } from '../../pages/AiAnalyst';
import { KnowledgePanel } from '../../components/analyst/KnowledgePanel';
import { defaultKnowledgeClient, type KnowledgeDocument } from '../../data/repository/knowledgeRepository';
import type { AnalystSession } from './session';

/** 테스트용 선택 기업. 저장된 Project 에 선택 기업이 없으면 넣어 준다 (기업을 선택하기 전에는 화면이 빈 상태이므로). `noCompany` 로 빈 상태를 재현한다. */
const TEST_COMPANY = { corpCode: '00126380', corpName: '삼성전자', corpNameEng: 'SAMSUNG ELECTRONICS CO.,LTD', stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: '2026-10-08T00:00:00Z' };
function withCompany(json: string | null, noCompany?: boolean): string | null {
  if (noCompany) return json;
  const o = json ? JSON.parse(json) : {};
  return JSON.stringify(o.selectedCompany ? o : { ...o, selectedCompany: TEST_COMPANY });
}

export function renderPage(persistedProject: string | null, session: AnalystSession | undefined, path = '/ai', opts: { noCompany?: boolean } = {}): string {
  const injected = withCompany(persistedProject, opts.noCompany);
  const store = { getItem: () => injected, setItem: () => undefined, removeItem: () => undefined };
  (globalThis as { localStorage?: unknown }).localStorage = store;
  try {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={[path]}><ProjectProvider><AnalystProvider initial={session}><AiAnalyst /></AnalystProvider></ProjectProvider></MemoryRouter>,
    );
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
}

export function renderKnowledge(documents: KnowledgeDocument[] | null, error: string | null = null): string {
  return renderToStaticMarkup(<KnowledgePanel kn={{ documents, error, reload: async () => undefined, client: defaultKnowledgeClient, setDocuments: () => undefined }} />);
}
