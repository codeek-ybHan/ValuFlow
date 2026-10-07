import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { REPORT_CSS } from '../../report/render/html.ts';
import { OPTIONAL_SECTIONS, downloadNames, validationMessages, type AnalysisChoice, type PdfStatus } from '../../report/ui/model.ts';
import type { SectionId } from '../../report/templates/types.ts';
import type { ReportValidation } from '../../report/validation/validate.ts';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Report 에 포함할 AI 분석 선택: 기본은 같은 snapshot 의 최근 Deep Analysis, stale 분석은 표시하되 자동 선택하지 않는다. */
export function AnalysisPicker({ choices, selected, onSelect }: { choices: AnalysisChoice[]; selected: string | null; onSelect: (id: string | null) => void }) {
  return (
    <fieldset className="rp-fieldset">
      <legend>AI Narrative</legend>
      <label className="rp-radio"><input type="radio" name="analysis" checked={selected === null} onChange={() => onSelect(null)} /><span><strong>AI 서술 없음</strong><small>숫자 · 표 · 차트 중심 (deterministic)</small></span></label>
      {choices.map((c) => (
        <label key={c.id} className="rp-radio">
          <input type="radio" name="analysis" checked={selected === c.id} onChange={() => onSelect(c.id)} />
          <span>
            <strong>{c.question}</strong>
            <small>{c.workflowLabel} · {fmtTime(c.askedAt)} · claim {c.supported}/{c.claims} supported{c.source === 'saved' ? ' · 저장됨' : ''}</small>
            <small className={`rp-fresh rp-${c.freshness}`}>{c.freshness === 'current' ? 'Current project snapshot' : 'Stale: 이전 Project 상태 기준 — Report 서술에서 제외됩니다'}</small>
          </span>
        </label>
      ))}
      {choices.length === 0 ? <p className="small muted">Deep Analysis 결과가 없습니다. AI Analyst 에서 분석을 실행하면 여기서 선택할 수 있습니다.</p> : null}
    </fieldset>
  );
}

export function SectionToggles({ hidden, onToggle }: { hidden: SectionId[]; onToggle: (id: SectionId) => void }) {
  return (
    <fieldset className="rp-fieldset">
      <legend>Sections</legend>
      <p className="small muted">필수 section(Cover · Executive Summary · Historical · Forecast · WACC · DCF · Conclusion · Sources · Appendix)은 숨길 수 없습니다.</p>
      {OPTIONAL_SECTIONS.map((s) => (
        <label key={s.id} className="rp-check"><input type="checkbox" checked={!hidden.includes(s.id)} onChange={() => onToggle(s.id)} />{s.label}<small>(데이터가 없으면 자동으로 제외)</small></label>
      ))}
    </fieldset>
  );
}

export function ValidationList({ validation }: { validation: ReportValidation }) {
  const msgs = validationMessages(validation);
  if (msgs.length === 0) return <p className="small muted">검증 문제가 없습니다.</p>;
  return (
    <ul className="rp-issues">
      {msgs.map((m, i) => (
        <li key={`${m.code}-${i}`} className={`rp-issue rp-${m.severity}`}>
          <span className="rp-sev">{m.severity === 'error' ? 'Blocked' : 'Warning'}</span>
          <span>{m.text}{m.to ? <> <Link to={m.to}>{m.action}</Link></> : null}</span>
        </li>
      ))}
    </ul>
  );
}

export function ExportCard({ pdf, filename, disabled, onPdf, onHtml, onJson, reportId, renderHash }: { pdf: PdfStatus; filename: string | null; disabled: boolean; onPdf: () => void; onHtml: () => void; onJson: () => void; reportId: string | null; renderHash: string | null }) {
  const names = filename ? downloadNames(filename) : null;
  return (
    <section className="ai-card rp-export" aria-label="Export">
      <div className="panel-head"><h4>Export</h4></div>
      <button type="button" className="btn primary block" disabled={disabled || pdf.status === 'generating'} onClick={onPdf}>{pdf.status === 'generating' ? 'PDF 생성 중…' : 'Download PDF'}</button>
      <div className="row action-row">
        <button type="button" className="btn small" disabled={disabled} onClick={onHtml}>HTML</button>
        <button type="button" className="btn small" disabled={disabled} onClick={onJson}>JSON snapshot</button>
      </div>
      {names ? <p className="small muted">{names.pdf}</p> : <p className="small muted">Report 를 생성하면 내보낼 수 있습니다.</p>}
      {pdf.status === 'ready' ? <p className="small" role="status">PDF 를 내려받았습니다{pdf.pages ? ` (${pdf.pages}쪽)` : ''}. Preview 와 같은 Report({pdf.reportId})입니다.{pdf.font === 'cid-fallback' ? ' 서버에 한글 폰트가 없어 대체 폰트를 썼습니다.' : ''}</p> : null}
      {pdf.status === 'error' ? <p className="small rp-error" role="alert">{pdf.message} <button type="button" className="link" onClick={onPdf}>다시 시도</button></p> : null}
      {reportId ? <p className="small muted">report {reportId}{renderHash ? ` · render ${renderHash}` : ''}</p> : null}
    </section>
  );
}

/** Preview: ReportDocument 에서 만든 HTML(RenderModel)을 그대로 넣는다. footnote marker 를 누르면 Sources 의 해당 출처를 강조한다. */
export function PreviewPane({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[data-marker]') as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      el.querySelectorAll('.sources li.hl').forEach((x) => x.classList.remove('hl'));
      const target = el.querySelector(`#src-${CSS.escape(a.dataset.marker ?? '')}`);
      if (target) { target.classList.add('hl'); target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [html]);
  return (
    <div className="rp-paper" ref={ref} aria-label="Report preview">
      <style>{REPORT_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
