import { useState } from 'react';
import { hasRelativeInputs, practiceApplyNeedsConfirmation } from '../../store/projectModel';
import { assumptionCompleteness } from '../../store/assumptions';
import { describeBasis } from '../../store/workflowStatus';
import { useProject } from '../../store/project';
import { ConfirmDialog } from '../ConfirmDialog';
import { StatusBadge } from '../ui';

const closeMenu = (e: React.MouseEvent<HTMLElement>) => { const d = e.currentTarget.closest('details'); if (d) d.open = false; };

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

  const sample = basis.assumptions.basis === 'learning';
  return (
    <section className="vc" aria-label="Valuation 상태">
      <div className="vc-top">
        <div>
          <h2 className="vc-company">{h ? `${h.company.name} (${h.company.ticker})` : '기업 미선택'}</h2>
          {/* 출처와 실행 상태는 한 줄 요약. 단계별 상태는 아래 Stepper 가 보여 준다 */}
          <dl className="vc-meta" aria-label="데이터 출처와 실행 상태">
            <div><dt>Historical</dt><dd>{basis.historical.label}{basis.historical.sourceLabel && <span className="source-tag">{basis.historical.sourceLabel}</span>}</dd></div>
            <div><dt>Assumptions</dt><dd className={sample ? 'learning' : undefined}>{basis.assumptions.label}</dd></div>
            <div><dt>Valuation</dt><dd><StatusBadge label={valuationStatus} /></dd></div>
            <div><dt>Sensitivity</dt><dd><StatusBadge label={sensitivityStatus} /></dd></div>
          </dl>
        </div>
        <div className="vc-actions">
          <button className="btn primary" onClick={run} disabled={!completeness.complete} title={completeness.complete ? undefined : '모든 가정(Forecast · WACC · DCF)이 준비되어야 실행할 수 있습니다.'}>Run Valuation</button>
          <button className="btn" onClick={resetValuation} disabled={!a && Object.keys(project.relativeInputs).length === 0} title="가정 · 결과 · 상대가치 입력을 모두 지우고 새 Valuation 을 시작합니다. Historical Data 는 유지됩니다.">Valuation 초기화</button>
          <details className="sample-menu inline">
            <summary>샘플</summary>
            <div className="sample-pop">
              <button className="btn small" onClick={(e) => { closeMenu(e); loadSamsung(); }}>삼성전자 학습용 Historical 불러오기</button>
              <button className="btn small" onClick={(e) => { closeMenu(e); onPractice(); }}>학습용 DCF 가정 적용</button>
            </div>
          </details>
        </div>
      </div>

      {valuationError && <div className="callout neg" role="alert"><strong>Valuation 오류</strong> · {valuationError}</div>}
      {sensitivityError && <div className="callout neg" role="alert"><strong>Sensitivity 오류</strong> · {sensitivityError}</div>}

      {basis.caution && <p className="vc-caution">{basis.caution}</p>}

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
