// Valuation Workspace 의 진행 상태. 화면(Stepper, Dashboard)은 이 함수의 결과만 읽으며 상태를 하드코딩하지 않는다.
// 입력은 PROJECT 상태(ProjectState) 하나이고, 저장된 결과가 아니라 현재 입력과 파생 결과에서 매번 계산한다.
import { assumptionCompleteness, DCF_FIELDS, FORECAST_FIELDS, WACC_FIELDS } from './assumptions.ts';
import { isPracticeAssumptions, type ProjectState } from './projectModel.ts';

export type StageStatus = 'NOT STARTED' | 'INCOMPLETE' | 'READY' | 'CALCULATED' | 'ERROR';

export type StageKey = 'historical' | 'forecast' | 'wacc' | 'dcf' | 'result' | 'validation';
export type StageStatusMap = Record<StageKey, StageStatus>;

const started = (missing: string[], all: readonly string[]) => missing.length < all.length;

/**
 * 단계별 상태.
 *  - Historical : 데이터가 있으면 READY, 없으면 NOT STARTED
 *  - Forecast / WACC / DCF : 필요한 입력이 모두 있으면 READY, 일부만 있으면 INCOMPLETE, 없으면 NOT STARTED
 *  - Result     : 계산 오류 ERROR, 결과가 있으면 CALCULATED, 모든 가정이 준비되었으면 READY, 일부만 있으면 INCOMPLETE
 *  - Validation : Valuation 결과가 있어야 검토할 수 있다 (있으면 READY, 없으면 NOT STARTED)
 */
export function stageStatuses(state: ProjectState): StageStatusMap {
  const c = assumptionCompleteness(state.valuationAssumptions);
  const section = (key: 'forecast' | 'wacc' | 'dcf', all: readonly string[]): StageStatus =>
    c[key] === 'READY' ? 'READY' : started(c.missing[key], all) ? 'INCOMPLETE' : 'NOT STARTED';
  const anyAssumption = started(c.missing.forecast, FORECAST_FIELDS) || started(c.missing.wacc, WACC_FIELDS) || started(c.missing.dcf, DCF_FIELDS);

  const result: StageStatus = state.valuationError ? 'ERROR' : state.valuationResult ? 'CALCULATED' : c.complete ? 'READY' : anyAssumption ? 'INCOMPLETE' : 'NOT STARTED';
  return {
    historical: state.historicalData ? 'READY' : 'NOT STARTED',
    forecast: section('forecast', FORECAST_FIELDS),
    wacc: section('wacc', WACC_FIELDS),
    dcf: section('dcf', DCF_FIELDS),
    result,
    validation: state.valuationResult ? 'READY' : 'NOT STARTED',
  };
}

export interface ProgressRow {
  key: string;
  label: string;
  status: StageStatus;
  /** 화면에 표시할 문구 (Historical 은 READY 대신 LOADED) */
  display: string;
  to: string;
}

/** Dashboard 의 Workflow Progress. 실제 상태에서 계산한다. */
export function buildWorkflowProgress(state: ProjectState): ProgressRow[] {
  const s = stageStatuses(state);
  const c = assumptionCompleteness(state.valuationAssumptions);
  const sensitivity: StageStatus = state.sensitivityError ? 'ERROR' : state.sensitivityResult ? 'CALCULATED' : c.complete ? 'READY' : s.result === 'NOT STARTED' ? 'NOT STARTED' : 'INCOMPLETE';
  return [
    { key: 'historical', label: 'Historical', status: s.historical, display: s.historical === 'READY' ? 'LOADED' : s.historical, to: '/valuation/historical' },
    { key: 'forecast', label: 'Forecast', status: s.forecast, display: s.forecast, to: '/valuation/forecast' },
    { key: 'wacc', label: 'WACC', status: s.wacc, display: s.wacc, to: '/valuation/wacc' },
    { key: 'dcf', label: 'DCF / Equity', status: s.dcf, display: s.dcf, to: '/valuation/dcf' },
    { key: 'valuation', label: 'Valuation', status: s.result, display: s.result, to: '/valuation/result' },
    { key: 'sensitivity', label: 'Sensitivity', status: sensitivity, display: sensitivity, to: '/valuation/validation' },
    { key: 'validation', label: 'Validation', status: s.validation, display: s.validation, to: '/valuation/validation' },
  ];
}

// ---- 데이터 출처(basis) 표기: 실제 Historical 과 학습용 가정이 섞여 보이지 않게 한다 ----

export type AssumptionBasis = 'none' | 'learning' | 'user';

/**
 * 가정의 출처. 학습용 fixture 와 값이 모두 같을 때만 'learning', 일부라도 직접 입력한 값이 있으면 'user', 가정이 없으면 'none'.
 * (가정이 학습용 값에서 하나라도 바뀌면 더 이상 학습용이 아니다.)
 */
export function assumptionBasis(state: ProjectState): AssumptionBasis {
  const a = state.valuationAssumptions;
  if (a === null || Object.keys(a).length === 0) return 'none';
  return isPracticeAssumptions(a) ? 'learning' : 'user';
}

export interface BasisSummary {
  historical: { present: boolean; label: string };
  assumptions: { basis: AssumptionBasis; label: string };
  /** 실제 Historical 과 학습용 가정이 함께 있을 때 혼동을 막는 안내 */
  caution: string | null;
}

export function describeBasis(state: ProjectState): BasisSummary {
  const h = state.historicalData;
  const basis = assumptionBasis(state);
  const historical = h ? { present: true, label: `${h.company.name} · Actual` } : { present: false, label: '불러오지 않음' };
  const assumptions = { basis, label: basis === 'learning' ? '학습용 가정' : basis === 'user' ? '사용자 입력' : '미입력' };
  const caution =
    basis === 'learning'
      ? h
        ? `Historical Data(${h.company.name} 실제 공시)와 Valuation Assumptions(STEP 04 학습용 가상값)는 서로 다른 출처입니다. 이 결과를 ${h.company.name}의 가치평가로 해석하지 마세요.`
        : 'Valuation Assumptions 는 STEP 04 학습용 가상값입니다. 실제 기업의 가치평가가 아닙니다.'
      : null;
  return { historical, assumptions, caution };
}
