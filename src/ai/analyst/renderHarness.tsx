// 테스트 전용: AI Analyst 화면을 서버 렌더링(정적 HTML)해서 화면에 실제로 나오는 문구를 검증한다 (browser 없이 React 렌더링을 확인).
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ProjectProvider } from '../../store/project';
import { AnalystProvider } from '../../store/analyst';
import { AiAnalyst } from '../../pages/AiAnalyst';
import { KnowledgePanel } from '../../components/analyst/KnowledgePanel';
import { defaultKnowledgeClient, type KnowledgeDocument } from '../../data/repository/knowledgeRepository';
import type { AnalystSession } from './session';

export function renderPage(persistedProject: string | null, session: AnalystSession | undefined, path = '/ai'): string {
  const store = { getItem: () => persistedProject, setItem: () => undefined, removeItem: () => undefined };
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
