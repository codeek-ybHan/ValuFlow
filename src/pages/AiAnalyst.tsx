import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { NoCompanyState, PageHeader } from '../components/ui';
import { buildAiContext } from '../ai/context.ts';
import { snapshotId } from '../ai/agent/run.ts';
import { resolveMode } from '../ai/analyst/ask.ts';
import { isStale } from '../ai/analyst/session.ts';
import { EXAMPLE_QUESTIONS, MODE_INFO, STATUS_INFO, effectiveStatus, readiness, type AnalystTurn, type ClaimView, type ModePreference } from '../ai/analyst/view.ts';
import { useAnalyst } from '../store/analyst';
import { useProject } from '../store/project';
import { KnowledgePanel, useKnowledge } from '../components/analyst/KnowledgePanel';
import {
  CheckpointCard, ClaimCard, EvidenceCard, GroundingLine, ModeBadge, Section, SourceList, StatusBanner, TimeBasis, WaccPanel, WarningList, WorkflowProgress,
} from '../components/analyst/parts';

const PREFS: { id: ModePreference; label: string }[] = [{ id: 'auto', label: '자동' }, { id: 'quick', label: 'Quick Answer' }, { id: 'workflow', label: 'Deep Analysis' }];
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

function Answer({ turn, selected, onSelect, debug, onDecide }: { turn: AnalystTurn; selected: string | null; onSelect: (id: string) => void; debug: boolean; onDecide: ReturnType<typeof useAnalyst>['decide'] }) {
  const a = turn.answer;
  const claims = (list: ClaimView[]) => <div className="claims">{list.map((c) => <ClaimCard key={c.id} claim={c} selected={selected === c.id} onSelect={() => onSelect(c.id)} />)}</div>;
  const partial = turn.warnings.find((w) => w.kind === 'partial-failure');
  return (
    <article className="ai-answer" aria-label="분석 답변">
      <StatusBanner turn={turn} />
      {partial ? <p className="ai-note" role="status">{partial.text}</p> : null}
      {a ? (
        <>
          <Section title="Summary"><p className="ai-summary">{a.summary}</p></Section>
          {a.keyFindings.length > 0 ? <Section title="Key Findings">{claims(a.keyFindings)}</Section> : null}
          {a.plainEvidence.length > 0 ? (
            <Section title="Key Data">
              <ul className="plain-ev">{a.plainEvidence.map((e, i) => <li key={`${e.label}-${i}`}><span>{e.label}{e.period ? ` (${e.period})` : ''}</span><strong className="num">{e.value}</strong><span className="small muted">{e.tool}</span></li>)}</ul>
            </Section>
          ) : null}
          {a.interpretation.length > 0 ? <Section title="Interpretation">{claims(a.interpretation)}</Section> : null}
          {a.considerations.length > 0 ? <Section title="Risks / Considerations">{claims(a.considerations)}</Section> : null}
          {a.judgmentItems.length > 0 ? <Section title="Needs your judgment"><ul className="plain-list">{a.judgmentItems.map((x) => <li key={x}>{x}</li>)}</ul></Section> : null}
          {a.limitations.length > 0 ? <Section title="Limitations"><ul className="plain-list">{a.limitations.map((x) => <li key={x}>{x}</li>)}</ul></Section> : null}
          {a.nextActions.length > 0 ? <Section title="Next"><ul className="plain-list">{a.nextActions.map((x) => <li key={x}>{x}</li>)}</ul></Section> : null}
        </>
      ) : null}
      {turn.wacc ? <WaccPanel wacc={turn.wacc} /> : null}
      {turn.checkpoints.map((cp) => <CheckpointCard key={cp.id} cp={cp} onDecide={(d) => onDecide(turn.id, cp.id, d)} />)}
      <GroundingLine turn={turn} debug={debug} />
    </article>
  );
}

/** 기업을 선택하기 전에는 질문 · 기록 · 문서 영역 없이 빈 상태만 보여 준다 (실행 불가). */
export function AiAnalyst() {
  const { project } = useProject();
  if (!project.selectedCompany) return <div className="ai-page"><PageHeader title="AI Analyst" /><NoCompanyState /></div>;
  return <AiAnalystView />;
}

