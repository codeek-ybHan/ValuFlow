import { Link, Navigate, useParams } from 'react-router-dom';
import { useProject } from '../store/project';
import { PageHeader } from '../components/ui';
import { ValuationStepper } from '../components/valuation/ValuationStepper';
import { StageSlot } from '../components/valuation/StageSlot';
import { DEFAULT_STAGE, stageIndex, stages, type StageId } from '../components/valuation/workflow';

export function Valuation() {
  const { stage } = useParams();
  const { project } = useProject();
  const h = project.historicalData;
  if (stage && stageIndex(stage) < 0) return <Navigate to="/valuation" replace />;
  const id = (stage ?? DEFAULT_STAGE) as StageId;
  const cur = stages[stageIndex(id)];
  return (
    <>
      <PageHeader eyebrow="Valuation" title={`${cur.no}. ${cur.label}`}>
        <p className="small muted">Unit: KRW · Billion (단위는 계산 화면 연결 시 입력 기준에 맞춰 표시)</p>
      </PageHeader>
      <ValuationStepper current={id} />
      {id === 'forecast' && (
        <section className="panel basis-panel">
          <div className="panel-head"><h3>Historical Basis</h3>{h ? <span className="badge badge-in-progress">공시 기반</span> : <span className="badge badge-not-started">NO DATA</span>}</div>
          {h ? (
            <p>{h.company.name} FY{h.company.period[0].replace('A', '')}–FY{h.company.period[h.company.period.length - 1].replace('A', '')} · {h.company.basis} · {h.company.currency} {h.company.unit}</p>
          ) : (
            <p className="muted">불러온 Historical Data 가 없습니다. <Link to="/workspace">Workspace</Link> 에서 [삼성전자 데이터 불러오기] 를 실행하세요.</p>
          )}
          <div className="row">
            <button className="btn" disabled title="Valuation Engine(STEP 05) 연결 후 활성화됩니다.">학습용 DCF 가정 적용</button>
            <span className="small muted">STEP 04 가상 실습값입니다. 삼성전자의 실제 Forecast 가 아니며, Engine 연결 후 활성화됩니다.</span>
          </div>
        </section>
      )}
      <StageSlot stage={cur} />
    </>
  );
}
