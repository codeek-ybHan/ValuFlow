import { useMemo, useState } from 'react';
import { PageHeader, fmtNum, fmtPct, newestFirstOrder } from '../components/ui';
import { useProject } from '../store/project';
import { analyzeHistorical, type MetricSeries } from '../engine/historicalAnalysis';
import type { HistoricalData } from '../data/types';
import { CompanySearch } from '../components/CompanySearch';
import { provenanceView } from '../store/historicalLoad';
import { DataQualityPanel, ProvenanceList } from '../components/HistoricalSource';
import { depreciationUnavailableNote, historicalDepreciation } from '../engine/depreciation';

const TABS = ['Overview', 'Income Statement', 'Balance Sheet', 'Cash Flow', 'Historical Analysis'] as const;
type Tab = (typeof TABS)[number];

type Row = { label: string; values: (number | null)[]; total?: boolean };

function FinTable({ period, rows, note }: { period: string[]; rows: Row[]; note?: string }) {
  const order = newestFirstOrder(period);   // 최근 연도가 왼쪽
  return (
    <>
      <div className="table-wrap"><table className="fin-table">
        <thead><tr><th>KRW million</th>{order.map((i) => <th key={period[i]} className="num">{period[i]}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.label} className={r.total ? 'total' : undefined}>
            <th>{r.label}</th>{order.map((i) => <td key={i} className="num">{fmtNum(r.values[i])}</td>)}
          </tr>
        ))}</tbody>
      </table></div>
      {note && <p className="small muted">{note}</p>}
    </>
  );
}

function Statements({ tab, h }: { tab: Tab; h: HistoricalData }) {
  const p = h.company.period;
  const { incomeStatement: is, balanceSheet: bs, cashFlow: cf } = h;
  if (tab === 'Income Statement')
    return <FinTable period={p} rows={[
      { label: 'Revenue', values: is.revenue }, { label: 'COGS', values: is.cogs },
      { label: 'Gross Profit', values: is.grossProfit, total: true }, { label: 'SG&A', values: is.sga },
      { label: 'Operating Profit', values: is.operatingProfit, total: true }, { label: 'Net Income', values: is.netIncome, total: true },
    ]} />;
  if (tab === 'Balance Sheet')
    return <FinTable period={p} rows={[
      { label: 'Accounts Receivable', values: bs.accountsReceivable }, { label: 'Inventory', values: bs.inventory },
      { label: 'Accounts Payable', values: bs.accountsPayable }, { label: 'Total Assets', values: bs.totalAssets, total: true },
      { label: 'Total Liabilities', values: bs.totalLiabilities }, { label: 'Total Equity', values: bs.totalEquity },
    ]} />;
  const da = historicalDepreciation(h);
  const note = `CAPEX (Learning Basis): 현재 학습 버전에서는 유형자산 취득액을 CAPEX 로 사용합니다. 무형자산 취득액은 별도로 표시만 합니다.${da ? '' : ` D&A: ${depreciationUnavailableNote(h)}`}`;
  return <FinTable period={p} note={note} rows={[
    { label: 'CFO', values: cf.cfo }, { label: 'PPE Acquisition (CAPEX, Learning Basis)', values: cf.ppeAcquisition },
    { label: 'Intangible Asset Acquisition', values: cf.intangibleAcquisition },
    { label: 'D&A', values: da ?? p.map(() => null) },
  ]} />;
}

