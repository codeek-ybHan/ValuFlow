import type { ScenarioColumn, ScenarioView } from '../../engine/validationView';
import { fmtNum, fmtPct, fmtPctTrim } from '../ui';

// B. Scenario Analysis — Bear / Base / Bull 은 단순한 이름이 아니라 "가정 묶음"이다.
// Sensitivity 는 WACC·g 두 값만 바꿔 같은 FCFF 를 다시 할인하지만, Scenario 는 영업 가정까지 함께 바꿔 전체 Valuation 을 다시 계산한다.

const list = (xs: number[], f: (n: number) => string) => xs.map(f).join(' / ');
const pct = (n: number) => fmtPctTrim(n, 2);

export function ScenarioPanel({ view }: { view: ScenarioView }) {
  const cols = view.columns;
  const row = (label: string, render: (c: ScenarioColumn) => string, className?: string) => (
    <tr className={className}><th>{label}</th>{cols.map((c) => <td key={c.id} className="num">{render(c)}</td>)}</tr>
  );
  const result = (f: (c: ScenarioColumn) => number | null, digits: number) => (c: ScenarioColumn) => {
    const v = f(c);
    return c.ok && v !== null ? fmtNum(v, digits) : '—';
  };

  return (
    <section className="panel" aria-label="Scenario Analysis">
      <div className="panel-head"><h3>B. Scenario Analysis</h3><span className="small muted">Bear · Base · Bull 가정 묶음</span></div>
      <p className="hint scenario-note">
        Scenario 는 영업 가정(성장률 · 영업이익률 · CAPEX)과 할인 가정(위험 프리미엄 → WACC, 영구성장률)을 <strong>함께</strong> 바꾼 가정 묶음입니다.
        Sensitivity 가 WACC 와 g 두 값만 바꿔 같은 FCFF 를 다시 할인하는 것과 다릅니다. Base 는 현재 입력한 가정 그대로이고, Bear / Bull 은 Base 를 복제해 조정한 값입니다.
      </p>
      <div className="table-wrap">
        <table className="fin-table scenario-table">
          <thead>
            <tr><th>가정 묶음</th>{cols.map((c) => <th key={c.id} className="num">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            <tr className="desc-row"><th>구성</th>{cols.map((c) => <td key={c.id} className="small muted">{c.description}</td>)}</tr>
            <tr className="group-row"><th colSpan={cols.length + 1}>가정</th></tr>
            {row('Revenue Growth (Y1 / Y2 / Y3)', (c) => list(c.assumptions.revenueGrowth, pct))}
            {row('Operating Margin (Y1 / Y2 / Y3)', (c) => list(c.assumptions.operatingMargin, pct))}
            {row('CAPEX (억원)', (c) => list(c.assumptions.capex, (n) => fmtNum(n, 1)))}
            {row('Market Risk Premium', (c) => pct(c.assumptions.marketRiskPremium))}
            {row('Terminal Growth', (c) => pct(c.assumptions.terminalGrowth))}
            <tr className="group-row"><th colSpan={cols.length + 1}>결과</th></tr>
            {row('WACC (엔진 계산)', (c) => (c.wacc === null ? '—' : fmtPct(c.wacc, 4)))}
            {row('Enterprise Value (억원)', result((c) => c.enterpriseValue, 2), 'strong')}
            {row('Equity Value (억원)', result((c) => c.equityValue, 2), 'strong')}
            {row('Per Share Value (원)', result((c) => c.perShareValue, 0), 'strong')}
            {cols.some((c) => !c.ok) && (
              <tr className="error-row"><th>계산 불가</th>{cols.map((c) => <td key={c.id} className="small neg">{c.error ?? ''}</td>)}</tr>
            )}
          </tbody>
        </table>
      </div>
      {view.equityRange && (
        <p className="small num">
          Scenario 범위 (Equity Value): {fmtNum(view.equityRange.min, 2)} ~ {fmtNum(view.equityRange.max, 2)} 억원
          {view.equityRange.widthRatio !== null && <span className="muted"> (Base 대비 폭 {fmtPct(view.equityRange.widthRatio, 0)})</span>}
        </p>
      )}
      <p className="hint">WACC 는 시장 위험 프리미엄 입력을 바꿔 엔진이 다시 계산한 값입니다(Bear: 위험 프리미엄 +1%p, Bull: −0.5%p). CAPEX 는 Bear 에서만 10% 상향하고 Bull 에서는 유지합니다.</p>
    </section>
  );
}
