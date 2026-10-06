import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { StateProvider } from './store/state';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Valuation } from './pages/Valuation';
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

// 이전 URL(/step/…) 북마크 호환
function LegacyStepRedirect() {
  const { '*': rest } = useParams();
  return <Navigate to={`/learn/step/${rest ?? ''}`} replace />;
}

export default function App() {
  return (
    <StateProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="workspace" element={<PlannedPage eyebrow="Workspace" title="Workspace" comingIn="STEP 06 · Financial Data Pipeline" description="기업 선택과 원천 재무데이터 확인 영역입니다." items={['Company Header', 'Overview / Income Statement / Balance Sheet / Cash Flow / Historical Analysis 탭', 'Historical Financial Table (A = Actual)']} />} />
            <Route path="valuation" element={<Valuation />} />
            <Route path="valuation/:stage" element={<Valuation />} />
            <Route path="analysis" element={<PlannedPage eyebrow="Analysis" title="Analysis" comingIn="MVP 2 · Analysis" description="DCF 결과를 다른 관점으로 검증하는 영역입니다." items={['Comparable Companies', 'Sensitivity Matrix', 'Scenario (Bear / Base / Bull)']} />} />
            <Route path="ai" element={<PlannedPage eyebrow="AI Analyst" title="AI Analyst" comingIn="STEP 08 · AI Valuation Analyst" description="계산은 Valuation Engine 이 하고, AI 는 Tool 로 호출해 근거 있는 답변을 합니다." items={['Financial Data Tool', 'Valuation Engine Tool', 'Sensitivity Tool', 'RAG Search']} />} />
            <Route path="report" element={<PlannedPage eyebrow="Report" title="Report" comingIn="STEP 09 · Report Automation" description="가치평가 보고서 생성과 내보내기 영역입니다." items={['Generate Report', 'Report Preview', 'Export PDF']} />} />

            <Route path="learn">
              <Route index element={<LearnHome />} />
              <Route path="roadmap" element={<Roadmap />} />
              <Route path="report" element={<ProjectReport />} />
              <Route path="step/:stepId" element={<StepOverview />} />
              <Route path="step/:stepId/lesson/:lessonId" element={<LessonPage />} />
              <Route path="step/:stepId/quiz" element={<QuizPage />} />
              <Route path="step/:stepId/practice" element={<PracticePage />} />
              <Route path="step/:stepId/build" element={<BuildPage />} />
              <Route path="step/:stepId/reflection" element={<ReflectionPage />} />
            </Route>

            <Route path="step/*" element={<LegacyStepRedirect />} />
            <Route path="roadmap" element={<Navigate to="/learn/roadmap" replace />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </StateProvider>
  );
}
