// 테스트 전용: 기업 선택 전/후 화면(Dashboard · Valuation)을 서버 렌더링해서 데이터가 가려지는지 확인한다.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProjectProvider } from '../store/project';
import { Dashboard } from './Dashboard';
import { Valuation } from './Valuation';

export function renderGate(path: string, persistedProject: string | null): string {
  const store = { getItem: () => persistedProject, setItem: () => undefined, removeItem: () => undefined };
  (globalThis as { localStorage?: unknown }).localStorage = store;
  try {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={[path]}>
        <ProjectProvider>
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/valuation/:stage?" element={<Valuation />} />
          </Routes>
        </ProjectProvider>
      </MemoryRouter>,
    );
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
}
