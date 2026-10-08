import { Link } from 'react-router-dom';
import { useProject } from '../store/project';
import { isPracticeAssumptions } from '../store/projectModel';
import { fmtNum, fmtPct } from '../components/ui';
import { buildWorkflowProgress } from '../store/workflowStatus';

/** 핵심만: 현재 기업 · 가치평가 결과 4개 숫자 · 다음에 할 일 · 진행 단계. */
export function Dashboard() {
  const { project } = useProject();
  const h = project.historicalData;
  const r = project.valuationResult;
  const progress = buildWorkflowProgress(project);
  const sample = isPracticeAssumptions(project.valuationAssumptions);

  const cta = !h ? { to: '/workspace', label: '기업 선택하기' }
    : !r ? { to: '/valuation', label: 'Valuation 시작' }
    : { to: '/report', label: 'Report 만들기' };

  const kpis: { label: string; value: string; unit: string }[] = [
    { label: 'Enterprise Value', value: r ? fmtNum(r.enterpriseValue, 0) : '—', unit: '억원' },
    { label: 'Equity Value', value: r ? fmtNum(r.equityValue, 0) : '—', unit: '억원' },
    { label: 'Implied Share Price', value: r ? fmtNum(r.perShareValue, 0) : '—', unit: '원' },
    { label: 'WACC', value: r ? fmtPct(r.wacc, 2) : '—', unit: '' },
  ];

  return (
    <>
      <header className="dash-head">
        <div>
          <h1>{h ? h.company.name : 'ValuFlow'}</h1>
          <p className="muted">
            {h ? `${h.company.ticker} · ${h.company.period.join(' · ')} · ${h.company.basis}`
              : 'OpenDART 재무제표에서 DCF 가치평가와 근거 있는 AI 분석까지.'}
          </p>
        </div>
        <Link className="btn primary" to={cta.to}>{cta.label}</Link>
      </header>

      <section className="hero-kpis" aria-label="Valuation Snapshot">
        {kpis.map((k) => (
          <div key={k.label} className="hero-kpi">
            <div className="hero-label">{k.label}</div>
            <div className={`hero-value num${k.value === '—' ? ' empty' : ''}`}>{k.value}{k.value !== '—' && k.unit && <small>{k.unit}</small>}</div>
          </div>
        ))}
      </section>
      <p className="hero-note muted">
        {r ? (sample ? <span className="chip" title="STEP 04 가상 실습값 기준입니다. 실제 기업의 가치평가가 아닙니다.">Sample assumptions</span> : null)
          : '가정을 입력하고 Valuation 을 실행하면 표시됩니다.'}
      </p>

      <section aria-label="Workflow">
        <h2 className="section-label">Workflow</h2>
        <ol className="pipeline">
          {progress.map((w, i) => (
            <li key={w.key}>
              <Link to={w.to} title={w.detail ?? undefined} className={`pipe pipe-${w.display.toLowerCase().replace(/\s+/g, '-')}`}>
                <span className="pipe-no num">{String(i + 1).padStart(2, '0')}</span>
                <span className="pipe-label">{w.label}</span>
                <span className="pipe-status">{w.display}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
