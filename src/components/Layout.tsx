import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { steps, BRAND } from '../content';
import { stepPath } from '../routes';
import { navActive } from './navActive';
import { useProject } from '../store/project';
import { ThemeToggle } from './ThemeToggle';

/** 상단 내비: Project 6개 메뉴만 둔다. Learn 은 보조 링크이고, Learn 안에서만 하위 내비가 나타난다. */
export function Layout() {
  const { project } = useProject();
  const { pathname } = useLocation();
  const nav = navActive(pathname);
  const company = project.historicalData?.company;
  const inLearn = pathname.startsWith('/learn');

  // 라우트가 바뀌면 화면 맨 위로 이동한다.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="shell">
      <header className="topnav">
        <div className="topnav-row">
          <Link to="/dashboard" className="brand"><span className="logo" aria-hidden>V</span><span>{BRAND.name}</span></Link>
          <nav className="topnav-links" aria-label="메뉴">
            <NavLink to="/dashboard">Dashboard</NavLink>
            <NavLink to="/workspace">Workspace</NavLink>
            <NavLink to="/valuation" className={() => (nav.valuation ? 'active' : '')}>Valuation</NavLink>
            <NavLink to="/valuation/validation" className={() => (nav.analysis ? 'active' : '')}>Analysis</NavLink>
            <NavLink to="/ai">AI Analyst</NavLink>
            <NavLink to="/report">Report</NavLink>
          </nav>
          <div className="topnav-right">
            <Link to="/workspace" className={`company-chip${company ? ' on' : ''}`} title="Workspace 로 이동">
              <i aria-hidden />{company ? `${company.name} · ${company.ticker}` : '기업 미선택'}
            </Link>
            <Link to="/learn" className={`learn-link${inLearn ? ' active' : ''}`}>Learn</Link>
            <ThemeToggle />
          </div>
        </div>
        {inLearn ? (
          <nav className="subnav" aria-label="LEARN 메뉴">
            <NavLink to="/learn" end>Overview</NavLink>
            {steps.map((s) => <NavLink key={s.id} to={stepPath(s.id)} title={`${s.code} ${s.title}`}><span className="num">{String(s.id).padStart(2, '0')}</span> {s.short}</NavLink>)}
            <NavLink to="/learn/roadmap">Roadmap</NavLink>
            <NavLink to="/learn/report">Project Report</NavLink>
          </nav>
        ) : null}
      </header>
      <main className="main"><Outlet /></main>
      <footer className="demo-note">Public portfolio demo — AI and upload usage is rate-limited.</footer>
    </div>
  );
}
