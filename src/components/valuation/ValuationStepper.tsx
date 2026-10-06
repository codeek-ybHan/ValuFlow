import { Link } from 'react-router-dom';
import { stages, type StageId } from '../../valuation/workflow';

export function ValuationStepper({ current }: { current: StageId }) {
  const cur = stages.findIndex((s) => s.id === current);
  return (
    <nav className="stepper" aria-label="Valuation workflow">
      {stages.map((s, i) => (
        <Link
          key={s.id}
          to={`/valuation/${s.id}`}
          className={`stepper-item${i === cur ? ' active' : ''}${i < cur ? ' past' : ''}`}
          aria-current={i === cur ? 'step' : undefined}
        >
          <span className="stepper-no num">{s.no}</span>
          <span>{s.label}</span>
        </Link>
      ))}
    </nav>
  );
}
