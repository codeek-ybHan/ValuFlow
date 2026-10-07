import { useProject } from '../store/project';
import { UNSUPPORTED_UX, provenanceView, type HistoricalFailure } from '../store/historicalLoad';
import { buildQualityView } from '../engine/qualityView';
import type { HistoricalData, HistoricalProvenance, DataQuality } from '../data/types';

// Historical 의 출처 · 불러오기 상태 · 데이터 품질 표시. 계산은 하지 않고 store / engine 의 결과를 렌더링한다.

const FAILURE_TITLE: Record<HistoricalFailure['kind'], string> = {
  unsupported: 'Unsupported', incomplete: 'Incomplete', unavailable: 'Unavailable', 'not-found': 'Not found',
};

/** 불러오기 실패. unsupported / incomplete / unavailable 를 구분해서 보여 준다. 빈 chart 나 0 값은 만들지 않는다. */
export function HistoricalFailureNotice({ failure }: { failure: HistoricalFailure }) {
  return (
    <div className={`callout ${failure.kind === 'unsupported' ? '' : 'neg'}`} role="alert" data-kind={failure.kind}>
      <strong>{FAILURE_TITLE[failure.kind]}</strong>
      {failure.kind === 'unsupported' ? (
        <>
          <p>{UNSUPPORTED_UX.title}</p>
          <p className="small">사유: {failure.message}</p>
          <p className="small muted">{UNSUPPORTED_UX.scope}</p>
        </>
      ) : (
        <p>{failure.message}</p>
      )}
    </div>
  );
}

/** [재무데이터 불러오기] / [데이터 새로고침] 과 상태 표시 (Loading / Historical loaded / 실패). */
export function HistoricalLoadControls({ compact = false }: { compact?: boolean }) {
  const { project, historicalStatus, loadHistorical, removeHistorical } = useProject();
  const company = project.selectedCompany;
  const p = project.historicalProvenance;
  const loading = historicalStatus.kind === 'loading';
  const actual = !!p && p.source !== 'fixture';
  if (!company) return <p className="small muted">기업을 검색해 선택하면 실제 재무데이터를 불러올 수 있습니다.</p>;
  return (
    <div className="hist-load" aria-label="재무데이터 불러오기">
      <div className="row action-row">
        <button className="btn primary" onClick={() => loadHistorical()} disabled={loading}>{loading && !historicalStatus.refresh ? 'Loading financial data...' : '재무데이터 불러오기'}</button>
        {actual && !compact && (
          <button className="btn" onClick={() => loadHistorical({ refresh: true })} disabled={loading} title="저장된 값을 건너뛰고 OpenDART 를 다시 조회합니다. 실패해도 기존 데이터는 유지됩니다.">
            {loading && historicalStatus.refresh ? 'Refreshing...' : '데이터 새로고침'}
          </button>
        )}
        {project.historicalData && !compact && <button className="btn" onClick={removeHistorical}>Historical 제거</button>}
      </div>
      {loading && <p className="small muted" role="status">Loading financial data...</p>}
      {!loading && actual && project.historicalData && historicalStatus.kind !== 'failed' && (
        <p className="small" role="status">
          Historical loaded · Source: {provenanceView(project.historicalData, p).sourceLabel}
          {p?.fetchedAt ? ` · Fetched at: ${p.fetchedAt}` : ''} · Persisted: {p?.persisted ? 'Yes' : 'No'}
        </p>
      )}
      {historicalStatus.kind === 'failed' && <HistoricalFailureNotice failure={historicalStatus.failure} />}
      {historicalStatus.kind === 'failed' && project.historicalData && (
        <p className="hint">기존 Historical 데이터는 유지됩니다 ({provenanceView(project.historicalData, p).sourceLabel}).</p>
      )}
    </div>
  );
}

/** Company / Basis / Source / Fetched at / Periods / Persisted */
export function ProvenanceList({ h, provenance }: { h: HistoricalData; provenance: HistoricalProvenance | null }) {
  const v = provenanceView(h, provenance);
  return <dl className="status-grid" aria-label="출처">{v.lines.map((l) => <div key={l.label}><dt>{l.label}</dt><dd className="num">{l.value}</dd></div>)}</dl>;
}

const STATUS_CLASS: Record<string, string> = { available: '', ambiguous: 'warn', partial: 'warn', missing: 'muted' };

/** 데이터 품질: 검토 필요 / 데이터 노트, 필드 상태, 대표 계정의 출처 보기. 오류가 아니라 참고 수준으로 표현한다. */
export function DataQualityPanel({ quality }: { quality: DataQuality | null }) {
  const view = buildQualityView(quality);
  if (!view) return <p className="hint">학습용 fixture 는 계정 매핑 정보가 없어 데이터 품질 상세를 제공하지 않습니다.</p>;
  const review = view.notes.filter((n) => n.level === 'review');
  const notes = view.notes.filter((n) => n.level === 'note');
  return (
    <section className="panel dq-panel" aria-label="데이터 품질">
      <div className="panel-head"><h3>Data Quality</h3><span className="small muted">Basis: {view.basisLine}</span></div>
      {review.length > 0 && (
        <div className="callout" role="note" data-level="review">
          <strong>Review Required</strong>
          <ul className="plain-list small">{review.map((n) => <li key={n.text}>{n.text}</li>)}</ul>
        </div>
      )}
      {notes.length > 0 && (
        <div className="dq-notes" data-level="note">
          <strong className="small">Data Note</strong>
          <ul className="plain-list small muted">{notes.map((n) => <li key={n.text}>{n.text}</li>)}</ul>
        </div>
      )}
      <ul className="dq-fields" aria-label="필드별 상태">
        {view.fields.map((f) => <li key={f.field} className={STATUS_CLASS[f.status]}><span>{f.label}</span><span className="chip">{f.status}</span></li>)}
      </ul>
      <details className="dq-sources">
        <summary>출처 보기 (Mapping Trace)</summary>
        <table className="fin-table">
          <thead><tr><th>Field</th><th>Source account</th><th>Account ID</th><th>Match</th><th>Basis</th><th>Status</th></tr></thead>
          <tbody>
            {view.sources.map((s) => (
              <tr key={s.field}>
                <th>{s.label}{s.fiscalYear ? <span className="muted small"> {s.fiscalYear}</span> : null}</th>
                <td>{s.accountName ?? '—'}{s.components.length > 1 && <small className="helper">{s.components.map((c) => c.accountName).join(' + ')}</small>}{s.detail && <small className="helper">{s.detail}</small>}</td>
                <td className="small">{s.accountId ?? '—'}</td>
                <td>{s.matchType ?? '—'}</td>
                <td>{s.basis ?? '—'}</td>
                <td>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Match: account-id(표준 계정 ID) → exact-name → alias → weak 순으로 신뢰도가 낮아집니다. 값이 없으면 추정하지 않고 missing 으로 둡니다.</p>
      </details>
    </section>
  );
}