function AiAnalystView() {
  const { project, historicalStatus } = useProject();
  const { session, active, running, preference, setPreference, ask, cancel, select, decide } = useAnalyst();
  const kn = useKnowledge();
  const [question, setQuestion] = useState('');
  const [selectedClaim, setSelectedClaim] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [debug, setDebug] = useState(false);

  const ctx = useMemo(() => buildAiContext(project, { historicalStatus }), [project, historicalStatus]);
  const currentSnapshot = useMemo(() => snapshotId(ctx), [ctx]);
  const ready = readiness({ hasCompany: ctx.company !== null, hasHistorical: ctx.historicalData !== null, hasValuation: ctx.valuationResult !== null, unsupportedMessage: ctx.support.status === 'unsupported' ? ctx.support.message : null, documentCount: kn.documents ? kn.documents.length : null });
  const previewMode = question.trim() ? resolveMode(question, ctx, preference) : null;
  const head = useRef<HTMLDivElement>(null);
  useEffect(() => { setSelectedClaim(null); head.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }, [active?.id]);

  const company = ctx.company;
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (!running && ready.canAsk && question.trim()) { void ask(question); setQuestion(''); } };
  const claim = active?.answer ? [...active.answer.keyFindings, ...active.answer.interpretation, ...active.answer.considerations].find((c) => c.id === selectedClaim) ?? null : null;
  const evidence = active ? (claim ? active.evidence.filter((e) => claim.evidenceIds.includes(e.id)) : []) : [];
  const stale = active ? isStale(active, currentSnapshot) : false;
  const companyKey = (c: { corpCode: string | null; name: string } | null | undefined) => (c ? (c.corpCode ?? c.name) : null);
  const otherCompany = active && companyKey(active.company) !== companyKey(company);

  return (
    <div className="ai-page">
      <PageHeader title="AI Analyst" actions={<>
        <button type="button" className="btn small ai-drawer-btn" aria-expanded={drawer} onClick={() => setDrawer((v) => !v)}>Evidence · Sources</button>
      </>}>
        <p className="muted">계산은 ValuFlow 가, 해석은 AI 가 합니다. 모든 답변은 근거와 함께 표시됩니다.</p>
      </PageHeader>

      <div className={`ai-grid${active ? '' : ' no-right'}`}>
        <aside className="ai-left" aria-label="대화 기록과 문서">
          <section className="ai-card">
            <div className="panel-head"><h4>History</h4><span className="small muted">{session.turns.length}</span></div>
            {session.turns.length === 0 ? <p className="small muted">아직 질문이 없습니다.</p> : (
              <ul className="hist">
                {[...session.turns].reverse().map((t) => (
                  <li key={t.id}>
                    <button type="button" className={t.id === active?.id ? 'active' : ''} aria-current={t.id === active?.id} onClick={() => { select(t.id); setDrawer(false); }}>
                      <span className="hist-q">{t.question}</span>
                      <span className="small muted">{t.company?.name ?? '기업 없음'} · {t.workflowLabel ?? MODE_INFO[t.mode].name} · {fmtTime(t.askedAt)}</span>
                      <span className={`hist-st st-${effectiveStatus(t)}`}>{STATUS_INFO[effectiveStatus(t)].label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <KnowledgePanel kn={kn} />
        </aside>

        <section className="ai-center" aria-label="질문과 답변">
          <form className="ai-composer" onSubmit={submit}>
            <label className="field"><span>질문 <em>현재 기업: {company ? `${company.name}${company.stockCode ? ` (${company.stockCode})` : ''}` : '없음'}</em></span>
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`예: ${company ? company.name : '현재 기업'} WACC 가정을 검토해줘`} disabled={!ready.canAsk || running !== null} rows={3}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }} />
            </label>
            <div className="ai-composer-row">
              <div className="seg" role="group" aria-label="답변 방식">
                {PREFS.map((p) => <button key={p.id} type="button" className={preference === p.id ? 'on' : ''} aria-pressed={preference === p.id} onClick={() => setPreference(p.id)}>{p.label}</button>)}
              </div>
              <span className="small muted ai-mode-hint">{previewMode ? `${MODE_INFO[previewMode].name} · Grounding: ${MODE_INFO[previewMode].grounding}` : '질문을 입력하면 방식이 표시됩니다.'}</span>
              <label className="inline-field small"><input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />Debug</label>
              {running ? <button type="button" className="btn" onClick={cancel}>Cancel</button> : <button type="submit" className="btn primary" disabled={!ready.canAsk || question.trim() === ''}>전송</button>}
            </div>
            {!running && !active ? <div className="ai-examples">{EXAMPLE_QUESTIONS.map((q) => <button key={q} type="button" className="chip-btn" disabled={!ready.canAsk} onClick={() => setQuestion(q)}>{q}</button>)}</div> : null}
          </form>

          {ready.notices.map((n) => <p key={n.id} className="ai-notice">{n.text}{n.to ? <> <Link to={n.to}>{n.action}</Link></> : null}</p>)}

          {running ? (
            <section className="ai-card ai-running" role="status" aria-live="polite">
              <div className="panel-head"><h4>{MODE_INFO[running.mode].name}</h4><span className="small muted">{running.text}</span></div>
              {running.steps.length > 0 ? <WorkflowProgress title={running.label} steps={running.steps} /> : null}
            </section>
          ) : null}

          {active ? (
            <>
              <div className="ai-turn-head" ref={head}>
                <div><div className="small muted">{active.company?.name ?? '기업 없음'} · {fmtTime(active.askedAt)}</div><h2 className="ai-q">{active.question}</h2></div>
                <ModeBadge turn={active} />
              </div>
              {stale ? <p className="ai-note" role="note">이 답변은 질문 당시의 Project 상태를 기준으로 합니다 (Based on previous project state). 현재 값으로 다시 계산하지 않았습니다.</p> : null}
              {otherCompany ? <p className="ai-note" role="note">현재 선택한 기업과 다른 기업({active.company?.name ?? '없음'})에 대한 답변입니다.</p> : null}
              {active.steps.length > 0 ? <details open={active.status === 'failed' || active.status === 'tool-limit'} className="ai-card"><summary>진행 단계 · {active.workflowLabel}</summary><WorkflowProgress title={active.workflowLabel} steps={active.steps} /></details> : null}
              {active.usedSources.length > 0 ? <p className="small"><strong>Used Data Sources</strong> {active.usedSources.join(' · ')}</p> : null}
              <Answer turn={active} selected={selectedClaim} onSelect={(id) => { setSelectedClaim(id); setDrawer(true); }} debug={debug} onDecide={decide} />
            </>
          ) : !running ? <p className="ai-empty muted">질문을 입력하면 Tool 로 확인한 근거와 함께 답합니다.</p> : null}
        </section>

        <aside className={`ai-right${drawer ? ' open' : ''}`} aria-label="Evidence, Sources, Warnings">
          <button type="button" className="btn small ai-close" onClick={() => setDrawer(false)}>닫기</button>
          <section className="ai-card">
            <div className="panel-head"><h4>Evidence</h4></div>
            {!active ? <p className="small muted">답변을 선택하면 근거가 표시됩니다.</p>
              : claim ? (<><p className="small"><strong>{claim.kind === 'fact' ? 'FACT' : 'JUDGMENT'}</strong> {claim.text}</p>
                {evidence.length === 0 ? <p className="small muted">이 claim 에 연결된 구체적 근거가 없습니다.</p> : <ul className="ev-list">{evidence.map((e) => <EvidenceCard key={e.id} e={e} />)}</ul>}
                {claim.notes.length > 0 ? <ul className="plain-list small">{claim.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}</>)
                : <p className="small muted">{active.mode === 'quick' ? 'Quick Answer 는 문장별 근거 연결을 제공하지 않습니다. 아래 Sources 를 확인하세요.' : 'Claim 을 선택하면 연결된 근거를 보여 줍니다.'}</p>}
          </section>
          <section className="ai-card"><div className="panel-head"><h4>Sources</h4></div><SourceList sources={active?.sources ?? []} /></section>
          <section className="ai-card"><div className="panel-head"><h4>Data Basis</h4></div><TimeBasis basis={active?.timeBasis ?? null} /></section>
          <section className="ai-card"><div className="panel-head"><h4>Warnings</h4></div><WarningList warnings={active?.warnings ?? []} /></section>
        </aside>
      </div>
    </div>
  );
}
