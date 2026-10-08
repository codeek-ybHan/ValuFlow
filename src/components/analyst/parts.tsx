import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  APPLY_UNSUPPORTED_NOTICE, CONFIDENCE_INFO, GROUNDING_INFO, MODE_INFO, STATUS_INFO, effectiveStatus,
  type AnalystTurn, type CheckpointDecision, type CheckpointView, type ClaimView, type EvidenceView, type SourceView, type StepView, type TimeBasisView, type WaccPanelView, type WarningView,
} from '../../ai/analyst/view.ts';

/** 출처 종류 배지: 색에만 의존하지 않도록 항상 글자를 쓴다. */
export const SourceBadge = ({ id, label }: { id: string; label: string }) => <span className={`src-badge src-${id}`}>{label}</span>;

export function ReliabilityTag({ r }: { r: { label: string; note: string } | null }) {
  return r ? <span className="rel-tag" title={r.note}>{r.label}</span> : null;
}

/** High / Medium / Low: 색 + 기호 + 글자. 설명은 tooltip(title)과 스크린리더 텍스트로 제공한다. */
export function ConfidenceBadge({ level, notes = [] }: { level: ClaimView['confidence']; notes?: string[] }) {
  if (!level) return <span className="conf conf-none">Confidence —</span>;
  const c = CONFIDENCE_INFO[level];
  const tip = notes.length > 0 ? `${c.tip} (${notes.join('; ')})` : c.tip;
  return <span className={`conf conf-${level}`} title={tip}><span aria-hidden>{c.glyph}</span> {c.label} Confidence<span className="sr-only">. {tip}</span></span>;
}

