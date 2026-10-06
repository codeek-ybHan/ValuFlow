import { useMemo } from 'react';
import { useLocalState } from './useLocalState';
import { Kpi, fmtNum, fmtPct } from '../components/ui';
import { BarChart } from '../components/Charts';
import { ValuationError, afterTaxCostOfDebt, calculateEnterpriseValue, calculateEquityValue, calculateWacc, costOfEquity, forecastFcff, sensitivityMatrix } from '../engine/dcf';

// 모든 입력은 사용자가 채우는 값이다. 기본값은 빈 칸이 아닌 "예시용 중립 가정"이며 특정 기업 데이터가 아니다.
const defaults = {
  baseRevenue: '1000', years: '5', growth: '8', margin: '15', tax: '25', da: '4', capex: '5', nwc: '10',
  rf: '3', beta: '1.1', mrp: '5', kd: '5', equityValue: '600', debtValue: '400', wacc: '10', g: '2',
  debt: '300', cash: '100', adjustments: '0',
};
type F = typeof defaults;
const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? NaN : Number(s));
const pc = (s: string) => num(s) / 100;

export function ValuationWorkbench({ mode }: { mode: 'dcf' | 'valuation' }) {
  const [f, setF] = useLocalState<F>(`valuflow:wb:${mode}`, defaults);
  const set = (k: keyof F) => (v: string) => setF({ ...f, [k]: v });
  const full = mode === 'valuation';

  const out = useMemo(() => {
    try {
      const years = Math.round(num(f.years));
      if (!(years >= 1 && years <= 15)) throw new ValuationError('예측 기간은 1~15년이어야 합니다.');
      const inputs = [f.baseRevenue, f.growth, f.margin, f.tax, f.da, f.capex, f.nwc, f.g];
      if (inputs.some((x) => Number.isNaN(num(x)))) throw new ValuationError('비어 있거나 숫자가 아닌 입력이 있습니다.');
      const rows = forecastFcff({
        baseRevenue: num(f.baseRevenue), growth: Array(years).fill(pc(f.growth)), operatingMargin: Array(years).fill(pc(f.margin)),
        taxRate: pc(f.tax), daPctRevenue: pc(f.da), capexPctRevenue: pc(f.capex), nwcPctOfRevenueChange: pc(f.nwc),
      });
      let wacc: number;
      let waccDetail: { ke: number; kdAt: number } | null = null;
      if (full) {
        const ke = costOfEquity(pc(f.rf), num(f.beta), pc(f.mrp));
        const kdAt = afterTaxCostOfDebt(pc(f.kd), pc(f.tax));
        wacc = calculateWacc({ equityValue: num(f.equityValue), debtValue: num(f.debtValue), costOfEquity: ke, costOfDebt: pc(f.kd), taxRate: pc(f.tax) });
        waccDetail = { ke, kdAt };
      } else {
        wacc = pc(f.wacc);
        if (Number.isNaN(wacc)) throw new ValuationError('할인율(WACC)을 입력하세요.');
      }
      const g = pc(f.g);
      const dcf = calculateEnterpriseValue(rows.map((r) => r.fcff), wacc, g);
      const nd = num(f.debt) - num(f.cash);
      const equity = full && !Number.isNaN(nd) ? calculateEquityValue(dcf.enterpriseValue, nd, num(f.adjustments) || 0) : null;
      const sens = full ? sensitivityMatrix(rows.map((r) => r.fcff), [-0.01, 0, 0.01].map((d) => wacc + d), [-0.01, 0, 0.01].map((d) => g + d), Number.isNaN(nd) ? 0 : nd + (num(f.adjustments) || 0)) : null;
      return { rows, dcf, wacc, g, waccDetail, nd, equity, sens, error: '' };
    } catch (e) {
      return { error: e instanceof ValuationError ? e.message : '계산 중 오류가 발생했습니다.' } as const;
    }
  }, [f, full]);

  const I = (k: keyof F, label: string, unit = '%') => (
    <label className="field"><span>{label}{unit && <em> ({unit})</em>}</span><input inputMode="decimal" value={f[k]} onChange={(e) => set(k)(e.target.value)} /></label>
  );

  return (
    <>
      <div className="card">
        <h3>Assumption Panel</h3>
        <p className="small muted">기본값은 계산기 동작을 보여주기 위한 예시 가정이며 특정 기업의 데이터가 아닙니다. 실제 기업 평가에서는 근거 있는 값으로 교체하세요. (단위 자유: 매출과 같은 단위로 결과가 나옵니다.)</p>
        <div className="form-grid">
          {I('baseRevenue', '기준 매출', '')}{I('years', '예측 기간', '년')}{I('growth', '매출 성장률')}{I('margin', '영업이익률')}
          {I('tax', '세율')}{I('da', 'D&A (매출 대비)')}{I('capex', 'CAPEX (매출 대비)')}{I('nwc', 'ΔNWC (매출 증가분 대비)')}
          {!full && I('wacc', '할인율 (WACC)')}{I('g', '영구성장률 g')}
        </div>
        {full && (<>
          <h4>WACC</h4>
          <div className="form-grid">{I('rf', 'Risk-free')}{I('beta', 'Beta', '')}{I('mrp', 'MRP')}{I('kd', '세전 Cost of Debt')}{I('equityValue', 'E (시가총액)', '')}{I('debtValue', 'D (이자부부채)', '')}</div>
          <h4>Net Debt</h4>
          <div className="form-grid">{I('debt', '이자부부채', '')}{I('cash', '현금성자산', '')}{I('adjustments', '기타 조정항목', '')}</div>
        </>)}
      </div>

      {out.error ? <div className="callout neg">계산 불가: {out.error}</div> : (
        <>
          {full && 'equity' in out && (
            <div className="kpi-row">
              <Kpi label="Enterprise Value" value={fmtNum(out.dcf!.enterpriseValue)} />
              <Kpi label="Equity Value" value={fmtNum(out.equity)} sub={`Net Debt ${fmtNum(out.nd)}`} />
              <Kpi label="WACC" value={fmtPct(out.wacc, 2)} sub={out.waccDetail ? `Ke ${fmtPct(out.waccDetail.ke, 2)} · Kd(세후) ${fmtPct(out.waccDetail.kdAt, 2)}` : undefined} />
              <Kpi label="Terminal Growth" value={fmtPct(out.g, 2)} sub={`TV 비중 ${fmtPct(out.dcf!.tvShare, 0)}`} />
            </div>
          )}
          <h3>FCFF Forecast</h3>
          <div className="table-wrap"><table className="fin-table">
            <thead><tr><th></th>{out.rows!.map((r) => <th key={r.year} className="num">Y{r.year}</th>)}</tr></thead>
            <tbody>
              {([['Revenue', 'revenue'], ['EBIT', 'ebit'], ['NOPAT', 'nopat'], ['+ D&A', 'da'], ['− CAPEX', 'capex'], ['− ΔNWC', 'deltaNwc'], ['FCFF', 'fcff']] as const).map(([l, k]) => (
                <tr key={k} className={k === 'fcff' ? 'total' : ''}><th>{l}</th>{out.rows!.map((r) => <td key={r.year} className="num">{fmtNum(r[k], 1)}</td>)}</tr>
              ))}
              <tr><th>할인계수</th>{out.rows!.map((r) => <td key={r.year} className="num">{(1 / Math.pow(1 + out.wacc!, r.year)).toFixed(4)}</td>)}</tr>
              <tr className="total"><th>PV of FCFF</th>{out.dcf!.pvFcff.map((v, i) => <td key={i} className="num">{fmtNum(v, 1)}</td>)}</tr>
            </tbody>
          </table></div>
          <table className="fin-table summary-table"><tbody>
            <tr><th>Σ PV of FCFF</th><td className="num">{fmtNum(out.dcf!.sumPvFcff, 1)}</td></tr>
            <tr><th>Terminal Value (Y{out.rows!.length} 말)</th><td className="num">{fmtNum(out.dcf!.terminalValue, 1)}</td></tr>
            <tr><th>PV of Terminal Value</th><td className="num">{fmtNum(out.dcf!.pvTerminalValue, 1)}</td></tr>
            <tr className="total"><th>Enterprise Value</th><td className="num">{fmtNum(out.dcf!.enterpriseValue, 1)}</td></tr>
          </tbody></table>
          <BarChart title="FCFF Forecast" labels={out.rows!.map((r) => `Y${r.year}`)} series={[{ name: 'FCFF', values: out.rows!.map((r) => r.fcff), color: 'var(--c1)' }]} />

          {out.sens && (
            <>
              <h3>Sensitivity Matrix — Equity Value (행: WACC, 열: g)</h3>
              <div className="table-wrap"><table className="fin-table matrix">
                <thead><tr><th>WACC \ g</th>{out.sens[0].map((c) => <th key={c.g} className="num">{fmtPct(c.g, 1)}</th>)}</tr></thead>
                <tbody>{out.sens.map((row) => (
                  <tr key={row[0].wacc}><th className="num">{fmtPct(row[0].wacc, 1)}</th>{row.map((c) => (
                    <td key={c.g} className={`num ${c.wacc === out.wacc && c.g === out.g ? 'base' : ''}`}>{c.equity == null ? 'n/a (WACC ≤ g)' : fmtNum(c.equity)}</td>
                  ))}</tr>
                ))}</tbody>
              </table></div>
              <p className="small muted">굵게 표시된 칸이 기준 시나리오입니다. WACC 가 오르면 가치가 내려가고 g 가 오르면 올라가는지 직접 확인하세요.</p>
            </>
          )}
        </>
      )}
    </>
  );
}
