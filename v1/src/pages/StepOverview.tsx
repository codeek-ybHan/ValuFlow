import { Link, useParams } from 'react-router-dom';
import { getStep } from '../content';
import { useApp } from '../store/state';
import { stepProgress } from '../store/progress';
import { Rich } from '../components/Rich';
import { PageHeader, ProgressBar, StatusBadge, BackLink } from '../components/ui';
import { StepTabs } from '../components/StepTabs';
import { NotFound } from './NotFound';

export function StepOverview() {
  const { stepId } = useParams();
  const step = getStep(Number(stepId));
  const { state } = useApp();
  if (!step) return <NotFound />;
  const p = stepProgress(step, state);
  return (
    <>
      <BackLink to="/learn/roadmap">Roadmap</BackLink>
      <PageHeader eyebrow={step.code} title={`${step.title}`}>
        <div className="row between">
          <p className="muted">{step.subtitle}</p>
          <StatusBadge label={p.status} />
        </div>
      </PageHeader>
      <StepTabs step={step} />

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
                <Link to={`/learn/step/${step.id}/lesson/${l.id}`}>
                  <span className="num lesson-no">LESSON {String(i + 1).padStart(2, '0')}</span>
                  <span className="lesson-title">{l.title}</span>
                  <span className="muted small">{l.summary}</span>
                  {!l.body && <span className="tag">개요</span>}
                  {done && <span className="tag tag-done">완료</span>}
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
      <section>
        <h2>Completion Checklist</h2>
        <ProgressBar ratio={p.ratio} label="STEP 진행률" />
        <ul className="checklist">
          {p.items.map((i) => (
            <li key={i.id} className={i.done ? 'done' : ''}>
              <span aria-hidden className="box">{i.done ? '■' : '□'}</span>
              <Link to={i.to}>{i.label}</Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
