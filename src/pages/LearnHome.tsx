import { Link } from 'react-router-dom';
import { steps, BRAND, finalArchitecture } from '../content';
import { stepPath } from '../routes';
import { useApp } from '../store/state';
import { currentStep, nextAction, overallProgress, stepProgress } from '../store/progress';
import { Kpi, PageHeader, ProgressBar, StatusBadge, fmtPct } from '../components/ui';
import { IconBook, IconCheck, IconLayers, IconPen } from '../components/Icons';

export function LearnHome() {
  const { state } = useApp();
  const cur = currentStep(steps, state);
  const cp = stepProgress(cur, state);
  const overall = overallProgress(steps, state);
  const next = nextAction(steps, state);
  const stepsDone = steps.filter((s) => stepProgress(s, state).status === 'COMPLETE').length;
  const lessonsDone = Object.values(state.lessons).filter(Boolean).length;
  const lessonsTotal = steps.reduce((n, s) => n + s.lessons.length, 0);
  const practices = Object.values(state.practice).filter((p) => Object.values(p.values).some((v) => v.trim())).length;
  const latest = steps
    .map((s) => ({ s, p: state.practice[s.id] }))
    .filter((x) => x.p?.updatedAt)
    .sort((a, b) => (b.p!.updatedAt! > a.p!.updatedAt! ? 1 : -1))[0];

  return (
    <>
      <PageHeader
        eyebrow="Learn"
        title={BRAND.hero}
        actions={<>
          <Link className="btn" to="/learn/roadmap">Roadmap</Link>
          <Link className="btn primary" to={next.to}>이어서 학습</Link>
        </>}
      >
        {BRAND.sub.map((t) => <p key={t} className="lead">{t}</p>)}
      </PageHeader>

      <section className="kpi-row">
        <Kpi label="Overall Progress" value={fmtPct(overall.ratio, 0)} icon={<IconCheck />} />
        <Kpi label="Steps Complete" value={`${stepsDone} / ${steps.length}`} icon={<IconLayers />} />
        <Kpi label="Lessons Done" value={`${lessonsDone} / ${lessonsTotal}`} icon={<IconBook />} />
        <Kpi label="Practices Saved" value={practices} icon={<IconPen />} />
      </section>

      <section className="split">
        <div className="panel">
          <div className="panel-head"><h3>Current Step</h3><StatusBadge label={cp.status} /></div>
          <p className="step-title">{cur.code} — {cur.title}</p>
          <p className="muted small">{cur.subtitle}</p>
          <div className="row"><ProgressBar ratio={cp.ratio} label="현재 STEP 진행률" /><span className="small num muted">{cp.done} / {cp.total}</span></div>
          <ul className="mini-checklist">
            {cp.items.filter((i) => !i.done).slice(0, 5).map((i) => (
              <li key={i.id}><Link to={i.to}>{i.label}</Link></li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Latest Practice</h3></div>
          {latest ? (
            <>
              <p className="step-title">{latest.s.code} {latest.s.practice.title}</p>
              <p className="small muted">저장: {new Date(latest.p!.updatedAt!).toLocaleString('ko-KR')}</p>
              <Link className="btn" to={`${stepPath(latest.s.id)}/practice`}>열기</Link>
            </>
          ) : (
            <>
              <p className="muted">아직 저장된 Practice 가 없습니다.</p>
              <Link className="btn" to={`${stepPath(cur.id)}/practice`}>{cur.code} Practice 시작</Link>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Project Evolution</h3><span className="small muted">단계별 자동화 내용</span></div>
        <div className="evo-table" role="table">
          {steps.map((s) => (
            <Link key={s.id} to={stepPath(s.id)} className="evo-row" role="row">
              <span className="evo-step"><strong>{s.code}</strong>{s.short}</span>
              <span>{s.evolution.automated}</span>
              <StatusBadge label={stepProgress(s, state).status} />
            </Link>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>학습에서 PROJECT 로 이어지는 흐름</h3></div>
        <div className="arch">
          {finalArchitecture.map((a, i) => <div key={a} className="arch-node"><span className="num">{String(i + 1).padStart(2, '0')}</span>{a}</div>)}
        </div>
        <div className="grid-3 principles">
          <div className="tile"><h4>Valuation Engine</h4><p className="small">재무비율 · NOPAT · FCFF · WACC · TV · EV · Equity Value · Sensitivity — 결정적(Deterministic) 계산</p></div>
          <div className="tile"><h4>RAG</h4><p className="small">사업보고서 · 공시 · 기업/산업 문서에서 근거를 검색</p></div>
          <div className="tile"><h4>LLM</h4><p className="small">결과 해석 · 변화 설명 · 위험요인 탐색 · Tool orchestration. 핵심 숫자는 직접 계산하지 않음</p></div>
        </div>
      </section>
    </>
  );
}
