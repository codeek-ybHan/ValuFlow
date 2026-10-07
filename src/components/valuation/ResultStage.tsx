import { Link } from 'react-router-dom';
import { useProject } from '../../store/project';
import { Kpi, fmtNum, fmtPct } from '../ui';
import { stages } from './workflow';

/** 5. Result — Engine 결과의 핵심 값만 보여 준다 (표·차트·Heatmap 은 이후 단계). 표시용 반올림은 여기서만 한다. */
export function ResultStage() {
  const { project } = useProject();
  const r = project.valuationResult;
  const s = project.sensitivityResult;
  const prev = stages[stages.length - 3];
  const next = stages[stages.length - 1];
  const base = s?.cells.flat().find((c) => c.isBaseCase);
  return (
    <>
      <p className="muted">{stages[4].summary}</p>
      <section className="kpi-row" aria-label="Valuation Result">
        <Kpi label="Enterprise Value" value={r ? fmtNum(r.enterpriseValue, 2) : '—'} sub="억원" />
        <Kpi label="Equity Value" value={r ? fmtNum(r.equityValue, 2) : '—'} sub={r ? `Net Debt ${fmtNum(r.netDebt, 0)} 억원` : '억원'} />
        <Kpi label="Implied Share Price" value={r ? fmtNum(r.perShareValue, 0) : '—'} sub="원" />
        <Kpi label="WACC" value={r ? fmtPct(r.wacc, 4) : '—'} sub={r ? `Ke ${fmtPct(r.costOfEquity, 2)} · Kd(세후) ${fmtPct(r.afterTaxCostOfDebt, 2)}` : undefined} />
      </section>
      {!r && <div className="callout">아직 계산되지 않았습니다. 위의 [학습용 DCF 가정 적용] 또는 [Run Valuation] 을 실행하세요. 계산되지 않은 값은 임의로 채우지 않습니다.</div>}
      <section className="panel">
        <div className="panel-head"><h3>Sensitivity</h3>{s ? <span className="badge badge-complete">Calculated</span> : <span className="badge badge-not-started">Not run</span>}</div>
        {s ? (
          <dl className="stat-dl">
            <div><dt>Matrix</dt><dd className="num">WACC {s.waccValues.length} × g {s.terminalGrowthValues.length}</dd></div>
            <div><dt>Base Case EV</dt><dd className="num">{base ? `${fmtNum(base.enterpriseValue, 2)} 억원` : '—'}</dd></div>
            <div><dt>Range (min – max EV)</dt><dd className="num">{fmtNum(Math.min(...s.cells.flat().map((c) => c.enterpriseValue)), 2)} – {fmtNum(Math.max(...s.cells.flat().map((c) => c.enterpriseValue)), 2)} 억원</dd></div>
          </dl>
        ) : (
          <p className="muted">Sensitivity 결과가 없습니다.</p>
        )}
        <p className="hint">Sensitivity Matrix 는 Validation 단계에서 확인할 수 있습니다.</p>
      </section>
      <div className="row between slot-nav">
        <Link className="btn" to={`/valuation/${prev.id}`}>← {prev.label}</Link>
        <Link className="btn primary" to={`/valuation/${next.id}`}>{next.label} →</Link>
      </div>
    </>
  );
}
