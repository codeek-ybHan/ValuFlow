import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { steps, BRAND } from '../content';
import { useApp } from '../store/state';
import { nextAction, overallProgress, stepProgress } from '../store/progress';
import { ProgressBar, fmtPct } from './ui';
import { ThemeToggle } from './ThemeToggle';
import { IconDashboard, IconReport, IconRoadmap } from './Icons';

function crumb(path: string): string {
  const m = path.match(/^\/step\/(\d+)/);
  if (m) {
    const s = steps.find((x) => x.id === Number(m[1]));
    return s ? `${s.code} · ${s.title}` : 'STEP';
  }
  if (path.startsWith('/roadmap')) return 'Roadmap';
  if (path.startsWith('/report')) return 'Project Report';
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
        <Link to="/" className="brand"><span className="logo" aria-hidden>V</span><span>{BRAND.name}</span></Link>
        <nav className="side-nav" aria-label="주요 메뉴">
          <NavLink to="/" end><IconDashboard />Dashboard</NavLink>
          <NavLink to="/roadmap"><IconRoadmap />Roadmap</NavLink>
          <NavLink to="/report"><IconReport />Project Report</NavLink>
        </nav>
        <div className="side-label">Learning Steps</div>
        <nav className="side-nav side-steps" aria-label="STEP 목록">
          {steps.map((s) => {
            const st = stepProgress(s, state).status;
            return (
              <NavLink key={s.id} to={`/step/${s.id}`} title={`${s.code} ${s.title}`}>
                <span className="step-no num">{String(s.id).padStart(2, '0')}</span>
                <span className="step-name">{s.short}</span>
                <span className={`dot dot-${st.toLowerCase().replace(/\s+/g, '-')}`} role="img" aria-label={st} />
              </NavLink>
            );
          })}
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
