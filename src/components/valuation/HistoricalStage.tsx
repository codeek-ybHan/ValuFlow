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
  const { project, loadSamsung, historicalStatus } = useProject();
  // DataQuality 를 함께 넘겨 weak 매핑 · 누락 계정의 안내가 표에 붙는다 (fixture 는 quality 가 없다)
  const view = useMemo(() => buildHistoricalView(project.historicalData, project.historicalQuality), [project.historicalData, project.historicalQuality]);
  const next = stages[1];

  if (!view) {
    return (
      <>
        <p className="muted">{stages[0].summary}</p>
        <div className="empty-state">
          <h3>No historical data loaded</h3>
          <p>과거 재무데이터가 없어 Historical 분석을 표시할 수 없습니다. 값을 임의로 채우지 않습니다.</p>
          {historicalStatus.kind === 'failed' && <HistoricalFailureNotice failure={historicalStatus.failure} />}
          {historicalStatus.kind === 'loading' && <p className="small muted" role="status">Loading financial data...</p>}
          {project.selectedCompany && <div><p className="small muted">선택한 기업: {project.selectedCompany.corpName} ({project.selectedCompany.stockCode ?? '비상장'})</p><HistoricalLoadControls compact /></div>}
          {!project.selectedCompany && <p className="small muted">Workspace 에서 기업을 검색해 선택한 뒤 [재무데이터 불러오기] 를 실행하세요.</p>}
          <p className="small muted">학습용 데이터가 필요하면:</p>
          <button className="btn" onClick={loadSamsung}>삼성전자 학습용 Historical 불러오기</button>
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
      <p className="muted">{stages[0].summary}</p>

      {/* A. Company / Period */}
      <section className="panel hist-header" aria-label="Company / Period">
        <div className="panel-head">
          <div>
            <h3>{header.name}</h3>
            <p className="small muted">{header.ticker}</p>
          </div>
          <span className="chip" title="확정된 실적(Actual)입니다. Forecast 는 이후 단계에서 2026E … 로 구분합니다.">Actual · {prov.sourceLabel}</span>
        </div>
        <ProvenanceList h={project.historicalData!} provenance={project.historicalProvenance} />
        <p className="small muted">{header.currency} · {header.unitLabel}</p>
        <HistoricalLoadControls />
      </section>

      {/* 데이터 품질 · 출처 (실제 데이터일 때) */}
      {prov.actual && <DataQualityPanel quality={project.historicalQuality} />}

      {/* B. Key Financials */}
      <h3 className="section-title">Key Financials</h3>
      <FinTable periods={header.periods} rows={keyFinancials} unit={header.unitLabel} />

      {/* C. Historical Metrics */}
      <h3 className="section-title">Historical Metrics</h3>
      <FinTable periods={header.periods} rows={metrics} unit={`${header.unitLabel} (비율 제외)`} />

      {/* D. Trend Summary */}
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
      <p className="hint">추세 요약은 숫자 기반 규칙으로 만든 것이며, 원인 해석은 포함하지 않습니다.</p>

      {/* Charts */}
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
      <p className="hint">차트의 금액은 보기 좋게 조원(KRW million ÷ 1,000,000)으로 환산한 값입니다. 표의 값과 원본 데이터는 KRW million 그대로입니다.</p>

      {/* Historical → Forecast */}
      <section className="panel cta-panel">
        <div>
          <h3>Use historical trends to build forecast assumptions</h3>
          <p className="small muted">위의 성장률, 영업이익률, NWC, CAPEX 추세를 근거로 Forecast 가정을 세웁니다. Forecast 값은 자동으로 생성되지 않습니다.</p>
        </div>
        <Link className="btn primary" to={`/valuation/${next.id}`}>Continue to Forecast →</Link>
      </section>
    </>
  );
}
