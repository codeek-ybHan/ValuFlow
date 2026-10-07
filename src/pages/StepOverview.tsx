import { Link, useParams } from 'react-router-dom';
import { getStep } from '../content';
import { stepIdFromSlug, stepPath } from '../routes';
import { useApp } from '../store/state';
import { stepProgress } from '../store/progress';
import { Rich } from '../components/Rich';
import { PageHeader, ProgressBar, StatusBadge, BackLink, fmtPct } from '../components/ui';
import { StepTabs } from '../components/StepTabs';
import { NotFound } from './NotFound';

export function StepOverview() {
  const { stepId } = useParams();
  const step = getStep(stepIdFromSlug(stepId));
  const { state } = useApp();
  if (!step) return <NotFound />;
  const p = stepProgress(step, state);
  return (
    <>
      <BackLink to="/learn/roadmap">Roadmap</BackLink>
      <PageHeader eyebrow={step.code} title={step.title} actions={<StatusBadge label={p.status} />}>
        <p className="lead">{step.subtitle}</p>
      </PageHeader>
      <StepTabs step={step} />

      <div className="overview-grid">
        <div className="overview-main">
          <section>
            <h2>Overview</h2>
            <Rich blocks={step.overview} />
          </section>
          <section>
            <h2>Learning Goals</h2>
            <ul className="plain-list">{step.goals.map((g) => <li key={g}>{g}</li>)}</ul>
          </section>
          <section>
            <h2>Lessons</h2>
            <ol className="lesson-list">
              {step.lessons.map((l, i) => {
                const done = p.items.find((x) => x.id === `lesson-${l.id}`)?.done;
                return (
                  <li key={l.id}>
                    <Link to={`${stepPath(step.id)}/lesson/${l.id}`}>
                      <span className="num lesson-no">LESSON {String(i + 1).padStart(2, '0')}</span>
                      <span className="lesson-title">{l.title}</span>
                      <span className="muted">{l.summary}</span>
                      {done ? <span className="tag tag-done">완료</span> : !l.body && <span className="tag">개요</span>}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="overview-aside" aria-label="Completion Checklist">
          <div className="panel">
            <div className="panel-head"><h3>Completion Checklist</h3></div>
            <div className="pct-big num">{fmtPct(p.ratio, 0)}</div>
            <div className="row"><ProgressBar ratio={p.ratio} label="STEP 진행률" /><span className="small num muted">{p.done} / {p.total}</span></div>
            <ul className="checklist">
              {p.items.map((i) => (
                <li key={i.id} className={i.done ? 'done' : ''}>
                  <span aria-hidden className="box" />
                  <Link to={i.to}>{i.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
