import { Link } from 'react-router-dom';
import { steps } from '../content';
import { stepPath } from '../routes';
import { projectRoadmap } from '../content/roadmap';
import { useApp } from '../store/state';
import { useProject } from '../store/project';
import { nextAction, overallProgress, stepProgress } from '../store/progress';
import { Kpi, PageHeader, ProgressBar, StatusBadge, fmtPct } from '../components/ui';
import { dashboardWorkflow } from '../components/valuation/workflow';

// Engine / 데이터 파이프라인 연결 전이므로 수치는 '—' 로 두고 가짜 결과를 만들지 않는다.
const kpis: { label: string; sub: string }[] = [
  { label: 'Enterprise Value', sub: 'KRW · Billion' },
  { label: 'Equity Value', sub: 'KRW · Billion' },
  { label: 'Implied Share Price', sub: 'KRW' },
  { label: 'WACC', sub: '%' },
];
const assumptions = ['WACC', 'Terminal Growth', 'Forecast Period'];

export function Dashboard() {
  const { state } = useApp();
  const { project } = useProject();
  const h = project.historicalData;
  const learn = overallProgress(steps, state);
  const next = nextAction(steps, state);

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title="Dashboard"
        actions={<>
          <Link className="btn" to="/workspace">Open Workspace</Link>
          <Link className="btn primary" to="/valuation">Start Valuation</Link>
        </>}
      >
        <p className="lead">From Financial Statements to AI-powered Valuation. 재무분석, DCF 가치평가, AI 해석을 하나의 흐름으로 연결합니다.</p>
      </PageHeader>

      <section className="kpi-row" aria-label="Valuation Snapshot">
        {kpis.map((k) => <Kpi key={k.label} label={k.label} value="—" sub={k.sub} />)}
      </section>
      <p className="hint kpi-hint">수치는 Valuation Engine(STEP 05) 연결 후 표시됩니다. 계산되지 않은 값은 임의로 채우지 않습니다.</p>

      <div className="dash-grid">
        <div>
          <section className="panel">
            <div className="panel-head"><h3>Workflow Progress</h3><span className="small muted">0 / {dashboardWorkflow.length} 완료</span></div>
            <ol className="wf-list">
              {dashboardWorkflow.map((w) => (
                <li key={w.no}>
                  <Link to={w.to} className="wf-row">
                    <span className="num">{w.no}</span><span>{w.label}</span><StatusBadge label="NOT STARTED" />
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>PROJECT Roadmap</h3><span className="small muted">STEP 05 – 10</span></div>
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
        </div>

        <div>
          <section className="panel">
            <div className="panel-head"><h3>Current Company</h3>{h ? <StatusBadge label="LOADED" /> : <StatusBadge label="NOT SELECTED" />}</div>
            <p className="step-title">{h ? `${h.company.name} (${h.company.ticker})` : '선택된 기업 없음'}</p>
            <p className="small muted">{h ? `${h.company.period.join(' · ')} · ${h.company.basis} · ${h.company.currency} ${h.company.unit}` : 'Workspace 에서 학습용 기업 데이터를 불러올 수 있습니다. 자동 수집은 Data Pipeline 단계에서 연결됩니다.'}</p>
            {!h && <Link className="btn" to="/workspace">Workspace 열기</Link>}
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Core Assumptions</h3><Link className="small" to="/valuation/forecast">입력하기 →</Link></div>
            <dl className="stat-dl">{assumptions.map((k) => <div key={k}><dt>{k}</dt><dd className="num empty">—</dd></div>)}</dl>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Learn</h3><span className="small muted">STEP 01 – 04</span></div>
            <div className="row between"><span className="small muted">전체 진행률</span><strong className="num">{fmtPct(learn.ratio, 0)}</strong></div>
            <ProgressBar ratio={learn.ratio} label="Learn 진행률" />
            <ul className="checklist">
              {steps.map((s) => {
                const st = stepProgress(s, state).status;
                return (
                  <li key={s.id} className={st === 'COMPLETE' ? 'done' : ''}>
                    <span className="box" aria-hidden />
                    <Link to={stepPath(s.id)}>{s.code} {s.short}</Link>
                  </li>
                );
              })}
            </ul>
            <Link className="btn" to={next.to}>이어서 학습 →</Link>
          </section>
        </div>
      </div>
    </>
  );
}
