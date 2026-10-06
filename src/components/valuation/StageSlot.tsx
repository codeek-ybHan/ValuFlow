import { Link } from 'react-router-dom';
import { stages, type WorkflowStage } from './workflow';

// 계산 컴포넌트가 들어갈 자리. 계산식은 두지 않으며, 가짜 결과도 보여주지 않는다.
export function StageSlot({ stage }: { stage: WorkflowStage }) {
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
          <div className="slot-empty">입력 컴포넌트 연결 예정</div>
        </section>
        <section className="slot" aria-label="Engine Result">
          <div className="slot-head"><h3>Engine Result</h3><span className="badge badge-locked">Output</span></div>
          <ul className="plain-list small">{stage.outputs.map((x) => <li key={x}>{x}</li>)}</ul>
          <div className="slot-empty">계산 결과 컴포넌트 연결 예정 · 값은 Engine 결과 객체에서만 받습니다</div>
          <p className="small muted">연결 예정 Engine: {stage.engineFns.map((f, k) => <span key={f}>{k > 0 && ', '}<code>{f}</code></span>)}</p>
        </section>
      </div>
      <div className="row between slot-nav">
        <div>{prev && <Link className="btn" to={`/valuation/${prev.id}`}>← {prev.label}</Link>}</div>
        <div>{next && <Link className="btn primary" to={`/valuation/${next.id}`}>{next.label} →</Link>}</div>
      </div>
    </>
  );
}