export function StatusBanner({ turn }: { turn: AnalystTurn }) {
  const st = effectiveStatus(turn);
  const info = STATUS_INFO[st];
  const detail = turn.error ? `${turn.error.title}${turn.error.detail ? ` — ${turn.error.detail}` : ''}` : info.detail;
  return (
    <div className={`ai-status ai-status-${st}`} role={st === 'failed' ? 'alert' : 'status'}>
      <strong>{info.label}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function ModeBadge({ turn }: { turn: Pick<AnalystTurn, 'mode' | 'workflowLabel'> }) {
  const m = MODE_INFO[turn.mode];
  return <span className="chip" title={`${m.note} (Grounding: ${m.grounding})`}>{m.name}{turn.workflowLabel ? ` · ${turn.workflowLabel}` : ''}</span>;
}

const STEP_MARK: Record<string, string> = { completed: '✓', running: '●', pending: '○', skipped: '–', failed: '✕', 'waiting-for-user': '⏸' };
const STEP_TEXT: Record<string, string> = { completed: 'completed', running: 'running', pending: 'pending', skipped: 'skipped', failed: 'failed', 'waiting-for-user': 'waiting for you' };

/** Workflow 진행: 무엇을 확인 중인지만 보여 준다 (내부 추론 · 가짜 진행률 없음). */
export function WorkflowProgress({ title, steps }: { title: string | null; steps: StepView[] }) {
  return (
    <ol className="wf-steps" aria-label={title ? `${title} 진행 단계` : '진행 단계'}>
      {steps.map((s) => (
        <li key={s.id} className={`wf-step wf-${s.status}`}>
          <span className="wf-mark" aria-hidden>{STEP_MARK[s.status]}</span>
          <span className="wf-label">{s.label}{s.optional ? <em> (선택)</em> : null}</span>
          <span className="wf-state">{STEP_TEXT[s.status]}</span>
          {s.reason && (s.status === 'skipped' || s.status === 'failed') ? <span className="wf-reason small muted">{s.reason}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function ClaimCard({ claim, selected, onSelect }: { claim: ClaimView; selected: boolean; onSelect: () => void }) {
  const fact = claim.kind === 'fact';
  return (
    <button type="button" className={`claim ${fact ? 'claim-fact' : 'claim-judgment'}${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <span className="claim-tag">{fact ? 'FACT' : 'JUDGMENT'}</span>
      <span className="claim-text">{claim.text}</span>
      <span className="claim-meta">
        <span className="claim-type">{claim.typeLabel}</span>
        <span className={`claim-status st-${claim.status}`}>{claim.statusLabel}</span>
        <ConfidenceBadge level={claim.confidence} notes={claim.notes} />
        <span className="small muted">Evidence {claim.evidenceCount}</span>
      </span>
    </button>
  );
}

const DOC_BADGES = new Set(['disclosure', 'upload', 'news']);

export function EvidenceCard({ e }: { e: EvidenceView }) {
  return (
    <li className="ev">
      <div className="ev-head"><SourceBadge id={e.badge} label={e.badgeLabel} />{e.kindLabel ? <span className="small muted">{e.kindLabel}</span> : null}<ReliabilityTag r={e.reliability} /></div>
      <dl className="ev-dl">
        <div><dt>Source</dt><dd>{e.sourceLabel}</dd></div>
        {e.badge === 'upload' && e.filename ? <div><dt>File</dt><dd>{e.filename}</dd></div> : null}
        {DOC_BADGES.has(e.badge) ? null : <div><dt>Field</dt><dd>{e.field}{e.period ? ` · ${e.period}` : ''}</dd></div>}
        {e.missing ? <div><dt>Value</dt><dd className="empty">값 없음 (Missing)</dd></div> : e.valueText ? <div><dt>Value</dt><dd className="num">{e.valueText}</dd></div> : null}
        {e.asOf ? <div><dt>As of</dt><dd className="num">{e.asOf}</dd></div> : null}
        {e.section ? <div><dt>Section</dt><dd>{e.section}</dd></div> : null}
        {e.page != null ? <div><dt>Page</dt><dd className="num">p.{e.page}</dd></div> : null}
        {e.quality ? <div><dt>Data quality</dt><dd>{e.quality}</dd></div> : null}
      </dl>
      {e.excerpt ? <details open={e.badge === 'upload'}><summary>발췌 보기</summary><p className="ev-excerpt">{e.excerpt}</p></details> : null}
      {e.url ? <a className="small" href={e.url} target="_blank" rel="noreferrer noopener">원문 열기</a> : null}
    </li>
  );
}

const SOURCE_PREVIEW = 4;

export function SourceList({ sources }: { sources: SourceView[] }) {
  const [all, setAll] = useState(false);
  if (sources.length === 0) return <p className="small muted">이 답변에 기록된 출처가 없습니다.</p>;
  const shown = all ? sources : sources.slice(0, SOURCE_PREVIEW);
  return (
    <>
    <ul className="src-list">
      {shown.map((s) => (
        <li key={s.key}>
          <div className="ev-head"><SourceBadge id={s.badge} label={s.badgeLabel} />{s.kindLabel ? <span className="small muted">{s.kindLabel}</span> : null}<ReliabilityTag r={s.reliability} /></div>
          <div className="src-title">{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> : s.title}</div>
          {s.lines.length > 0 ? <div className="small muted">{s.lines.join(' · ')}</div> : null}
          {s.asOf ? <div className="small muted">As of {s.asOf}</div> : null}
        </li>
      ))}
    </ul>
    {sources.length > SOURCE_PREVIEW ? <button type="button" className="link" onClick={() => setAll((v) => !v)}>{all ? '접기' : `출처 ${sources.length}건 모두 보기`}</button> : null}
    </>
  );
}

export function TimeBasis({ basis }: { basis: TimeBasisView | null }) {
  if (!basis) return <p className="small muted">기준 시점 정보가 없습니다.</p>;
  return (
    <div>
      <dl className="stat-dl">
        {basis.historical ? <div><dt>Historical</dt><dd className="num">{basis.historical}</dd></div> : null}
        {basis.market ? <div><dt>Market</dt><dd className="num">{basis.market}</dd></div> : null}
        {basis.news ? <div><dt>News</dt><dd className="num">{basis.news}</dd></div> : null}
      </dl>
      {basis.notice ? <p className="small ai-note">{basis.notice}</p> : null}
    </div>
  );
}

const WARNING_LABEL: Record<WarningView['kind'], string> = { data: 'Data', provider: 'Provider', 'partial-failure': 'Partial failure', retrieval: 'Retrieval', time: 'Time basis', unsupported: 'Unsupported' };

export function WarningList({ warnings }: { warnings: WarningView[] }) {
  if (warnings.length === 0) return <p className="small muted">표시할 경고가 없습니다.</p>;
  return <ul className="warn-list">{warnings.map((w, i) => <li key={`${w.kind}-${i}`}><span className="warn-kind">{WARNING_LABEL[w.kind]}</span>{w.text}</li>)}</ul>;
}

export function WaccPanel({ wacc }: { wacc: WaccPanelView }) {
  return (
    <section className="ai-card wacc-panel" aria-label="WACC 와 구성요소">
      <div className="wacc-main"><span className="small muted">WACC (결과)</span><strong className="num">{wacc.wacc ?? '미계산'}</strong></div>
      <div>
        <div className="small muted">Components (입력 가정)</div>
        <dl className="wacc-comp">{wacc.components.map((c) => <div key={c.label}><dt>{c.label}</dt><dd className="num">{c.value}</dd></div>)}</dl>
      </div>
    </section>
  );
}

/** Human checkpoint: 이번 단계는 read-only 검토다. 어떤 버튼도 Project 값을 바꾸지 않는다. */
export function CheckpointCard({ cp, onDecide }: { cp: CheckpointView; onDecide: (d: CheckpointDecision) => void }) {
  const decided = cp.decision !== 'pending';
  return (
    <section className="ai-card checkpoint" aria-label={cp.title}>
      <h4>{cp.title}</h4>
      <dl className="stat-dl">
        <div><dt>Target</dt><dd>{cp.target}</dd></div>
        <div><dt>Current</dt><dd className="num">{cp.currentValue ?? '—'}</dd></div>
        <div><dt>Suggested</dt><dd className="num">{cp.proposedValue ?? '—'}</dd></div>
      </dl>
      <p className="small">{cp.rationale}</p>
      {cp.note ? <p className="small ai-note">{cp.note}</p> : null}
      {decided ? (
        <p className="small" role="status">
          {cp.decision === 'keep' ? '현재 값을 유지하기로 기록했습니다.' : cp.decision === 'later' ? '나중에 검토하기로 기록했습니다.' : APPLY_UNSUPPORTED_NOTICE}
          {cp.decision === 'later' ? <button type="button" className="link" onClick={() => onDecide('pending')}>다시 열기</button> : null}
        </p>
      ) : (
        <div className="row action-row">
          <button type="button" className="btn small" onClick={() => onDecide('keep')}>Keep Current</button>
          <button type="button" className="btn small" onClick={() => onDecide('later')}>Review Later</button>
          <button type="button" className="btn small primary" onClick={() => onDecide('continue')}>Apply / Continue</button>
        </div>
      )}
      <p className="small muted">검토 상태만 기록합니다. Project 가정과 결과는 바뀌지 않습니다.</p>
    </section>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="ai-sec"><h3>{title}</h3>{children}</section>;
}

export function GroundingLine({ turn, debug }: { turn: AnalystTurn; debug: boolean }) {
  if (!turn.grounding && turn.mode === 'quick') return <p className="small muted">Quick Answer: Tool 결과를 바탕으로 한 답변입니다. 문장별 근거 검증은 Deep Analysis 에서 제공됩니다.</p>;
  if (!turn.grounding) return null;
  const g = GROUNDING_INFO[turn.grounding];
  const d = turn.debug;
  return (
    <div className="grounding-line">
      <span className={`ground ground-${turn.grounding}`} title={g.detail}>{g.label}</span>
      <span className="small muted">AI 답변은 자동으로 검증되었습니다.</span>
      {debug && d ? (
        <details open className="small debug">
          <summary>Debug · grounding</summary>
          <ul>
            <li>coverage {d.coverage ?? '—'} (first pass {d.firstPassCoverage ?? '—'})</li>
            <li>supported claims {d.supported} / {d.claims} · unsupported {d.unsupported}</li>
            <li>regenerated {String(d.regenerated)} · fallback {String(d.fallback)}</li>
            {d.violations.length > 0 ? <li>violations {d.violations.join(', ')}</li> : null}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export const BackToWorkspace = ({ to, children }: { to: string; children: ReactNode }) => <Link className="btn small" to={to}>{children}</Link>;
