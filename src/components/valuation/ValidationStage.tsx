import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../../store/project';
import { isPracticeAssumptions } from '../../store/projectModel';
import { isCompleteAssumptions } from '../../store/assumptions';
import { buildValidationView } from '../../engine/validationView';
import { AssumptionCompleteness } from './AssumptionCompleteness';
import { SensitivityPanel } from './SensitivityPanel';
import { ScenarioPanel } from './ScenarioPanel';
import { RelativePanel } from './RelativePanel';
import { ValidationRange, ValidationWarnings } from './ValidationSummary';
import { stages } from './workflow';

// 6. Validation — 하나의 DCF 숫자가 아니라 가정 변화(Sensitivity, Scenario)와 상대가치로 결과의 합리성을 검토한다.
// Valuation 이 계산된 뒤에만 의미가 있다. 결과 계산은 모두 valuation 공개 API 를 통해 수행한다.

const SECTION = stages[5];

export function ValidationStage() {
  const { project } = useProject();
  const a = project.valuationAssumptions;
  const r = project.valuationResult;
  const s = project.sensitivityResult;
  const view = useMemo(
    () => (r && isCompleteAssumptions(a) ? buildValidationView({ assumptions: a, result: r, sensitivity: s, relativeInput: project.relativeInputs }) : null),
    [a, r, s, project.relativeInputs],
  );
  const prev = stages[4];

  if (!view) {
    return (
      <>
        <p className="muted">{SECTION.summary}</p>
        <div className="empty-state">
          <h3>검증할 Valuation 결과가 없습니다</h3>
          <p>Validation 은 DCF 결과를 기준으로 합니다. 모든 가정을 입력하고 Run Valuation 을 실행하거나, 상단의 [학습용 DCF 가정 적용] 으로 계산하세요. 계산되지 않은 값은 임의로 채우지 않습니다.</p>
          <Link className="btn primary" to="/valuation/dcf">DCF 단계로 이동</Link>
        </div>
        <AssumptionCompleteness assumptions={a} />
        <div className="row between slot-nav"><Link className="btn" to={`/valuation/${prev.id}`}>← {prev.label}</Link><div /></div>
      </>
    );
  }

  return (
    <>
      <p className="muted">{SECTION.summary}</p>
      {isPracticeAssumptions(a) && <p className="hint"><span className="badge badge-in-progress">학습용 가정</span> STEP 04 가상 실습값 기준의 검증입니다. 실제 기업의 가치평가가 아닙니다.</p>}

      <ValidationWarnings view={view} />
      {view.sensitivity && <SensitivityPanel view={view.sensitivity} />}
      <ScenarioPanel view={view.scenarios} />
      <RelativePanel view={view.relative} />
      <ValidationRange view={view} />

      <div className="row between slot-nav">
        <Link className="btn" to={`/valuation/${prev.id}`}>← {prev.label}</Link>
        <div />
      </div>
    </>
  );
}
