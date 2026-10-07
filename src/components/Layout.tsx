import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { steps, BRAND } from '../content';
import { stepPath } from '../routes';
import { navActive } from './navActive';
import { useApp } from '../store/state';
import { useProject } from '../store/project';
import { nextAction, overallProgress, stepProgress } from '../store/progress';
import { ProgressBar, fmtPct } from './ui';
import { ThemeToggle } from './ThemeToggle';
import { IconAi, IconAnalysis, IconDashboard, IconLearn, IconMenu, IconReport, IconRoadmap, IconValuation, IconWorkspace } from './Icons';

interface Crumb { area: string; page: string }

function crumb(path: string): Crumb {
  const m = path.match(/^\/learn\/step-(\d+)/);
  if (m) {
    const s = steps.find((x) => x.id === Number(m[1]));
    return { area: 'Learn', page: s ? `${s.code} · ${s.title}` : 'Learn' };
  }
  if (path.startsWith('/learn/roadmap')) return { area: 'Learn', page: 'Roadmap' };
  if (path.startsWith('/learn/report')) return { area: 'Learn', page: 'Project Report' };
  if (path.startsWith('/learn')) return { area: 'Learn', page: 'Overview' };
  if (path.startsWith('/workspace')) return { area: 'Project', page: 'Workspace' };
  if (path.startsWith('/valuation')) return { area: 'Project', page: 'Valuation' };
  if (path === '/valuation/validation' || path.startsWith('/analysis')) return { area: 'Project', page: 'Analysis · Validation' };
  if (path.startsWith('/ai')) return { area: 'Project', page: 'AI Analyst' };
  if (path.startsWith('/report')) return { area: 'Project', page: 'Report' };
  return { area: 'Project', page: 'Dashboard' };
}

export function Layout() {
  const { state } = useApp();
  const { project } = useProject();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const overall = overallProgress(steps, state);
  const next = nextAction(steps, state);
  const c = crumb(pathname);
  const nav = navActive(pathname);
  const company = project.historicalData?.company;

  // 라우트가 바뀌면 모바일 드로어를 닫고 화면 맨 위로 이동한다.
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={`shell${open ? ' nav-open' : ''}`}>
      <aside className="sidebar" id="sidebar" aria-label="사이드바">
        <Link to="/dashboard" className="brand"><span className="logo" aria-hidden>V</span><span>{BRAND.name}</span></Link>

        <div className="side-label">Project</div>
        <nav className="side-nav" aria-label="PROJECT 메뉴">
          <NavLink to="/dashboard"><IconDashboard />Dashboard</NavLink>
          <NavLink to="/workspace"><IconWorkspace />Workspace</NavLink>
          <NavLink to="/valuation" className={() => (nav.valuation ? 'active' : '')}><IconValuation />Valuation</NavLink>
          <NavLink to="/valuation/validation" className={() => (nav.analysis ? 'active' : '')}><IconAnalysis />Analysis</NavLink>
          <NavLink to="/ai"><IconAi />AI Analyst</NavLink>
          <NavLink to="/report"><IconReport />Report</NavLink>
        </nav>

        <div className="side-label">Learn</div>
        <nav className="side-nav" aria-label="LEARN 메뉴">
          <NavLink to="/learn" end><IconLearn />Overview</NavLink>
          {steps.map((s) => {
            const st = stepProgress(s, state).status;
            return (
              <NavLink key={s.id} to={stepPath(s.id)} title={`${s.code} ${s.title}`}>
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
          <div className="side-card">
            <div className="small">Learn Progress</div>
            <div className="side-pct num">{fmtPct(overall.ratio, 0)}</div>
            <ProgressBar ratio={overall.ratio} label="Learn 진행률" />
            <Link className="btn primary block" to={next.to}>이어서 학습</Link>
          </div>
        </div>
      </aside>

      {open && <button className="scrim" aria-label="메뉴 닫기" onClick={() => setOpen(false)} />}

      <div className="content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-btn" aria-label="메뉴 열기" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen((v) => !v)}><IconMenu /></button>
            <div className="crumb" aria-label="현재 위치">
              <span className="crumb-area">{c.area}</span>
              <span className="crumb-sep" aria-hidden>/</span>
              <span className="crumb-page">{c.page}</span>
            </div>
          </div>
          <div className="topbar-right">
            <Link to="/workspace" className={`company-chip${company ? ' on' : ''}`} title="Workspace 로 이동">
              <i aria-hidden />{company ? `${company.name} · ${company.ticker}` : '기업 미선택'}
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main className="main"><Outlet /></main>
      </div>
    </div>
  );
}
