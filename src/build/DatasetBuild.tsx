import { useState } from 'react';
import { useApp } from '../store/state';
import { balanceCheck } from '../engine/analysis';
import { fmtNum } from '../components/ui';
import type { FinancialRecord } from '../types';

type NumKey = 'assets' | 'liabilities' | 'equity' | 'revenue' | 'operatingIncome' | 'netIncome' | 'cfo' | 'cfi' | 'cff'
  | 'grossProfit' | 'currentAssets' | 'currentLiabilities' | 'receivables' | 'inventory' | 'payables' | 'da' | 'capex' | 'cash' | 'debt';

const CORE: { k: NumKey; label: string }[] = [
  { k: 'assets', label: '자산총계' }, { k: 'liabilities', label: '부채총계' }, { k: 'equity', label: '자본총계' },
  { k: 'revenue', label: '매출액' }, { k: 'operatingIncome', label: '영업이익' }, { k: 'netIncome', label: '당기순이익' },
  { k: 'cfo', label: '영업활동현금흐름' }, { k: 'cfi', label: '투자활동현금흐름' }, { k: 'cff', label: '재무활동현금흐름' },
];
const EXTRA: { k: NumKey; label: string }[] = [
  { k: 'grossProfit', label: '매출총이익' }, { k: 'currentAssets', label: '유동자산' }, { k: 'currentLiabilities', label: '유동부채' },
  { k: 'receivables', label: '매출채권' }, { k: 'inventory', label: '재고자산' }, { k: 'payables', label: '매입채무' },
  { k: 'da', label: '감가상각비(D&A)' }, { k: 'capex', label: 'CAPEX (양수)' }, { k: 'cash', label: '현금및현금성자산' }, { k: 'debt', label: '이자부부채' },
];

const emptyForm = { company: '', year: '', unit: '백만원', basis: '연결' as '연결' | '별도', nums: {} as Record<string, string> };

export function DatasetBuild() {
  const { state, update } = useApp();
  const [f, setF] = useState(emptyForm);
  const [err, setErr] = useState('');

  const submit = () => {
    const year = Number(f.year);
    if (!f.company.trim() || !Number.isInteger(year) || year < 1990 || year > 2100) return setErr('기업명과 올바른 기준연도(예: 2024)가 필요합니다.');
    const rec: FinancialRecord = { id: `${f.company.trim()}-${year}-${f.basis}`, company: f.company.trim(), year, unit: f.unit.trim(), basis: f.basis };
    for (const { k } of [...CORE, ...EXTRA]) {
      const raw = (f.nums[k] ?? '').replace(/,/g, '').trim();
      if (raw === '') continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) return setErr(`숫자가 아닌 값이 있습니다: ${k}`);
      (rec as unknown as Record<string, number>)[k] = num;
    }
    setErr('');
    update((s) => ({ ...s, dataset: [...s.dataset.filter((d) => d.id !== rec.id), rec] }));
    setF({ ...emptyForm, company: f.company, unit: f.unit, basis: f.basis });
  };

  const edit = (r: FinancialRecord) =>
    setF({ company: r.company, year: String(r.year), unit: r.unit, basis: r.basis, nums: Object.fromEntries([...CORE, ...EXTRA].filter(({ k }) => r[k] != null).map(({ k }) => [k, String(r[k])])) });
  const remove = (id: string) => update((s) => ({ ...s, dataset: s.dataset.filter((d) => d.id !== id) }));

  const sorted = [...state.dataset].sort((a, b) => a.company.localeCompare(b.company) || b.year - a.year);
  const draftBalance = balanceCheck({ id: '', company: '', year: 0, unit: '', basis: '연결', assets: Number(f.nums.assets), liabilities: Number(f.nums.liabilities), equity: Number(f.nums.equity) });

  return (
    <>
      <div className="card">
        <h3>재무데이터 입력</h3>
        <div className="form-grid">
          <label className="field"><span>기업명</span><input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="삼성전자" /></label>
          <label className="field"><span>기준연도</span><input inputMode="numeric" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></label>
          <label className="field"><span>단위</span><input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></label>
          <label className="field"><span>연결/별도</span>
            <select value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as '연결' | '별도' })}><option>연결</option><option>별도</option></select></label>
        </div>
        <h4>핵심 9개 항목 (STEP 01)</h4>
        <div className="form-grid">{CORE.map(({ k, label }) => <NumField key={k} label={label} value={f.nums[k] ?? ''} onChange={(v) => setF({ ...f, nums: { ...f.nums, [k]: v } })} />)}</div>
        {draftBalance && <p className={`small ${draftBalance.ok ? '' : 'neg'}`}>{draftBalance.ok ? '자산 = 부채 + 자본 일치' : `자산 − (부채 + 자본) = ${fmtNum(draftBalance.diff)} — 입력값/단위를 확인하세요`}</p>}
        <details>
          <summary>추가 항목 (STEP 02~03 분석에 사용, 선택)</summary>
          <div className="form-grid">{EXTRA.map(({ k, label }) => <NumField key={k} label={label} value={f.nums[k] ?? ''} onChange={(v) => setF({ ...f, nums: { ...f.nums, [k]: v } })} />)}</div>
        </details>
        {err && <p className="neg small">{err}</p>}
        <div className="row"><button className="btn primary" onClick={submit}>저장</button><button className="btn" onClick={() => setF(emptyForm)}>초기화</button></div>
        <p className="small muted">같은 기업·연도·기준은 덮어씁니다. 데이터는 이 브라우저에만 저장됩니다.</p>
      </div>

      <h3>저장된 데이터 ({sorted.length})</h3>
      {sorted.length === 0 ? <p className="muted">아직 저장된 데이터가 없습니다.</p> : (
        <div className="table-wrap"><table className="fin-table">
          <thead><tr><th>기업</th><th>연도</th><th>기준</th><th>단위</th>{CORE.map((c) => <th key={c.k} className="num">{c.label}</th>)}<th></th></tr></thead>
          <tbody>{sorted.map((r) => (
            <tr key={r.id}><td>{r.company}</td><td className="num">{r.year}</td><td>{r.basis}</td><td>{r.unit}</td>
              {CORE.map((c) => <td key={c.k} className="num">{fmtNum(r[c.k])}</td>)}
              <td className="nowrap"><button className="link" onClick={() => edit(r)}>수정</button> <button className="link" onClick={() => remove(r.id)}>삭제</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="field"><span>{label}</span><input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
