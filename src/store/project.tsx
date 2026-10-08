import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssumptionsDraft } from './assumptions';
import type { HistoricalData, SelectedCompany } from '../data/types';
import { defaultFinancialRepository } from '../data/repository/defaultRepository';
import type { FinancialRepository } from '../data/repository/financialRepository';
import { applyLoadOutcome, loadHistorical as loadHistoricalFor, type HistoricalLoadStatus } from './historicalLoad';
import type { ForecastInputs } from '../engine/forecastForm';
import type { WaccInputs } from '../engine/waccForm';
import type { DcfInputs } from '../engine/dcfForm';
import type { RelativeInput } from '../valuation';
import {
  emptyProjectState, restoreProjectState, toPersisted, withAssumptions, withForecastInputs, withHistoricalData, withPracticeAssumptions,
  withResultsCleared, withWaccInputs, withDcfInputs, withRelativeInputs, canApplyPractice, withSelectedCompany, withHistoricalCleared, needsHistoricalRefetch, withSensitivityRun, withValuationReset, withValuationRun, type ProjectState,
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
  /** Historical 불러오기 상태 (불러오는 중 / 마지막 실패). 저장하지 않는 일시 상태. */
  historicalStatus: HistoricalLoadStatus;
  /** 선택한 기업의 실제 재무데이터를 명시적으로 불러온다. refresh 면 DB 를 건너뛰고 OpenDART 를 다시 조회한다. 실패해도 기존 Historical 은 유지된다. */
  loadHistorical: (options?: { refresh?: boolean }) => Promise<void>;
  /** Historical 만 제거 (기업 선택 · Valuation 가정은 유지) */
  removeHistorical: () => void;
  /** STEP 04 학습용 가정 적용 + 계산. 기업 선택과 Historical 로드 이후에만 동작한다 (명시적으로 눌렀을 때만 가정이 들어온다). */
  applyPracticeAssumptions: () => void;
  /** 모든 PROJECT 입력 초기화 */
  reset: () => void;
}
const ProjectCtx = createContext<Ctx | null>(null);

export function ProjectProvider({ children, repository = defaultFinancialRepository }: { children: ReactNode; repository?: FinancialRepository }) {
  const [project, setProject] = useState<ProjectState>(load);
  const [historicalStatus, setHistoricalStatus] = useState<HistoricalLoadStatus>({ kind: 'idle' });
  const seq = useRef(0); // 늦게 도착한 이전 응답이 최신 상태를 덮어쓰지 않게 한다
  const latest = useRef(project);
  latest.current = project;

  // 입력(historicalData, valuationAssumptions, relativeInputs)만 저장한다. 결과는 저장하지 않는다.
  const persisted = JSON.stringify(toPersisted(project));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, persisted);
    } catch {
      /* ignore */
    }
  }, [persisted]);

  const setSelectedCompany = useCallback((c: SelectedCompany | null) => {
    // 다른 기업(또는 해제)으로 바뀌면 진행 중이던 이전 기업의 Historical 요청 결과를 버리고 상태 표시도 초기화한다
    if (c === null || latest.current.selectedCompany?.corpCode !== c.corpCode) { seq.current += 1; setHistoricalStatus({ kind: 'idle' }); }
    setProject((p) => withSelectedCompany(p, c));
  }, []);
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
  const applyPracticeAssumptions = useCallback(() => setProject((p) => (canApplyPractice(p) ? withPracticeAssumptions(p) : p)), []);
  const reset = useCallback(() => { seq.current += 1; setHistoricalStatus({ kind: 'idle' }); setProject(emptyProjectState); }, []);
  const removeHistorical = useCallback(() => { seq.current += 1; setHistoricalStatus({ kind: 'idle' }); setProject(withHistoricalCleared); }, []);

  const loadHistorical = useCallback(async (options: { refresh?: boolean } = {}) => {
    const company = latest.current.selectedCompany;
    if (!company) return;
    const mine = ++seq.current;
    setHistoricalStatus({ kind: 'loading', refresh: options.refresh === true });
    const outcome = await loadHistoricalFor(repository, company, { refresh: options.refresh, fiscalYears: latest.current.historicalProvenance?.corpCode === company.corpCode ? latest.current.historicalProvenance.fiscalYears : undefined });
    if (mine !== seq.current) return;
    if (outcome.ok) {
      setProject((p) => applyLoadOutcome(p, outcome));
      setHistoricalStatus({ kind: 'idle' });
    } else {
      setHistoricalStatus({ kind: 'failed', failure: outcome.failure, refresh: options.refresh === true });
    }
  }, [repository]);

  // reload: database / opendart 의 Historical 은 저장하지 않았으므로 provenance 로 backend 에서 다시 조회한다.
  useEffect(() => {
    const p = latest.current;
    if (!needsHistoricalRefetch(p) || !p.selectedCompany || !p.historicalProvenance?.fiscalYears) return;
    const mine = ++seq.current;
    const company = p.selectedCompany;
    setHistoricalStatus({ kind: 'loading', refresh: false });
    void loadHistoricalFor(repository, company, { fiscalYears: p.historicalProvenance.fiscalYears }).then((outcome) => {
      if (mine !== seq.current) return;
      if (outcome.ok) { setProject((s) => applyLoadOutcome(s, outcome)); setHistoricalStatus({ kind: 'idle' }); }
      else {
        // 다시 불러오지 못하면 오래된 출처를 남기지 않는다
        setProject(withHistoricalCleared);
        setHistoricalStatus({ kind: 'failed', failure: outcome.failure, refresh: false });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({ project, historicalStatus, loadHistorical, removeHistorical, setSelectedCompany, setHistoricalData, setValuationAssumptions, setForecastInputs, setWaccInputs, setDcfInputs, setRelativeInputs, clearStaleResults, runCurrentValuation, runCurrentSensitivity, resetValuation, applyPracticeAssumptions, reset }),
    [project, historicalStatus, loadHistorical, removeHistorical, setSelectedCompany, setHistoricalData, setValuationAssumptions, setForecastInputs, setWaccInputs, setDcfInputs, setRelativeInputs, clearStaleResults, runCurrentValuation, runCurrentSensitivity, resetValuation, applyPracticeAssumptions, reset],
  );
  return <ProjectCtx.Provider value={value}>{children}</ProjectCtx.Provider>;
}

export function useProject() {
  const c = useContext(ProjectCtx);
  if (!c) throw new Error('ProjectProvider 가 필요합니다.');
  return c;
}
