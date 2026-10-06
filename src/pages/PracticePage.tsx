import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getStep } from '../content';
import { stepIdFromSlug, stepPath } from '../routes';
import { useApp, type PracticeState } from '../store/state';
import { Rich } from '../components/Rich';
import { PageHeader, BackLink, fmtNum, fmtPct } from '../components/ui';
import { StepTabs } from '../components/StepTabs';
import { NotFound } from './NotFound';
import { computeMetrics, operatingMargin, balanceCheck } from '../engine/analysis';
import { calculateEnterpriseValue, forecastFcff } from '../engine/dcf';
import { sampleCompany } from '../engine/sample';
import type { FinancialRecord } from '../types';
import { samsungHistoricalData } from '../data/samsungHistorical';
import { historicalToRecords } from '../data/toFinancialRecords';

const blank: PracticeState = { values: {}, completed: false };
const n = (v: string | undefined) => (v === undefined || v.trim() === '' || !Number.isFinite(Number(v.replace(/,/g, ''))) ? undefined : Number(v.replace(/,/g, '')));

export function PracticePage() {
  const { stepId } = useParams();
  const step = getStep(stepIdFromSlug(stepId));
  const { state, update } = useApp();
  if (!step) return <NotFound />;
  const p = state.practice[step.id] ?? blank;
  const cfg = step.practice;
  const save = (patch: Partial<PracticeState>) =>
    update((s) => ({ ...s, practice: { ...s.practice, [step.id]: { ...(s.practice[step.id] ?? blank), ...patch, updatedAt: new Date().toISOString() } } }));
  const setVal = (id: string, v: string) => save({ values: { ...p.values, [id]: v } });

  return (
    <>
      <BackLink to={`${stepPath(step.id)}`}>{step.code} {step.title}</BackLink>
      <PageHeader eyebrow={`${step.code} · Practice Mission`} title={cfg.title} />
      <StepTabs step={step} />
      <section><Rich blocks={cfg.brief} /></section>
      {cfg.deliverables && <section><h3>산출물</h3><ul className="plain-list">{cfg.deliverables.map((d) => <li key={d}>{d}</li>)}</ul></section>}

      {cfg.samsungLoad && (
        <SamsungLoader mode={cfg.samsungLoad} onFill={(v) => save({ values: { ...p.values, ...v } })} />
      )}

      {cfg.fields?.map((g) => (
        <section key={g.group}>
          <h3>{g.group}</h3>
          <div className="form-grid">
            {g.items.map((f) => (
              <label key={f.id} className="field">
                <span>{f.label}</span>
                <input inputMode={f.kind === 'number' ? 'decimal' : 'text'} value={p.values[f.id] ?? ''} placeholder={f.hint} onChange={(e) => setVal(f.id, e.target.value)} />
              </label>
            ))}
          </div>
        </section>
      ))}

      {cfg.extra === 'dataset-import' && <ReadingPanel values={p.values} />}
      {cfg.extra === 'three-year' && <ThreeYearPanel />}
      {cfg.extra === 'dcf-hand-check' && <DcfCheck values={p.values} />}

      <section>
        <h3>분석 질문</h3>
        {cfg.questions.map((q) => (
          <label key={q.id} className="field">
            <span>{q.prompt}</span>
            <textarea rows={3} value={p.values[`q:${q.id}`] ?? ''} onChange={(e) => setVal(`q:${q.id}`, e.target.value)} />
          </label>
        ))}
      </section>

      <div className="row between sticky-actions">
        <span className="small muted">{p.updatedAt ? `자동 저장됨 · ${new Date(p.updatedAt).toLocaleString('ko-KR')}` : '입력하면 자동 저장됩니다.'}</span>
        <button className={`btn ${p.completed ? '' : 'primary'}`} onClick={() => save({ completed: !p.completed })}>{p.completed ? '완료 취소' : 'Practice 완료'}</button>
      </div>
    </>
  );
}

