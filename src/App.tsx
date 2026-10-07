import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { StateProvider } from './store/state';
import { ProjectProvider } from './store/project';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Valuation } from './pages/Valuation';
import { Workspace } from './pages/Workspace';
import { PlannedPage } from './pages/PlannedPage';
import { LearnHome } from './pages/LearnHome';
import { Roadmap } from './pages/Roadmap';
import { StepOverview } from './pages/StepOverview';
import { LessonPage } from './pages/LessonPage';
import { QuizPage } from './pages/QuizPage';
import { PracticePage } from './pages/PracticePage';
import { BuildPage } from './pages/BuildPage';
import { ReflectionPage } from './pages/ReflectionPage';
import { ProjectReport } from './pages/ProjectReport';
import { NotFound } from './pages/NotFound';
import { stepPath } from './routes';

// 이전 URL 북마크 호환: /step/2/lesson/l01, /learn/step/2/... → /learn/step-02/...
function LegacyStepRedirect() {
  const { '*': rest = '' } = useParams();
  const [id, ...tail] = rest.split('/');
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return <Navigate to="/learn" replace />;
  return <Navigate to={[stepPath(n), ...tail].filter(Boolean).join('/')} replace />;
}

export default function App() {
  return (
    <StateProvider>
      <ProjectProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="workspace" element={<Workspace />} />
            <Route path="valuation" element={<Valuation />} />
            <Route path="valuation/:stage" element={<Valuation />} />
            <Route path="analysis" element={<Navigate to="/valuation/validation" replace />} />
            <Route path="ai" element={<PlannedPage eyebrow="AI Analyst" title="AI Analyst" comingIn="STEP 08 · AI Valuation Analyst" description="계산은 Valuation Engine 이 하고, AI 는 Tool 로 호출해 근거 있는 답변을 합니다." items={['Financial Data Tool', 'Valuation Engine Tool', 'Sensitivity Tool', 'RAG Search']} />} />
            <Route path="report" element={<PlannedPage eyebrow="Report" title="Report" comingIn="STEP 09 · Report Automation" description="가치평가 보고서 생성과 내보내기 영역입니다." items={['Generate Report', 'Report Preview', 'Export PDF']} />} />

            <Route path="learn">
              <Route index element={<LearnHome />} />
              <Route path="roadmap" element={<Roadmap />} />
              <Route path="report" element={<ProjectReport />} />
              <Route path="step/*" element={<LegacyStepRedirect />} />
              <Route path=":stepId" element={<StepOverview />} />
              <Route path=":stepId/lesson/:lessonId" element={<LessonPage />} />
              <Route path=":stepId/quiz" element={<QuizPage />} />
              <Route path=":stepId/practice" element={<PracticePage />} />
              <Route path=":stepId/build" element={<BuildPage />} />
              <Route path=":stepId/reflection" element={<ReflectionPage />} />
            </Route>

            <Route path="step/*" element={<LegacyStepRedirect />} />
            <Route path="roadmap" element={<Navigate to="/learn/roadmap" replace />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
      </ProjectProvider>
    </StateProvider>
  );
}
