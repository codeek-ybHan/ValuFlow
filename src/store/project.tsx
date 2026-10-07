import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AssumptionsDraft } from './assumptions';
import type { HistoricalData, SelectedCompany } from '../data/types';
import type { ForecastInputs } from '../engine/forecastForm';
import type { WaccInputs } from '../engine/waccForm';
import type { DcfInputs } from '../engine/dcfForm';
import type { RelativeInput } from '../valuation';
import {
  emptyProjectState, restoreProjectState, toPersisted, withAssumptions, withForecastInputs, withHistoricalData, withPracticeAssumptions,
  withResultsCleared, withWaccInputs, withDcfInputs, withRelativeInputs, withSamsungHistorical, withSelectedCompany, withSensitivityRun, withValuationReset, withValuationRun, type ProjectState,
} from './projectModel';

// PROJECT 영역 상태 (LEARN 상태 store/state.tsx 와 분리). 상태 전이는 projectModel.ts 의 순수 함수가 담당하고,
// 이 파일은 React state 와 localStorage 를 연결한다.

export type { ProjectState } from './projectModel';

const KEY = 'valuflow:project';

function load(): ProjectState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return restoreProjectState(JSON.parse(raw)); // 저장된 입력으로 결과를 다시 계산
  } catch {
    /* 저장소 접근 불가 / 손상된 JSON 이면 빈 상태 */
  }
  return emptyProjectState;
}

interface Ctx {
  project: ProjectState;
  /** 기업만 선택 (historicalData 는 바뀌지 않는다) */
  setSelectedCompany: (c: SelectedCompany | null) => void;
  /** historicalData 만 설정 */
  setHistoricalData: (h: HistoricalData | null) => void;
  /** 가정을 설정. 이전 결과는 비워진다(재계산 필요) */
  setValuationAssumptions: (a: AssumptionsDraft | null) => void;
  /** Forecast 입력을 가정에 반영 (나머지 가정은 유지, 이전 결과는 비워짐) */
  setForecastInputs: (f: ForecastInputs) => void;
  /** WACC 입력만 가정에 반영 (Forecast/DCF 가정은 유지, 이전 결과는 비워짐) */
  setWaccInputs: (w: WaccInputs) => void;
  /** DCF / Equity 입력만 가정에 반영 (Forecast/WACC 가정은 유지, 이전 결과는 비워짐) */
  setDcfInputs: (d: DcfInputs) => void;
  /** 상대가치 입력 교체 (Valuation 가정 / 결과는 유지) */
  setRelativeInputs: (r: RelativeInput) => void;
  /** 입력이 유효하지 않을 때 어긋난 결과만 비움 (가정은 유지) */
  clearStaleResults: () => void;
  /** valuationAssumptions 로 runValuation 실행 */
  runCurrentValuation: () => void;
  /** valuationAssumptions 로 runSensitivity 실행 */
  runCurrentSensitivity: () => void;
  /** 가정과 결과를 비움 (historicalData 는 유지) */
  resetValuation: () => void;
  /** 삼성전자 FY2023~FY2025 불러오기 (historicalData 만) */
  loadSamsung: () => void;
  /** STEP 04 학습용 가정 적용 + 계산 */
  applyPracticeAssumptions: () => void;
  /** 모든 PROJECT 입력 초기화 */
  reset: () => void;
}
const ProjectCtx = createContext<Ctx | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<ProjectState>(load);

  // 입력(historicalData, valuationAssumptions, relativeInputs)만 저장한다. 결과는 저장하지 않는다.
  const persisted = JSON.stringify(toPersisted(project));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, persisted);
    } catch {
      /* ignore */
    }
  }, [persisted]);

  const setSelectedCompany = useCallback((c: SelectedCompany | null) => setProject((p) => withSelectedCompany(p, c)), []);
  const setHistoricalData = useCallback((h: HistoricalData | null) => setProject((p) => withHistoricalData(p, h)), []);
  const setValuationAssumptions = useCallback((a: AssumptionsDraft | null) => setProject((p) => withAssumptions(p, a)), []);
  const setForecastInputs = useCallback((f: ForecastInputs) => setProject((p) => withForecastInputs(p, f)), []);
  const setWaccInputs = useCallback((w: WaccInputs) => setProject((p) => withWaccInputs(p, w)), []);
  const setDcfInputs = useCallback((d: DcfInputs) => setProject((p) => withDcfInputs(p, d)), []);
  const setRelativeInputs = useCallback((r: RelativeInput) => setProject((p) => withRelativeInputs(p, r)), []);
  const clearStaleResults = useCallback(() => setProject(withResultsCleared), []);
  const runCurrentValuation = useCallback(() => setProject(withValuationRun), []);
  const runCurrentSensitivity = useCallback(() => setProject(withSensitivityRun), []);
  const resetValuation = useCallback(() => setProject(withValuationReset), []);
  const loadSamsung = useCallback(() => setProject(withSamsungHistorical), []);
  const applyPracticeAssumptions = useCallback(() => setProject(withPracticeAssumptions), []);
  const reset = useCallback(() => setProject(emptyProjectState), []);

  const value = useMemo(
    () => ({ project, setSelectedCompany, setHistoricalData, setValuationAssumptions, setForecastInputs, setWaccInputs, setDcfInputs, setRelativeInputs, clearStaleResults, runCurrentValuation, runCurrentSensitivity, resetValuation, loadSamsung, applyPracticeAssumptions, reset }),
    [project, setSelectedCompany, setHistoricalData, setValuationAssumptions, setForecastInputs, setWaccInputs, setDcfInputs, setRelativeInputs, clearStaleResults, runCurrentValuation, runCurrentSensitivity, resetValuation, loadSamsung, applyPracticeAssumptions, reset],
  );
  return <ProjectCtx.Provider value={value}>{children}</ProjectCtx.Provider>;
}

export function useProject() {
  const c = useContext(ProjectCtx);
  if (!c) throw new Error('ProjectProvider 가 필요합니다.');
  return c;
}