/** STEP 01: 입력값에서 바로 계산되는 읽기 보조 + 데이터셋 저장 */
function ReadingPanel({ values }: { values: Record<string, string> }) {
  const { update } = useApp();
  const [msg, setMsg] = useState('');
  const v = (k: string) => n(values[k]);
  const assets = v('assets'), liab = v('liabilities'), eq = v('equity'), rev = v('revenue'), oi = v('operatingIncome'), ni = v('netIncome'), cfo = v('cfo'), cfi = v('cfi');
  const om = operatingMargin(oi, rev);
  const record: FinancialRecord | null = values.company && v('year') ? {
    id: `${values.company}-${v('year')}-연결`, company: values.company.trim(), year: v('year')!, unit: values.unit || '', basis: '연결',
    assets, liabilities: liab, equity: eq, revenue: rev, operatingIncome: oi, netIncome: ni, cfo, cfi, cff: v('cff'),
  } : null;
  const bc = record ? balanceCheck(record) : null;

  const saveToDataset = () => {
    if (!record) return;
    update((s) => ({ ...s, dataset: [...s.dataset.filter((d) => d.id !== record.id), record] }));
    setMsg('데이터셋에 저장했습니다. (Project Build 에서 확인/보완)');
  };
  return (
    <section className="card">
      <h3>입력값 점검 (입력값으로 계산)</h3>
      <table className="fin-table"><tbody>
        <tr><th>자산 = 부채 + 자본 검증</th><td>{bc ? (bc.ok ? '일치' : `불일치 (차이 ${fmtNum(bc.diff)}) — 항목/단위 재확인`) : '—'}</td></tr>
        <tr><th>부채 비중 / 자본 비중</th><td className="num">{assets ? `${fmtPct(liab != null ? liab / assets : null)} / ${fmtPct(eq != null ? eq / assets : null)}` : '—'}</td></tr>
        <tr><th>영업이익률</th><td className="num">{fmtPct(om)}</td></tr>
        <tr><th>순이익 vs CFO</th><td className="num">{ni != null && cfo != null ? `${fmtNum(ni)} vs ${fmtNum(cfo)} (CFO − 순이익 = ${fmtNum(cfo - ni)})` : '—'}</td></tr>
        <tr><th>CFO + CFI</th><td className="num">{cfo != null && cfi != null ? fmtNum(cfo + cfi) : '—'}</td></tr>
      </tbody></table>
      <div className="row">
        <button className="btn" disabled={!record} onClick={saveToDataset}>데이터셋에 저장 (STEP 02 입력으로 사용)</button>
        {msg && <span className="small">{msg}</span>}
      </div>
    </section>
  );
}

function ThreeYearPanel() {
  const { state } = useApp();
  const companies = [...new Set(state.dataset.map((d) => d.company))];
  const [company, setCompany] = useState(companies[0] ?? '');
  const recs = state.dataset.filter((d) => d.company === (company || companies[0]));
  const m = useMemo(() => computeMetrics(recs).slice(-3), [recs]);
  if (companies.length === 0) return <div className="callout">데이터셋이 비어 있습니다. STEP 01 Project Build 에서 최근 3개년 데이터를 입력하세요.</div>;
  const rows: [string, (x: (typeof m)[number]) => string][] = [
    ['매출', (x) => fmtNum(x.revenue as number)], ['영업이익', (x) => fmtNum(x.operatingIncome as number)], ['당기순이익', (x) => fmtNum(x.netIncome as number)],
    ['영업이익률', (x) => fmtPct(x.operatingMargin)], ['ROE', (x) => fmtPct(x.roe)], ['부채비율', (x) => fmtPct(x.debtRatio)], ['CFO', (x) => fmtNum(x.cfo as number)], ['CAPEX', (x) => fmtNum(x.capex as number)],
  ];
  return (
    <section className="card">
      <div className="row between"><h3>3개년 비교 (데이터셋에서 계산)</h3>
        <select value={company || companies[0]} onChange={(e) => setCompany(e.target.value)}>{companies.map((c) => <option key={c}>{c}</option>)}</select></div>
      <div className="table-wrap"><table className="fin-table">
        <thead><tr><th></th>{m.map((x) => <th key={x.year} className="num">{x.year}</th>)}</tr></thead>
        <tbody>{rows.map(([label, f]) => <tr key={label}><th>{label}</th>{m.map((x) => <td key={x.year} className="num">{f(x)}</td>)}</tr>)}</tbody>
      </table></div>
      <p className="small muted">— 는 해당 항목이 입력되지 않았거나 계산 불가(0 나누기 등)입니다.</p>
    </section>
  );
}

