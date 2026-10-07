import { Link } from 'react-router-dom';
import { steps } from '../content';
import { stepPath } from '../routes';
import { projectRoadmap } from '../content/roadmap';
import { useApp } from '../store/state';
import { useProject } from '../store/project';
import { isPracticeAssumptions } from '../store/projectModel';
import { nextAction, overallProgress, stepProgress } from '../store/progress';
import { Kpi, PageHeader, ProgressBar, StatusBadge, fmtNum, fmtPct } from '../components/ui';
import { buildWorkflowProgress } from '../store/workflowStatus';


export function Dashboard() {
  const { state } = useApp();
  const { project } = useProject();
  const h = project.historicalData;
  const learn = overallProgress(steps, state);
  const next = nextAction(steps, state);
  const r = project.valuationResult;
  const progress = buildWorkflowProgress(project);
  const readyCount = progress.filter((w) => w.status === 'READY' || w.status === 'CALCULATED').length;

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
        <Kpi label="Enterprise Value" value={r ? fmtNum(r.enterpriseValue, 2) : '—'} sub="억원" />
        <Kpi label="Equity Value" value={r ? fmtNum(r.equityValue, 2) : '—'} sub="억원" />
        <Kpi label="Implied Share Price" value={r ? fmtNum(r.perShareValue, 0) : '—'} sub="원" />
        <Kpi label="WACC" value={r ? fmtPct(r.wacc, 4) : '—'} sub="%" />
      </section>
      <p className="hint kpi-hint">{r ? <>Valuation 화면에서 계산한 결과입니다.{isPracticeAssumptions(project.valuationAssumptions) && ' 학습용 가정(STEP 04 가상값) 기준이며 실제 기업의 가치평가가 아닙니다.'}</> : '수치는 Valuation 에서 계산한 뒤 표시됩니다. 계산되지 않은 값은 임의로 채우지 않습니다.'}</p>

      <div className="dash-grid">
        <div>
          <section className="panel">
            <div className="panel-head"><h3>Workflow Progress</h3><span className="small muted">{readyCount} / {progress.length} 준비됨</span></div>
            <ol className="wf-list">
              {progress.map((w, i) => (
                <li key={w.key}>
                  <Link to={w.to} className="wf-row">
                    <span className="num">{String(i + 1).padStart(2, '0')}</span><span>{w.label}{w.detail && <small className="muted wf-detail"> · {w.detail}</small>}</span><StatusBadge label={w.display} />
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
            <dl className="stat-dl">
              {[
                ['WACC', r ? fmtPct(r.wacc, 4) : null],
                ['Terminal Growth', typeof project.valuationAssumptions?.terminalGrowth === 'number' ? fmtPct(project.valuationAssumptions.terminalGrowth, 2) : null],
                ['Forecast Period', r ? `${r.fcff.length}년` : null],
              ].map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={`num${v ? '' : ' empty'}`}>{v ?? '—'}</dd></div>)}
            </dl>
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
