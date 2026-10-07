import type { ValidationView } from '../../engine/validationView';
import { fmtNum, fmtPct } from '../ui';

/** 검토 필요 항목. 참고 기준을 넘는 항목이 있을 때만 표시하며, 실무 판단을 대신하지 않는다. */
export function ValidationWarnings({ view }: { view: ValidationView }) {
  if (view.warnings.length === 0) {
    return <p className="hint">참고 기준을 넘는 검토 항목은 없습니다. 그래도 가정의 근거는 직접 확인해야 합니다.</p>;
  }
  return (
    <div className="callout warn" role="alert">
      <strong>검토 필요 {view.warnings.length}건</strong>
      <ul className="plain-list">{view.warnings.map((w) => <li key={w.code}>{w.message} <span className="small muted">({w.basis})</span></li>)}</ul>
      <p className="small muted">표시된 기준은 검토를 돕기 위한 참고 기준이며, 실무 판단이나 투자 판단을 대신하지 않습니다.</p>
    </div>
  );
}

const range = (r: { min: number; max: number } | null, digits = 2) => (r ? `${fmtNum(r.min, digits)} ~ ${fmtNum(r.max, digits)} 억원` : '—');

/** 실무 검토 지표 + Valuation Range(Low / Base / High). 평균으로 "정답 가치"를 만들지 않는다. */
export function ValidationRange({ view }: { view: ValidationView }) {
  const m = view.metrics;
  const r = view.range;
  const pt = (p: { label: string; equityValue: number; perShareValue: number | null }) => (
    <>
      <div className="range-value num">{fmtNum(p.equityValue, 1)} <span className="small muted">억원</span></div>
      <div className="small num muted">주당 {fmtNum(p.perShareValue, 0)}원</div>
      <div className="small muted">{p.label}</div>
    </>
  );
  return (
    <>
      <section className="panel" aria-label="실무 검토 지표">
        <div className="panel-head"><h3>실무 검토 지표</h3><span className="small muted">참고용</span></div>
        <dl className="stat-dl">
          <div><dt>Terminal Value Contribution <span className="small muted">(PV(TV) ÷ EV)</span></dt><dd className="num">{fmtPct(m.terminalValueContribution, 1)}</dd></div>
          <div><dt>WACC / g Spread <span className="small muted">(Base WACC − Base g)</span></dt><dd className="num">{fmtNum(m.spread * 100, 4)}%p</dd></div>
          <div><dt>Sensitivity Range <span className="small muted">(Enterprise Value)</span></dt><dd className="num">{range(m.sensitivityRange)}</dd></div>
          <div><dt>Scenario Range <span className="small muted">(Equity Value, Bear ~ Bull)</span></dt><dd className="num">{range(m.scenarioRange)}</dd></div>
          <div><dt>Relative Valuation Range <span className="small muted">(Equity Value)</span></dt><dd className="num">{range(m.relativeRange)}</dd></div>
        </dl>
      </section>

      <section className="panel" aria-label="Valuation Range">
        <div className="panel-head"><h3>D. Valuation Range</h3><span className="small muted">Equity Value 기준</span></div>
        <div className="range-grid">
          <div className="range-card"><div className="range-name">Low</div>{pt(r.low)}</div>
          <div className="range-card base"><div className="range-name">Base (DCF)</div>{pt(r.base)}</div>
          <div className="range-card"><div className="range-name">High</div>{pt(r.high)}</div>
        </div>
        <div className="table-wrap">
          <table className="fin-table">
            <thead><tr><th>방법</th><th className="num">Low (억원)</th><th className="num">High (억원)</th></tr></thead>
            <tbody>
              {r.spans.map((s) => (
                <tr key={s.source}>
                  <th>{s.source}</th>
                  <td className="num">{fmtNum(s.low.equityValue, 1)} <span className="muted small">({s.low.label})</span></td>
                  <td className="num">{fmtNum(s.high.equityValue, 1)} <span className="muted small">({s.high.label})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="callout" role="note"><strong>{r.disclaimer}</strong> Low / High 는 위 방법들의 결과 중 가장 낮은 값과 높은 값일 뿐이며, 평균이나 "정답 가치"가 아닙니다. 방법별 범위가 서로 다른 이유(가정, 이익 기준, 멀티플)를 검토하세요.</div>
      </section>
    </>
  );
}

