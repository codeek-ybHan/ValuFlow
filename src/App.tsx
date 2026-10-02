import { HashRouter, Route, Routes } from 'react-router-dom';
import { StateProvider } from './store/state';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Roadmap } from './pages/Roadmap';
import { StepOverview } from './pages/StepOverview';
import { LessonPage } from './pages/LessonPage';
import { QuizPage } from './pages/QuizPage';
import { PracticePage } from './pages/PracticePage';
import { BuildPage } from './pages/BuildPage';
import { ReflectionPage } from './pages/ReflectionPage';
import { ProjectReport } from './pages/ProjectReport';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <StateProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="roadmap" element={<Roadmap />} />
            <Route path="step/:stepId" element={<StepOverview />} />
            <Route path="step/:stepId/lesson/:lessonId" element={<LessonPage />} />
            <Route path="step/:stepId/quiz" element={<QuizPage />} />
            <Route path="step/:stepId/practice" element={<PracticePage />} />
            <Route path="step/:stepId/build" element={<BuildPage />} />
            <Route path="step/:stepId/reflection" element={<ReflectionPage />} />
            <Route path="report" element={<ProjectReport />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </StateProvider>
  );
}
