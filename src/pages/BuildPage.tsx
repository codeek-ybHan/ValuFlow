import { useParams } from 'react-router-dom';
import { getStep } from '../content';
import { stepIdFromSlug, stepPath } from '../routes';
import { useApp } from '../store/state';
import { Rich } from '../components/Rich';
import { PageHeader, BackLink } from '../components/ui';
import { StepTabs } from '../components/StepTabs';
import { NotFound } from './NotFound';
import { DatasetBuild } from '../build/DatasetBuild';
import { AnalysisBuild } from '../build/AnalysisBuild';
import { ValuationWorkbench } from '../build/ValuationWorkbench';

export function BuildPage() {
  const { stepId } = useParams();
  const step = getStep(stepIdFromSlug(stepId));
  const { state, update } = useApp();
  if (!step) return <NotFound />;
  const b = step.build;
  const done = !!state.build[step.id]?.completed;
  return (
    <>
      <BackLink to={`${stepPath(step.id)}`}>{step.code} {step.title}</BackLink>
      <PageHeader eyebrow={`${step.code} · Project Build`} title={b.title} />
      <StepTabs step={step} />
      <section><Rich blocks={b.description} /></section>

      {b.kind === 'dataset' && <DatasetBuild />}
      {b.kind === 'analysis' && <AnalysisBuild />}
      {b.kind === 'dcf' && <ValuationWorkbench mode="dcf" />}
      {b.kind === 'valuation' && <ValuationWorkbench mode="valuation" />}

      <div className="row between sticky-actions">
        <span className="small muted">Build 완료는 직접 확인 후 체크합니다.</span>
        <button className={`btn ${done ? '' : 'primary'}`} onClick={() => update((s) => ({ ...s, build: { ...s.build, [step.id]: { completed: !done } } }))}>{done ? '완료 취소' : 'Build 완료'}</button>
      </div>
    </>
  );
}
