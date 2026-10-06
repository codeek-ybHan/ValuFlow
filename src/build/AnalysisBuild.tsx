import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/state';
import { computeMetrics, cagr } from '../engine/analysis';
import { BarChart, LineChart } from '../components/Charts';
import { fmtNum, fmtPct } from '../components/ui';

export function AnalysisBuild() {
  const { state } = useApp();
  const keys = [...new Set(state.dataset.map((d) => `${d.company}|${d.basis}`))];
  const [sel, setSel] = useState(keys[0] ?? '');
  const active = keys.includes(sel) ? sel : keys[0];
  const m = useMemo(() => {
    if (!active) return [];
    const [c, b] = active.split('|');
    return computeMetrics(state.dataset.filter((d) => d.company === c && d.basis === b));
  }, [state.dataset, active]);

  if (keys.length === 0)
    return <div className="callout">분석할 데이터가 없습니다. <Link to="/learn/step-01/build">STEP 01 Project Build</Link> 에서 2개년 이상 입력하세요. 값을 임의로 채우지 않습니다.</div>;

  const labels = m.map((x) => String(x.year));
  const pct = (n: number) => `${n.toFixed(0)}%`;
  const scaled = (arr: (number | null)[]) => arr.map((v) => (v == null ? null : v * 100));
  const rows: [string, (x: (typeof m)[number]) => string][] = [
    ['revenue_growth', (x) => fmtPct(x.revenueGrowth)], ['operating_income_growth', (x) => fmtPct(x.operatingIncomeGrowth)],
    ['gross_margin', (x) => fmtPct(x.grossMargin)], ['operating_margin', (x) => fmtPct(x.operatingMargin)], ['net_margin', (x) => fmtPct(x.netMargin)],
    ['roe', (x) => fmtPct(x.roe)], ['roa', (x) => fmtPct(x.roa)], ['debt_ratio', (x) => fmtPct(x.debtRatio)], ['current_ratio', (x) => fmtPct(x.currentRatio)],
    ['CFO / 순이익', (x) => (x.cfoToNetIncome == null ? '—' : `${x.cfoToNetIncome.toFixed(2)}x`)], ['CFO − CAPEX', (x) => fmtNum(x.cfoMinusCapex)],
  ];
  const first = m[0], last = m[m.length - 1];
  return (
    <>
      <label className="field narrow"><span>기업 / 기준</span>
        <select value={active} onChange={(e) => setSel(e.target.value)}>{keys.map((k) => <option key={k} value={k}>{k.replace('|', ' · ')}</option>)}</select></label>
      {m.length < 2 && <div className="callout">성장률을 계산하려면 연속된 2개년 이상이 필요합니다.</div>}
      <div className="table-wrap"><table className="fin-table">
        <thead><tr><th>지표</th>{m.map((x) => <th key={x.year} className="num">{x.year}</th>)}</tr></thead>
        <tbody>{rows.map(([label, f]) => <tr key={label}><th><code>{label}</code></th>{m.map((x) => <td key={x.year} className="num">{f(x)}</td>)}</tr>)}</tbody>
      </table></div>
      {first && last && m.length >= 2 && (
        <p className="small">매출 CAGR ({first.year}→{last.year}): <strong className="num">{fmtPct(cagr(first.revenue, last.revenue, last.year - first.year))}</strong></p>
      )}
      <div className="chart-grid">
        <BarChart title="Revenue Trend" labels={labels} series={[{ name: '매출', values: m.map((x) => x.revenue ?? null), color: 'var(--c1)' }]} />
        <BarChart title="Operating Income Trend" labels={labels} series={[{ name: '영업이익', values: m.map((x) => x.operatingIncome ?? null), color: 'var(--c2)' }]} />
        <LineChart title="Margin Trend (%)" labels={labels} fmt={pct} series={[{ name: '영업이익률', values: scaled(m.map((x) => x.operatingMargin)), color: 'var(--c2)' }, { name: '순이익률', values: scaled(m.map((x) => x.netMargin)), color: 'var(--c1)', dashed: true }]} />
        <BarChart title="CFO / CAPEX Trend" labels={labels} series={[{ name: 'CFO', values: m.map((x) => x.cfo ?? null), color: 'var(--c1)' }, { name: 'CAPEX', values: m.map((x) => (x.capex == null ? null : Math.abs(x.capex))), color: 'var(--c4)' }]} />
      </div>
    </>
  );
}
