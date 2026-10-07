import { Link } from 'react-router-dom';
import { stages, type WorkflowStage } from './workflow';

// 단계별 입력/결과 컴포넌트가 들어갈 자리. 계산식은 두지 않으며 가짜 결과도 보여주지 않는다.
// calculated: Engine 결과가 있으면 true (상세 표시는 이후 단계에서 연결).
export function StageSlot({ stage, calculated }: { stage: WorkflowStage; calculated: boolean }) {
  const i = stages.findIndex((s) => s.id === stage.id);
  const prev = stages[i - 1];
  const next = stages[i + 1];
  return (
    <>
      <p className="muted">{stage.summary}</p>
      <div className="slot-grid">
        <section className="slot" aria-label="Assumption Inputs">
          <div className="slot-head"><h3>Assumption Inputs</h3><span className="badge badge-locked">Input</span></div>
          <ul className="plain-list small">{stage.inputs.map((x) => <li key={x}>{x}</li>)}</ul>
          <div className="slot-empty">입력 Form 연결 예정 (07-3 이후)</div>
        </section>
        <section className="slot" aria-label="Engine Result">
          <div className="slot-head"><h3>Engine Result</h3><span className={`badge ${calculated ? 'badge-complete' : 'badge-locked'}`}>{calculated ? 'Calculated' : 'Not run'}</span></div>
          <ul className="plain-list small">{stage.outputs.map((x) => <li key={x}>{x}</li>)}</ul>
          <div className="slot-empty">{calculated ? '계산 결과가 준비되어 있습니다. 상세 표시는 이후 단계에서 연결됩니다.' : '[학습용 DCF 가정 적용] 으로 계산하면 결과가 준비됩니다.'}</div>
          <p className="small muted">읽는 결과 필드: {stage.resultFields.map((f, k) => <span key={f}>{k > 0 && ', '}<code>{f}</code></span>)}</p>
        </section>
      </div>
      <div className="row between slot-nav">
        <div>{prev && <Link className="btn" to={`/valuation/${prev.id}`}>← {prev.label}</Link>}</div>
        <div>{next && <Link className="btn primary" to={`/valuation/${next.id}`}>{next.label} →</Link>}</div>
      </div>
    </>
  );
}
