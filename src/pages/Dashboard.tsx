import { Link } from 'react-router-dom';
import { BRAND } from '../content';
import { steps } from '../content';
import { useApp } from '../store/state';
import { overallProgress } from '../store/progress';
import { StatusBadge, fmtPct } from '../components/ui';
import { dashboardWorkflow } from '../valuation/workflow';
import { projectRoadmap } from '../content/roadmap';

// Engine / 데이터 파이프라인 연결 전이므로 수치는 '—' 로 두고 가짜 결과를 만들지 않는다.
const snapshot = ['Enterprise Value', 'Equity Value', 'Implied Share Price', 'WACC'];
const assumptions = ['WACC', 'Terminal Growth', 'Forecast Period'];

export function Dashboard() {
  const { state } = useApp();
  const learn = overallProgress(steps, state);
  return (
    <>
      <section className="hero">
        <h1 className="hero-title">From Financial Statements<br />to AI-powered Valuation.</h1>
        <p className="hero-sub">Financial analysis, DCF valuation, and AI-assisted insights in one workflow.</p>
        <div className="row hero-cta">
          <Link className="btn primary" to="/valuation">Start Valuation</Link>
          <Link className="btn" to="/workspace">Continue Workspace</Link>
        </div>
      </section>

      <section className="dash-grid">
        <div className="panel">
          <div className="panel-head"><h3>Current Company</h3><span className="badge badge-not-started">NOT SELECTED</span></div>
          <p className="step-title">선택된 기업 없음</p>
          <p className="small muted">기업 선택과 재무데이터는 Data Pipeline 단계에서 연결됩니다.</p>
          <Link className="btn" to="/workspace">Open Workspace</Link>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Valuation Snapshot</h3><span className="small muted">KRW · Billion</span></div>
          <dl className="stat-dl">{snapshot.map((k) => <div key={k}><dt>{k}</dt><dd className="num">—</dd></div>)}</dl>
          <p className="small muted">Valuation Engine(STEP 05) 연결 후 표시됩니다.</p>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Core Assumptions</h3></div>
          <dl className="stat-dl">{assumptions.map((k) => <div key={k}><dt>{k}</dt><dd className="num">—</dd></div>)}</dl>
          <Link className="small" to="/valuation/forecast">가정 입력하기 →</Link>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Workflow Progress</h3></div>
        <ol className="wf-list">
          {dashboardWorkflow.map((w) => (
            <li key={w.no}>
              <Link to={w.to} className="wf-row">
                <span className="num muted">{w.no}</span><span>{w.label}</span><StatusBadge label="NOT STARTED" />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>PROJECT Roadmap</h3><span className="small muted">STEP 05~10 · 구현 순서</span></div>
        <div className="evo-table" role="table">
          {projectRoadmap.map((r) => (
            <div key={r.code} className="evo-row" role="row">
              <span className="evo-step"><strong>{r.code}</strong>{r.title}</span>
              <span>{r.summary}</span>
              <StatusBadge label={r.status} />
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Learn</h3><span className="small muted">{BRAND.name} 학습 콘텐츠 · 전체 진행률 {fmtPct(learn.ratio, 0)}</span></div>
        <p className="small muted">STEP 01~04 재무제표 · 재무분석 · DCF · WACC & Valuation 학습은 LEARN 영역에서 이어서 진행할 수 있습니다.</p>
        <Link className="btn" to="/learn">Learn 열기</Link>
      </section>
    </>
  );
}
