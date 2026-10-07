import { isPracticeAssumptions } from '../../store/projectModel';
import { useProject } from '../../store/project';
import { StatusBadge } from '../ui';

/** Valuation 상단: 기업, 데이터/가정 불러오기, 실행, 상태, 오류. 계산은 store(→ valuation 공개 API)가 하고 여기서는 호출만 한다. */
export function ValuationControls() {
  const { project, loadSamsung, applyPracticeAssumptions, runCurrentValuation, runCurrentSensitivity, resetValuation } = useProject();
  const { historicalData: h, valuationAssumptions: a, valuationResult, sensitivityResult, valuationError, sensitivityError } = project;
  const practice = isPracticeAssumptions(a);

  const valuationStatus = valuationError ? 'ERROR' : valuationResult ? 'CALCULATED' : 'NOT RUN';
  const sensitivityStatus = sensitivityError ? 'ERROR' : sensitivityResult ? 'CALCULATED' : 'NOT RUN';
  const run = () => { runCurrentValuation(); runCurrentSensitivity(); };

  return (
    <section className="panel valuation-panel" aria-label="Valuation 상태">
      <div className="panel-head">
        <div>
          <div className="small muted">Company</div>
          <h3>{h ? `${h.company.name} (${h.company.ticker})` : '기업 미선택'}</h3>
        </div>
        {practice && <span className="badge badge-in-progress" title="STEP 04 가상 실습값입니다. 삼성전자의 실제 Forecast 가 아닙니다.">학습용 가정</span>}
      </div>

      <div className="row action-row">
        <button className="btn" onClick={loadSamsung}>삼성전자 데이터 불러오기</button>
        <button className="btn primary" onClick={applyPracticeAssumptions}>학습용 DCF 가정 적용</button>
        <button className="btn" onClick={run} disabled={!a}>Run Valuation</button>
        <button className="btn" onClick={resetValuation} disabled={!a}>Valuation 초기화</button>
      </div>

      {valuationError && <div className="callout neg" role="alert"><strong>Valuation 오류</strong> · {valuationError}</div>}
      {sensitivityError && <div className="callout neg" role="alert"><strong>Sensitivity 오류</strong> · {sensitivityError}</div>}

      <dl className="status-grid">
        <div><dt>Historical Data</dt><dd><StatusBadge label={h ? 'LOADED' : 'NOT LOADED'} /></dd></div>
        <div><dt>Assumptions</dt><dd><StatusBadge label={a ? 'READY' : 'NOT CONFIGURED'} /></dd></div>
        <div><dt>Valuation</dt><dd><StatusBadge label={valuationStatus} /></dd></div>
        <div><dt>Sensitivity</dt><dd><StatusBadge label={sensitivityStatus} /></dd></div>
      </dl>
      {practice && <p className="hint">Historical data 는 공시 기반, Forecast assumptions 는 STEP 04 학습용 가상값입니다. 두 값을 합쳐 삼성전자의 가치평가 결과로 해석하지 마세요.</p>}
      {!practice && h && !a && <p className="hint">Historical data: 공시 기반 · Forecast assumptions: 사용자 입력 필요</p>}
    </section>
  );
}
