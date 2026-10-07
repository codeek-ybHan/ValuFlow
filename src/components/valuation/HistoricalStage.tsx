import { Link } from 'react-router-dom';
import { useProject } from '../../store/project';
import { stages } from './workflow';

/** 1. Historical — 불러온 공시 기반 데이터의 요약. 상세 지표는 07-2 에서 연결한다. */
export function HistoricalStage() {
  const { project } = useProject();
  const h = project.historicalData;
  const next = stages[1];
  return (
    <>
      <p className="muted">{stages[0].summary}</p>
      <section className="panel">
        <div className="panel-head"><h3>Historical Financials</h3>{h ? <span className="badge badge-complete">공시 기반</span> : <span className="badge badge-not-started">NO DATA</span>}</div>
        {h ? (
          <dl className="stat-dl">
            <div><dt>Company</dt><dd>{h.company.name} ({h.company.ticker})</dd></div>
            <div><dt>Period</dt><dd className="num">{h.company.period.join(' · ')}</dd></div>
            <div><dt>Basis · Unit</dt><dd>{h.company.basis} · {h.company.currency} {h.company.unit}</dd></div>
          </dl>
        ) : (
          <p className="muted">불러온 Historical Data 가 없습니다. 위의 [삼성전자 데이터 불러오기] 를 누르거나 <Link to="/workspace">Workspace</Link> 에서 확인하세요.</p>
        )}
        {h && <p className="hint">재무제표와 파생지표는 <Link to="/workspace">Workspace</Link> 에서 볼 수 있습니다. 이 화면의 Historical 상세 뷰는 07-2 에서 연결됩니다.</p>}
      </section>
      <div className="row between slot-nav">
        <div />
        <Link className="btn primary" to={`/valuation/${next.id}`}>{next.label} →</Link>
      </div>
    </>
  );
}