function DcfCheck({ values }: { values: Record<string, string> }) {
  const [shown, setShown] = useState(false);
  const rows = forecastFcff(sampleCompany.assumptions);
  const dcf = calculateEnterpriseValue(rows.map((r) => r.fcff), sampleCompany.wacc, sampleCompany.g);
  const ref: [string, string, number][] = [
    ['1년차 EBIT', 'ebit1', rows[0].ebit], ['1년차 NOPAT', 'nopat1', rows[0].nopat], ['1년차 FCFF', 'fcff1', rows[0].fcff],
    ['3년차 FCFF', 'fcff3', rows[2].fcff], ['Terminal Value', 'tv', dcf.terminalValue], ['Enterprise Value', 'ev', dcf.enterpriseValue],
  ];
  return (
    <section className="card">
      <h3>엔진 결과와 비교</h3>
      <p className="small muted">먼저 손으로 계산해 위에 입력한 뒤 확인하세요. 할인은 기말(end-of-year) 가정, TV = FCFF₃ × (1+g) / (WACC − g) 입니다.</p>
      <button className="btn" onClick={() => setShown(true)}>비교하기</button>
      {shown && (
        <table className="fin-table">
          <thead><tr><th>항목</th><th className="num">내 값</th><th className="num">엔진</th><th className="num">차이</th></tr></thead>
          <tbody>{ref.map(([label, id, e]) => {
            const mine = n(values[id]);
            const diff = mine == null ? null : mine - e;
            return <tr key={id}><th>{label}</th><td className="num">{fmtNum(mine, 2)}</td><td className="num">{fmtNum(e, 2)}</td><td className={`num ${diff != null && Math.abs(diff) > 0.5 ? 'neg' : ''}`}>{diff == null ? '—' : fmtNum(diff, 2)}</td></tr>;
          })}</tbody>
        </table>
      )}
    </section>
  );
}

const FORM_KEYS = ['assets', 'liabilities', 'equity', 'revenue', 'operatingIncome', 'netIncome', 'cfo'] as const;

/**
 * 삼성전자 FY2023~FY2025 공시 기반 데이터를 Practice 에 불러온다 (Workspace 와 같은 fixture).
 * 직접 찾아 입력하는 것이 원칙이므로 기본은 비어 있고, 막힐 때나 검증용으로 선택해서 쓴다.
 */
function SamsungLoader({ mode, onFill }: { mode: 'form' | 'dataset'; onFill: (v: Record<string, string>) => void }) {
  const { update } = useApp();
  const records = useMemo(() => historicalToRecords(samsungHistoricalData), []);
  const [year, setYear] = useState(records[records.length - 1].year);
  const [msg, setMsg] = useState('');

  const fillForm = () => {
    const r = records.find((x) => x.year === year)!;
    const v: Record<string, string> = { company: r.company, year: String(r.year), unit: r.unit };
    for (const k of FORM_KEYS) if (r[k] != null) v[k] = String(r[k]);
    onFill(v);
    setMsg(`${r.company} FY${r.year} 값을 입력했습니다. 투자·재무활동현금흐름(CFI, CFF)은 불러올 데이터에 없어 비워 둡니다. 직접 찾아 입력하세요.`);
  };
  const loadDataset = () => {
    // 같은 id 가 이미 있으면 불러온 값으로 덮되, 사용자가 따로 입력한 항목(CFI, CFF 등)은 유지한다.
    update((s) => ({
      ...s,
      dataset: [...s.dataset.filter((d) => !records.some((r) => r.id === d.id)), ...records.map((r) => ({ ...s.dataset.find((d) => d.id === r.id), ...r }))],
    }));
    setMsg(`${records[0].company} FY${records[0].year}~FY${records[records.length - 1].year} ${records.length}개년을 데이터셋에 불러왔습니다. 아래 비교표에서 확인하세요.`);
  };

  return (
    <section className="card">
      <div className="row between">
        <h3>삼성전자 학습 데이터 불러오기</h3>
        <span className="badge badge-complete">공시 기반</span>
      </div>
      <p className="small muted">2025 사업보고서 연결재무제표 기준, 단위 백만원. 직접 찾아 입력하는 것이 원칙이며, 막힐 때나 내 값을 검증할 때 사용하세요.</p>
      <div className="row action-row">
        {mode === 'form' ? (
          <>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="불러올 연도">
              {records.map((r) => <option key={r.year} value={r.year}>FY{r.year}</option>)}
            </select>
            <button className="btn primary" onClick={fillForm}>삼성전자 데이터 불러오기</button>
          </>
        ) : (
          <button className="btn primary" onClick={loadDataset}>삼성전자 3개년 데이터 불러오기</button>
        )}
      </div>
      {msg && <div className="callout" role="status">{msg}</div>}
    </section>
  );
}
