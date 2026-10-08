import { useRef, useState } from 'react';
import { defaultFinancialRepository } from '../data/repository/defaultRepository';
import type { CompanyProfile, FinancialRepository } from '../data/repository/financialRepository';
import { companyView, errorMessage, selectCompany } from '../store/companySelection';
import { useProject } from '../store/project';
import { HistoricalLoadControls } from './HistoricalSource';

// 기업 검색 (OpenDART). 검색 → [선택] → 기업개황 표시. 재무데이터는 자동으로 불러오지 않고 [재무데이터 불러오기] 로 명시적으로 불러온다.
export function CompanySearch({ repository = defaultFinancialRepository }: { repository?: FinancialRepository }) {
  const { project, setSelectedCompany } = useProject();   // 변경 · 해제하면 이전 기업의 Historical · 가정 · 결과가 모두 초기화된다
  const selected = project.selectedCompany;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CompanyProfile[] | null>(null);
  const [busy, setBusy] = useState<'search' | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0); // 늦게 도착한 이전 응답이 최신 결과를 덮어쓰지 않게 한다

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q === '') return;
    const mine = ++seq.current;
    setBusy('search');
    setError(null);
    try {
      const found = await repository.searchCompanies(q);
      if (mine === seq.current) setResults(found);
    } catch (err) {
      if (mine === seq.current) { setResults(null); setError(errorMessage(err)); }
    } finally {
      if (mine === seq.current) setBusy(null);
    }
  };

  const choose = async (c: CompanyProfile) => {
    setBusy(c.corpCode ?? 'select');
    setError(null);
    const r = await selectCompany(repository, c);
    setBusy(null);
    if (r.ok) { setSelectedCompany(r.company); setResults(null); }   // 선택하면 후보 목록을 닫고 선택한 기업과 [재무데이터 불러오기] 만 보여 준다
    else setError(r.message);
  };

  const view = selected ? companyView(selected) : null;

  return (
    <section className="panel company-search" aria-label="기업 검색">
      <form className="row company-form" onSubmit={search} role="search">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="기업명 또는 종목코드 (예: 삼성전자, 005930)" aria-label="기업명 또는 종목코드" />
        <button className="btn primary" type="submit" disabled={busy === 'search' || query.trim() === ''}>{busy === 'search' ? '검색 중…' : 'OpenDART 기업 검색'}</button>
      </form>
      {error && <div className="callout neg" role="alert">{error}</div>}

      {results !== null && (
        results.length === 0
          ? <p className="hint">검색 결과가 없습니다.</p>
          : (
            <ul className="company-results" aria-label="검색 결과">
              {results.map((c) => (
                <li key={c.corpCode}>
                  <div><strong>{c.name}</strong><span className="small muted">{c.stockCode ?? '비상장'} · {c.corpCode}</span></div>
                  <button className="btn" onClick={() => choose(c)} disabled={busy !== null} aria-label={`${c.name} 선택`}>
                    {busy === c.corpCode ? '조회 중…' : selected?.corpCode === c.corpCode ? '선택됨' : '선택'}
                  </button>
                </li>
              ))}
            </ul>
          )
      )}

      {view && (
        <div className="company-selected" aria-label="선택한 기업">
          <div className="row between"><h4>{view.title}</h4><button type="button" className="btn small" onClick={() => { setSelectedCompany(null); setResults(null); }}>기업 선택 해제</button></div>
          <details className="company-profile">
            <summary>기업 개황</summary>
            <dl className="stat-dl">{view.lines.map((l) => <div key={l.label}><dt>{l.label}</dt><dd className="num">{l.value}</dd></div>)}</dl>
          </details>
          <HistoricalLoadControls compact />
        </div>
      )}
    </section>
  );
}
