import { useState } from 'react';
import { hasRelativeInputs, practiceApplyNeedsConfirmation } from '../../store/projectModel';
import { assumptionCompleteness } from '../../store/assumptions';
import { describeBasis } from '../../store/workflowStatus';
import { useProject } from '../../store/project';
import { ConfirmDialog } from '../ConfirmDialog';
import { StatusBadge } from '../ui';

/** Valuation 상단: 기업, 데이터/가정 불러오기, 실행, 상태, 오류. 계산은 store(→ valuation 공개 API)가 하고 여기서는 호출만 한다. */
export function ValuationControls() {
  const { project, loadSamsung, applyPracticeAssumptions, runCurrentValuation, runCurrentSensitivity, resetValuation } = useProject();
  const { historicalData: h, valuationAssumptions: a, valuationResult, sensitivityResult, valuationError, sensitivityError } = project;
  const completeness = assumptionCompleteness(a);
  const basis = describeBasis(project);
  const [confirming, setConfirming] = useState(false);

  // 가정 상태가 완성되지 않았으면 NOT READY, 완성되었지만 아직 실행 전이면 NOT RUN
  const valuationStatus = valuationError ? 'ERROR' : valuationResult ? 'CALCULATED' : completeness.complete ? 'NOT RUN' : 'NOT READY';
  const sensitivityStatus = sensitivityError ? 'ERROR' : sensitivityResult ? 'CALCULATED' : 'NOT RUN';
  const run = () => { runCurrentValuation(); runCurrentSensitivity(); };

  // 직접 입력한 값이 있으면 덮어쓰기 전에 확인한다. 입력이 없는 초기 상태(또는 이미 학습용 값)라면 바로 적용한다.
  const onPractice = () => (practiceApplyNeedsConfirmation(project) ? setConfirming(true) : applyPracticeAssumptions());

  return (
    <section className="panel valuation-panel" aria-label="Valuation 상태">
      <div className="panel-head">
        <div>
          <div className="small muted">Company</div>
          <h3>{h ? `${h.company.name} (${h.company.ticker})` : '기업 미선택'}</h3>
        </div>
        {basis.assumptions.basis === 'learning' && <span className="chip" title="STEP 04 가상 실습값입니다. 삼성전자의 실제 Forecast 가 아닙니다.">학습용 가정</span>}
      </div>

      {/* 4칸 요약: 출처(Historical / Assumptions)와 실행 상태(Valuation / Sensitivity). 단계별 상태는 아래 Stepper 가 보여 준다 */}
      <dl className="basis-row" aria-label="데이터 출처와 실행 상태">
        <div>
          <dt>Historical Data</dt>
          <dd>{basis.historical.label}{basis.historical.present && <span className="source-tag">공시 기반</span>}</dd>
        </div>
        <div>
          <dt>Valuation Assumptions</dt>
          <dd className={basis.assumptions.basis === 'learning' ? 'learning' : undefined}>{basis.assumptions.label}</dd>
        </div>
        <div><dt>Valuation</dt><dd><StatusBadge label={valuationStatus} /></dd></div>
        <div><dt>Sensitivity</dt><dd><StatusBadge label={sensitivityStatus} /></dd></div>
      </dl>

      <div className="row action-row">
        <button className="btn" onClick={loadSamsung}>삼성전자 학습용 Historical 불러오기</button>
        <button className="btn primary" onClick={onPractice}>학습용 DCF 가정 적용</button>
        <button className="btn" onClick={run} disabled={!completeness.complete} title={completeness.complete ? undefined : '모든 가정(Forecast · WACC · DCF)이 준비되어야 실행할 수 있습니다.'}>Run Valuation</button>
        <button className="btn" onClick={resetValuation} disabled={!a && Object.keys(project.relativeInputs).length === 0} title="가정 · 결과 · 상대가치 입력을 모두 지우고 새 Valuation 을 시작합니다. Historical Data 는 유지됩니다.">Valuation 초기화</button>
      </div>

      {valuationError && <div className="callout neg" role="alert"><strong>Valuation 오류</strong> · {valuationError}</div>}
      {sensitivityError && <div className="callout neg" role="alert"><strong>Sensitivity 오류</strong> · {sensitivityError}</div>}

      {basis.caution && <p className="hint">{basis.caution}</p>}

      <ConfirmDialog
        open={confirming}
        title="학습용 가정으로 교체"
        message={hasRelativeInputs(project)
          ? '현재 입력이 모두 학습용 값으로 교체됩니다. 입력한 상대가치 값도 함께 초기화됩니다. 계속하시겠습니까?'
          : '현재 입력이 모두 학습용 값으로 교체됩니다. 계속하시겠습니까?'}
        cancelLabel="취소"
        confirmLabel="학습용 값 적용"
        onCancel={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); applyPracticeAssumptions(); }}
      />
    </section>
  );
}
