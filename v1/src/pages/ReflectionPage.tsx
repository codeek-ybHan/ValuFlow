import { useParams } from 'react-router-dom';
import { getStep } from '../content';
import { useApp, type ReflectionState } from '../store/state';
import { PageHeader, BackLink } from '../components/ui';
import { StepTabs } from '../components/StepTabs';
import { NotFound } from './NotFound';

const blank: ReflectionState = { answers: {}, completed: false };

export function ReflectionPage() {
  const { stepId } = useParams();
  const step = getStep(Number(stepId));
  const { state, update } = useApp();
  if (!step) return <NotFound />;
  const r = state.reflection[step.id] ?? blank;
  const save = (patch: Partial<ReflectionState>) => update((s) => ({ ...s, reflection: { ...s.reflection, [step.id]: { ...(s.reflection[step.id] ?? blank), ...patch } } }));
  return (
    <>
      <BackLink to={`/learn/step/${step.id}`}>{step.code} {step.title}</BackLink>
      <PageHeader eyebrow={step.code} title="Reflection / Notes" />
      <StepTabs step={step} />
      {step.reflectionPrompts.map((p, i) => (
        <label key={i} className="field"><span>{p}</span>
          <textarea rows={4} value={r.answers[i] ?? ''} onChange={(e) => save({ answers: { ...r.answers, [i]: e.target.value } })} /></label>
      ))}
      <label className="field"><span>자유 메모</span>
        <textarea rows={4} value={r.answers.free ?? ''} onChange={(e) => save({ answers: { ...r.answers, free: e.target.value } })} /></label>
      <div className="row between sticky-actions">
        <span className="small muted">자동 저장됩니다.</span>
        <button className={`btn ${r.completed ? '' : 'primary'}`} onClick={() => save({ completed: !r.completed })}>{r.completed ? '완료 취소' : 'Reflection 완료'}</button>
      </div>
    </>
  );
}
