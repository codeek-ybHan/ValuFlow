import { useMemo, useState } from 'react';
import { PageHeader, StatusBadge, fmtNum, fmtPct } from '../components/ui';
import { useProject } from '../store/project';
import { deriveHistoricalMetrics } from '../engine/historical';
import type { HistoricalData } from '../data/types';
import { CompanySearch } from '../components/CompanySearch';
import { historicalSourceView } from '../store/companySelection';

const TABS = ['Overview', 'Income Statement', 'Balance Sheet', 'Cash Flow', 'Historical Analysis'] as const;
type Tab = (typeof TABS)[number];

type Row = { label: string; values: (number | null)[]; total?: boolean };

function FinTable({ period, rows, note }: { period: string[]; rows: Row[]; note?: string }) {
  return (
    <>
      <div className="table-wrap"><table className="fin-table">
        <thead><tr><th>KRW million</th>{period.map((p) => <th key={p} className="num">{p}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.label} className={r.total ? 'total' : undefined}>
            <th>{r.label}</th>{r.values.map((v, i) => <td key={i} className="num">{fmtNum(v)}</td>)}
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
  return <FinTable period={p} note="CAPEX (Learning Basis): 현재 학습 버전에서는 유형자산 취득액을 CAPEX 로 사용합니다. 무형자산 취득액은 별도로 표시만 합니다." rows={[
    { label: 'CFO', values: cf.cfo }, { label: 'PPE Acquisition (CAPEX, Learning Basis)', values: cf.ppeAcquisition },
    { label: 'Intangible Asset Acquisition', values: cf.intangibleAcquisition },
  ]} />;
}

function Analysis({ h }: { h: HistoricalData }) {
  const m = useMemo(() => deriveHistoricalMetrics(h), [h]);
  return (
    <>
      <div className="table-wrap"><table className="fin-table">
        <thead><tr><th>Metric</th>{m.period.map((p) => <th key={p} className="num">{p}</th>)}</tr></thead>
        <tbody>
          <tr><th>Revenue Growth (YoY)</th>{m.revenueGrowth.map((v, i) => <td key={i} className="num">{fmtPct(v)}</td>)}</tr>
          <tr><th>Operating Margin</th>{m.operatingMargin.map((v, i) => <td key={i} className="num">{fmtPct(v)}</td>)}</tr>
          <tr><th>NWC (AR + Inventory − AP), KRW million</th>{m.nwc.map((v, i) => <td key={i} className="num">{fmtNum(v)}</td>)}</tr>
          <tr><th>ΔNWC, KRW million</th>{m.deltaNwc.map((v, i) => <td key={i} className="num">{fmtNum(v)}</td>)}</tr>
          <tr><th>CAPEX (Learning Basis), KRW million</th>{m.capex.map((v, i) => <td key={i} className="num">{fmtNum(v)}</td>)}</tr>
          <tr><th>CFO − CAPEX (Reference), KRW million</th>{m.cfoMinusCapex.map((v, i) => <td key={i} className="num">{fmtNum(v)}</td>)}</tr>
        </tbody>
      </table></div>
      <p className="small muted">CFO − CAPEX 는 현금창출력을 가늠하는 참고지표이며 FCFF 가 아닙니다. 첫 해의 성장률과 ΔNWC 는 비교 연도가 없어 계산하지 않습니다.</p>
    </>
  );
}

export function Workspace() {
  const { project, loadSamsung, reset } = useProject();
  const h = project.historicalData;
  const [tab, setTab] = useState<Tab>('Overview');
  const [msg, setMsg] = useState<string | null>(null);
  const period = h?.company.period;
  const src = h ? historicalSourceView(h) : null;

  return (
    <>
      <PageHeader eyebrow="Workspace" title={h ? h.company.name : 'Workspace'}>
        <p className="muted">
          {h
            ? `${h.company.ticker} · ${period![0].replace('A', '')} – ${period![period!.length - 1].replace('A', '')} · ${h.company.basis} · ${h.company.currency} ${h.company.unit}`
            : '기업의 원천 재무데이터를 확인하는 영역입니다. 아직 불러온 데이터가 없습니다.'}
        </p>
      </PageHeader>

      <CompanySearch />

      <h3 className="section-title">학습용 Historical <span className="chip">Fixture</span></h3>
      <p className="small muted">OpenDART 기업 선택과는 별개입니다. 선택한 기업에 이 학습용 재무데이터가 붙지 않습니다.</p>
      <div className="row action-row">
        <button className="btn primary" onClick={() => { loadSamsung(); setMsg('삼성전자 FY2023~FY2025 학습 데이터를 불러왔습니다.'); }}>삼성전자 학습용 Historical 불러오기</button>
        <button className="btn" onClick={() => { reset(); setMsg(null); setTab('Overview'); }} disabled={!h}>입력값 초기화</button>
      </div>

      {msg && h && (
        <div className="callout" role="status">
          {msg}<br />
          <span className="small">Historical data: 공시 기반 · Forecast assumptions: 사용자 입력 필요</span>
        </div>
      )}

      <nav className="steptabs" aria-label="Workspace 탭">
        {TABS.map((t) => <button key={t} type="button" className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </nav>

      {!h ? (
        <div className="coming">
          <StatusBadge label="NO DATA" />
          <p className="muted">[삼성전자 학습용 Historical 불러오기] 를 누르면 Historical Financials 가 채워집니다. 실제 재무데이터 연결은 STEP 06-3 입니다. 값을 임의로 만들지 않습니다.</p>
        </div>
      ) : tab === 'Overview' ? (
        <section className="panel">
          <div className="panel-head"><h3>Historical Financials</h3><StatusBadge label="COMPLETE" /></div>
          <dl className="stat-dl">
            <div><dt>Historical Financials</dt><dd>✓ Loaded · 공시 기반</dd></div>
            <div><dt>Source</dt><dd>{src!.label}</dd></div>
            {src!.fetchedAt && <div><dt>Fetched at</dt><dd className="num">{src!.fetchedAt}</dd></div>}
            <div><dt>Basis</dt><dd>2025 사업보고서 {h.company.basis === 'Consolidated' ? '연결' : '별도'}재무제표</dd></div>
            <div><dt>Forecast Assumptions</dt><dd>미입력 (Valuation 에서 입력)</dd></div>
          </dl>
          <p className="small muted">탭에서 재무제표와 파생지표를 확인하세요. 이 화면의 값은 모두 Actual(A)이며, 가치평가 가정은 포함하지 않습니다.</p>
        </section>
      ) : tab === 'Historical Analysis' ? (
        <Analysis h={h} />
      ) : (
        <Statements tab={tab} h={h} />
      )}
    </>
  );
}
