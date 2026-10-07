import { Link } from 'react-router-dom';
import { useProject } from '../../store/project';
import { stageStatuses } from '../../store/workflowStatus';
import { stages, type StageId } from './workflow';

/** 6단계 진행 표시. 각 단계의 상태(NOT STARTED / INCOMPLETE / READY / CALCULATED)는 현재 입력과 결과에서 계산한다. */
export function ValuationStepper({ current }: { current: StageId }) {
  const { project } = useProject();
  const status = stageStatuses(project);
  const cur = stages.findIndex((s) => s.id === current);
  return (
    <nav className="stepper" aria-label="Valuation workflow">
      {stages.map((s, i) => {
        const st = status[s.id];
        const shown = s.id === 'historical' && st === 'READY' ? 'LOADED' : st;
        return (
          <Link
            key={s.id}
            to={`/valuation/${s.id}`}
            className={`stepper-item${i === cur ? ' active' : ''}${i < cur ? ' past' : ''}`}
            aria-current={i === cur ? 'step' : undefined}
          >
            <span className="stepper-no num">{s.no}</span>
            <span className="stepper-text">
              <span className="stepper-label">{s.label}</span>
              <small className={`stepper-status s-${st.toLowerCase().replace(/\s+/g, '-')}`}>{shown}</small>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
