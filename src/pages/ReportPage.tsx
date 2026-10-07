import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { AnalysisPicker, ExportCard, PreviewPane, SectionToggles, ValidationList } from '../components/report/ReportParts';
import { renderHashOf } from '../report/export/bundle.ts';
import { useProject } from '../store/project';
import { useReport } from '../store/report';

export function ReportPage() {
  const { project } = useProject();
  const r = useReport();
  const company = project.historicalData?.company ?? (project.selectedCompany ? { name: project.selectedCompany.corpName } : null);
  const g = r.generated;
  const res = g?.result;
  const validation = res?.validation ?? r.blocked;
  const warnings = validation?.warnings.length ?? 0;

  return (
    <div className="rp-page">
      <PageHeader eyebrow="Report" title="Report"
        actions={<button type="button" className="btn primary" onClick={r.generate}>{g ? 'Regenerate Report' : 'Generate Report'}</button>}>
        <p className="muted">현재 Project 상태의 snapshot 으로 Valuation Report 를 만듭니다. 숫자는 ValuFlow Engine · 분석 결과를 그대로 옮기고, AI 서술은 검증된 Grounded Claim 만 사용합니다. Report 를 만들어도 Project 가정 · 결과는 바뀌지 않습니다.</p>
      </PageHeader>

      {r.stale ? (
        <div className="rp-banner" role="status">
          <strong>Report preview is based on an older project snapshot.</strong>
          <span>생성 이후 Project 상태가 바뀌었습니다. Preview 와 Export 는 생성 당시의 snapshot({g?.result.model.metadata.snapshot.contextSnapshotId})입니다.</span>
          <button type="button" className="btn small" onClick={r.generate}>Regenerate</button>
        </div>
      ) : null}

      <div className="rp-grid">
        <aside className="rp-left" aria-label="Report settings">
          <section className="ai-card">
            <div className="panel-head"><h4>Report settings</h4></div>
            <p className="small"><strong>{company?.name ?? '기업 미선택'}</strong><br /><span className="muted">Template: valuation-standard-v1 (v1.0)</span></p>
            {!company ? <p className="small rp-error">기업이 선택되지 않았습니다. <Link to="/workspace">Workspace 로 이동</Link></p> : null}
          </section>
          <section className="ai-card"><AnalysisPicker choices={r.choices} selected={r.selectedAnalysisId} onSelect={r.select} /></section>
          <section className="ai-card"><SectionToggles hidden={r.hideOptional} onToggle={r.toggleSection} /></section>
        </aside>

        <section className="rp-center" aria-label="Preview">
          {res && g ? <PreviewPane html={res.html} /> : r.blocked ? (
            <div className="ai-card rp-empty" role="alert">
              <h3>Report 를 만들 수 없습니다 (Blocked)</h3>
              <p className="muted">필수 데이터가 없습니다. 값을 임의로 채우지 않습니다. 아래 항목을 해결한 뒤 다시 생성하세요.</p>
              <ValidationList validation={r.blocked} />
            </div>
          ) : (
            <div className="ai-card rp-empty">
              <h3>아직 생성된 Report 가 없습니다</h3>
              <p className="muted">왼쪽에서 AI 서술과 선택 section 을 고른 뒤 <strong>Generate Report</strong> 를 누르세요. 현재 Project 의 Historical · 가정 · Valuation 결과가 필요합니다 (샘플 데이터로 자동 대체하지 않습니다).</p>
            </div>
          )}
        </section>

        <aside className="rp-right" aria-label="Validation and export">
          <section className="ai-card" aria-label="Validation">
            <div className="panel-head"><h4>Validation</h4>{validation ? <span className={`chip`}>{validation.ok ? (warnings > 0 ? `${warnings} warning` : 'OK') : 'Blocked'}</span> : null}</div>
            {validation ? <ValidationList validation={validation} /> : <p className="small muted">Report 를 생성하면 검증 결과가 표시됩니다.</p>}
            {res && res.document.diagnostics.hiddenSections.length > 0 ? (
              <details className="small"><summary>제외된 section {res.document.diagnostics.hiddenSections.length}개</summary>
                <ul className="plain-list">{res.document.diagnostics.hiddenSections.map((h) => <li key={h.sectionId}><strong>{h.title}</strong>: {h.reason}</li>)}</ul></details>
            ) : null}
          </section>
          <ExportCard pdf={r.pdf} filename={res?.renderModel.meta.filename ?? null} disabled={!res} onPdf={r.downloadPdf} onHtml={r.downloadHtml} onJson={r.downloadJson}
            reportId={res?.model.metadata.reportId ?? null} renderHash={res ? renderHashOf(res.renderModel) : null} />
          {res ? (
            <section className="ai-card" aria-label="Snapshot">
              <div className="panel-head"><h4>Snapshot</h4></div>
              <dl className="stat-dl small">
                <div><dt>Context</dt><dd className="num">{res.model.metadata.snapshot.contextSnapshotId}</dd></div>
                <div><dt>Valuation</dt><dd className="num">{res.model.metadata.snapshot.valuationSnapshotId}</dd></div>
                <div><dt>Historical as of</dt><dd className="num">{res.model.metadata.snapshot.historicalAsOf?.slice(0, 10) ?? '-'}</dd></div>
                <div><dt>Market as of</dt><dd className="num">{res.model.metadata.snapshot.marketAsOf?.slice(0, 10) ?? '-'}</dd></div>
                <div><dt>Created</dt><dd className="num">{res.model.metadata.createdAt.slice(0, 19)}</dd></div>
              </dl>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