function Analysis({ h }: { h: HistoricalData }) {
  const a = useMemo(() => analyzeHistorical(h), [h]);
  const m = a.metrics;
  const order = newestFirstOrder(a.periods);   // 최근 연도가 왼쪽
  const ratio = (s: MetricSeries) => order.map((i) => <td key={i} className="num">{fmtPct(s.values[i])}</td>);
  const amount = (s: MetricSeries) => order.map((i) => <td key={i} className="num">{fmtNum(s.values[i])}</td>);
  const unavailable = a.forecastReference.unavailable;
  return (
    <>
      <div className="table-wrap"><table className="fin-table">
        <thead><tr><th>Metric</th>{order.map((i) => <th key={a.periods[i]} className="num">{a.periods[i]}</th>)}</tr></thead>
        <tbody>
          <tr><th>Revenue Growth (YoY)</th>{ratio(m.revenueGrowth)}</tr>
          <tr><th>Operating Margin</th>{ratio(m.operatingMargin)}</tr>
          <tr><th>Net Margin</th>{ratio(m.netMargin)}</tr>
          <tr><th>NWC (AR + Inventory − AP), {a.unitLabel}</th>{amount(m.nwc)}</tr>
          <tr><th>ΔNWC, {a.unitLabel}</th>{amount(m.deltaNwc)}</tr>
          <tr><th>NWC / Revenue</th>{ratio(m.nwcToRevenue)}</tr>
          <tr><th>{a.capexBasisLabel}, {a.unitLabel}</th>{amount(m.capex)}</tr>
          <tr><th>CFO − CAPEX (Reference), {a.unitLabel}</th>{amount(m.cfoMinusCapex)}</tr>
          <tr><th>D&A, {a.unitLabel}</th>{amount(m.depreciation)}</tr>
          {m.netDebtExLease.quality.status !== 'missing' && <tr><th>{m.netDebtExLease.label}, {a.unitLabel}</th>{amount(m.netDebtExLease)}</tr>}
        </tbody>
      </table></div>
      <p className="small muted">CFO − CAPEX 는 현금창출력을 가늠하는 참고지표이며 FCFF 가 아닙니다. 첫 해의 성장률과 ΔNWC 는 비교 연도가 없어 계산하지 않습니다.</p>
      {a.revenueCagr !== null && <p className="small muted">Revenue CAGR ({a.periods[0]} → {a.periods[a.periods.length - 1]}): {fmtPct(a.revenueCagr)}</p>}
      {unavailable.length > 0 && <p className="small muted">{unavailable.join(' · ')}. 값을 추정하거나 채우지 않습니다.</p>}
    </>
  );
}

export function Workspace() {
  const { project, reset } = useProject();
  const h = project.historicalData;
  const [tab, setTab] = useState<Tab>('Overview');
  const period = h?.company.period;
  const prov = h ? provenanceView(h, project.historicalProvenance) : null;

  return (
    <>
      <PageHeader title={h ? h.company.name : 'Workspace'}
        actions={h ? <button className="btn small" onClick={() => { reset(); setTab('Overview'); }}>입력값 초기화</button> : undefined}>
        <p className="muted">
          {h
            ? `${h.company.ticker} · ${period![0].replace('A', '')} – ${period![period!.length - 1].replace('A', '')} · ${h.company.basis} · ${h.company.currency} ${h.company.unit}${prov!.actual ? ` · ${prov!.sourceLabel}` : ' · Sample'}`
            : '기업을 검색해 재무데이터를 불러오세요.'}
        </p>
      </PageHeader>

      <CompanySearch />

      {!h ? null : (
        <>
          <nav className="steptabs" aria-label="Workspace 탭">
            {TABS.map((t) => <button key={t} type="button" className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
          </nav>
          {tab === 'Overview' ? (
            <>
              <FinTable period={h.company.period} rows={[
                { label: 'Revenue', values: h.incomeStatement.revenue },
                { label: 'Operating Profit', values: h.incomeStatement.operatingProfit },
                { label: 'Net Income', values: h.incomeStatement.netIncome },
                { label: 'CFO', values: h.cashFlow.cfo },
              ]} />
              <details className="source-detail">
                <summary>출처 · 데이터 품질</summary>
                <ProvenanceList h={h} provenance={project.historicalProvenance} />
                {prov!.actual && <DataQualityPanel quality={project.historicalQuality} />}
              </details>
            </>
          ) : tab === 'Historical Analysis' ? (
            <Analysis h={h} />
          ) : (
            <Statements tab={tab} h={h} />
          )}
        </>
      )}
    </>
  );
}
