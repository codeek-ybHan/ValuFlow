import { Link } from 'react-router-dom';
import { steps } from '../content';
import { stepPath } from '../routes';
import { useApp } from '../store/state';
import { roadmapLabels, stepProgress } from '../store/progress';
import { PageHeader, ProgressBar, StatusBadge } from '../components/ui';

export function Roadmap() {
  const { state } = useApp();
  const labels = roadmapLabels(steps, state);
  return (
    <>
      <PageHeader eyebrow="Learn" title="Roadmap">
        <p className="lead">LEARN → QUIZ → PRACTICE → BUILD → COMPLETE 순서로 진행합니다. 앞 단계의 Practice 결과가 다음 단계의 입력이 되므로 순서대로 진행하는 것을 권장합니다.</p>
        <p className="lead small">LOCKED 는 권장 순서 표시이며 접근을 막지 않습니다.</p>
      </PageHeader>
      <ol className="roadmap">
        {steps.map((s, i) => {
          const p = stepProgress(s, state);
          return (
            <li key={s.id} className={`road-item road-${labels[i].toLowerCase().replace(' ', '-')}`}>
              <Link to={stepPath(s.id)} className="road-link">
                <span className="road-code">{s.code}</span>
                <span className="road-title">{s.short}</span>
                <span className="road-sub muted">{s.subtitle}</span>
                <span className="road-prog"><ProgressBar ratio={p.ratio} label={`${s.code} 진행률`} /><span className="small num muted">{p.done}/{p.total}</span></span>
                <StatusBadge label={labels[i]} />
              </Link>
            </li>
          );
        })}
      </ol>
    </>
  );
}
