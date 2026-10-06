import { Link, useParams } from 'react-router-dom';
import { getStep } from '../content';
import { stepIdFromSlug, stepPath } from '../routes';
import { useApp } from '../store/state';
import { Rich } from '../components/Rich';
import { PageHeader, BackLink, ComingSoon } from '../components/ui';
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
      {b.kind === 'planned' && b.planned && (
        <ComingSoon comingIn={b.planned.comingIn}>
          <h4>구현 예정 모듈</h4>
          <ul className="plain-list">{b.planned.modules.map((m) => <li key={m}>{m}</li>)}</ul>
          {b.planned.architecture && <pre className="formula">{b.planned.architecture}</pre>}
          <p className="small">이 단계의 Build 는 직접 구현하는 과제입니다. 구현을 마치고 검증했다면 아래에서 완료 처리하세요.</p>
          {step.id > 1 && <p className="small muted">입력이 될 이전 단계 결과: <Link to={`${stepPath(step.id - 1)}/practice`}>{`STEP ${String(step.id - 1).padStart(2, '0')} Practice`}</Link></p>}
        </ComingSoon>
      )}

      <div className="row between sticky-actions">
        <span className="small muted">Build 완료는 직접 확인 후 체크합니다.</span>
        <button className={`btn ${done ? '' : 'primary'}`} onClick={() => update((s) => ({ ...s, build: { ...s.build, [step.id]: { completed: !done } } }))}>{done ? '완료 취소' : 'Build 완료'}</button>
      </div>
    </>
  );
}
