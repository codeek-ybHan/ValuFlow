import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { steps, BRAND } from '../content';
import { useApp } from '../store/state';
import { nextAction, overallProgress, stepProgress } from '../store/progress';
import { ProgressBar, fmtPct } from './ui';
import { ThemeToggle } from './ThemeToggle';
import { IconAi, IconAnalysis, IconDashboard, IconLearn, IconReport, IconRoadmap, IconValuation, IconWorkspace } from './Icons';

// Learn 영역에 노출하는 학습 STEP. STEP 05~ 는 학습이 아니라 제품 개발 로드맵으로 재정의된다.
const LEARN_STEP_MAX = 4;

function crumb(path: string): string {
  const m = path.match(/^\/learn\/step\/(\d+)/);
  if (m) {
    const s = steps.find((x) => x.id === Number(m[1]));
    return s ? `Learn · ${s.code} · ${s.title}` : 'Learn';
  }
  if (path.startsWith('/learn/roadmap')) return 'Learn · Roadmap';
  if (path.startsWith('/learn/report')) return 'Learn · Project Report';
  if (path.startsWith('/learn')) return 'Learn';
  if (path.startsWith('/workspace')) return 'Workspace';
  if (path.startsWith('/valuation')) return 'Valuation';
  if (path.startsWith('/analysis')) return 'Analysis';
  if (path.startsWith('/ai')) return 'AI Analyst';
  if (path.startsWith('/report')) return 'Report';
  return 'Dashboard';
}

export function Layout() {
  const { state } = useApp();
  const { pathname } = useLocation();
  const overall = overallProgress(steps, state);
  const next = nextAction(steps, state);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/dashboard" className="brand"><span className="logo" aria-hidden>V</span><span>{BRAND.name}</span></Link>
        <nav className="side-nav" aria-label="주요 메뉴">
          <NavLink to="/dashboard"><IconDashboard />Dashboard</NavLink>
          <NavLink to="/workspace"><IconWorkspace />Workspace</NavLink>
          <NavLink to="/valuation"><IconValuation />Valuation</NavLink>
          <NavLink to="/analysis"><IconAnalysis />Analysis</NavLink>
          <NavLink to="/ai"><IconAi />AI Analyst</NavLink>
          <NavLink to="/report"><IconReport />Report</NavLink>
        </nav>
        <div className="side-label">Learn</div>
        <nav className="side-nav side-steps" aria-label="Learn 메뉴">
          <NavLink to="/learn" end><IconLearn />Learn Home</NavLink>
          {steps.filter((s) => s.id <= LEARN_STEP_MAX).map((s) => {
            const st = stepProgress(s, state).status;
            return (
              <NavLink key={s.id} to={`/learn/step/${s.id}`} title={`${s.code} ${s.title}`}>
                <span className="step-no num">{String(s.id).padStart(2, '0')}</span>
                <span className="step-name">{s.short}</span>
                <span className={`dot dot-${st.toLowerCase().replace(/\s+/g, '-')}`} role="img" aria-label={st} />
              </NavLink>
            );
          })}
          <NavLink to="/learn/roadmap"><IconRoadmap />Roadmap</NavLink>
          <NavLink to="/learn/report"><IconReport />Project Report</NavLink>
        </nav>
        <div className="side-bottom">
        <ThemeToggle />
        <div className="side-card">
          <div className="small muted">Overall Progress</div>
          <div className="side-pct num">{fmtPct(overall.ratio, 0)}</div>
          <ProgressBar ratio={overall.ratio} label="전체 진행률" />
          <Link className="btn primary block" to={next.to}>이어서 학습</Link>
        </div>
        </div>
      </aside>
      <div className="content">
        <header className="topbar"><span className="crumb">{crumb(pathname)}</span></header>
        <main className="main"><Outlet /></main>
      </div>
    </div>
  );
}
