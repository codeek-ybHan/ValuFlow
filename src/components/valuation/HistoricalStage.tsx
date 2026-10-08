import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../../store/project';
import { buildHistoricalView, type HistoricalRow } from '../../engine/historicalView';
import { BarChart, LineChart } from '../Charts';
import { fmtNum, fmtPct } from '../ui';
import { DataQualityPanel, HistoricalFailureNotice, HistoricalLoadControls, ProvenanceList } from '../HistoricalSource';
import { provenanceView } from '../../store/historicalLoad';
import { stages } from './workflow';

// 1. Historical — project.historicalData 만 사용한다 (Forecast / Result 값은 읽지 않는다).
// 표시용 숫자 포맷은 여기서만 하고, 지표 계산과 요약은 engine/historicalView 가 한다.

function cell(row: HistoricalRow, v: number | null) {
  return row.kind === 'percent' ? fmtPct(v, 1) : fmtNum(v);
}

function FinTable({ periods, rows, unit }: { periods: string[]; rows: HistoricalRow[]; unit: string }) {
  return (
    <>
      <div className="table-wrap">
        <table className="fin-table">
          <thead>
            <tr><th>Unit: {unit}</th>{periods.map((p) => <th key={p} className="num">{p}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}><th>{r.label}</th>{r.values.map((v, i) => <td key={i} className="num">{cell(r, v)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.filter((r) => r.note).map((r) => <p key={r.key} className="hint table-note"><strong>{r.label}</strong> — {r.note}</p>)}
    </>
  );
}

export function HistoricalStage() {
  const { project, historicalStatus } = useProject();
  // DataQuality 를 함께 넘겨 weak 매핑 · 누락 계정의 안내가 표에 붙는다 (fixture 는 quality 가 없다)
  const view = useMemo(() => buildHistoricalView(project.historicalData, project.historicalQuality), [project.historicalData, project.historicalQuality]);
  const next = stages[1];

  if (!view) {
    return (
      <>
        <div className="empty-state">
          <h3>No historical data loaded</h3>
          <p>Workspace 에서 기업을 선택하고 재무데이터를 불러오세요.</p>
          {historicalStatus.kind === 'failed' && <HistoricalFailureNotice failure={historicalStatus.failure} />}
          {historicalStatus.kind === 'loading' && <p className="small muted" role="status">Loading financial data...</p>}
          {project.selectedCompany && <div><p className="small muted">선택한 기업: {project.selectedCompany.corpName} ({project.selectedCompany.stockCode ?? '비상장'})</p><HistoricalLoadControls compact /></div>}
          {!project.selectedCompany && <Link className="btn primary" to="/workspace">Workspace 로 이동</Link>}
        </div>
      </>
    );
  }

  const { header, keyFinancials, metrics, trends, chart } = view;
  const prov = provenanceView(project.historicalData!, project.historicalProvenance);
  const pctFmt = (n: number) => `${n.toFixed(0)}%`;
  const trnFmt = (n: number) => n.toFixed(0);

  return (
    <>
      {/* 숫자 먼저: Key Financials → 차트 → 지표 → 추세. 출처 · 품질 · 불러오기는 접어 둔다. */}
      <h3 className="section-title first">Key Financials</h3>
      <FinTable periods={header.periods} rows={keyFinancials} unit={header.unitLabel} />

      <div className="chart-grid">
        <BarChart
          title="Revenue / Operating Profit (조원)"
          labels={chart.labels}
          fmt={trnFmt}
          series={[
            { name: 'Revenue', values: chart.revenueTrillion, color: 'var(--c1)' },
            { name: 'Operating Profit', values: chart.operatingProfitTrillion, color: 'var(--c2)' },
          ]}
        />
        <LineChart
          title="Operating Margin / Revenue Growth (%)"
          labels={chart.labels}
          fmt={pctFmt}
          series={[
            { name: 'Operating Margin', values: chart.operatingMarginPct, color: 'var(--c1)' },
            { name: 'Revenue Growth', values: chart.revenueGrowthPct, color: 'var(--c3)', dashed: true },
          ]}
        />
      </div>

      <h3 className="section-title">Historical Metrics</h3>
      <FinTable periods={header.periods} rows={metrics} unit={`${header.unitLabel} (비율 제외)`} />

      <h3 className="section-title">Trend Summary</h3>
      <div className="trend-grid">
        {trends.map((t) => (
          <section key={t.key} className="panel trend-card" aria-label={t.title}>
            <h4>{t.title}</h4>
            <ul className="plain-list small">{t.lines.map((l) => <li key={l} className="num">{l}</li>)}</ul>
            <p className="trend-verdict"><span className="muted small">추세</span> {t.verdict}</p>
          </section>
        ))}
      </div>

      <details className="source-detail" aria-label="Company / Period">
        <summary>출처 · 데이터 품질 · 불러오기 <span className="muted small">({header.name} · {header.ticker} · Actual · {prov.sourceLabel})</span></summary>
        <ProvenanceList h={project.historicalData!} provenance={project.historicalProvenance} />
        <p className="small muted">{header.currency} · {header.unitLabel}</p>
        <HistoricalLoadControls />
        {prov.actual && <DataQualityPanel quality={project.historicalQuality} />}
      </details>

      <div className="row between slot-nav"><span /><Link className="btn primary" to={`/valuation/${next.id}`}>Continue to Forecast →</Link></div>
    </>
  );
}
