import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HistoricalData, ValuationAssumptions } from '../data/types';
import { samsungHistoricalData } from '../data/samsungHistorical';

// PROJECT 영역 상태. LEARN 상태(store/state.tsx)와 분리한다.
// 입력의 출처가 다른 세 값을 한 객체로 합치지 않는다.
//   historicalData       공시 기반 실제값
//   valuationAssumptions 사용자 / 학습용 가정 (Engine 연결 전까지 null)
//   valuationResult      Engine 계산 결과   (STEP 05 에서 ValuationResult 타입으로 교체)

export interface ProjectState {
  historicalData: HistoricalData | null;
  valuationAssumptions: ValuationAssumptions | null;
  valuationResult: null;
}

const KEY = 'valuflow:project';
const empty: ProjectState = { historicalData: null, valuationAssumptions: null, valuationResult: null };

function load(): ProjectState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { ...empty, historicalData: p.historicalData ?? null };
    }
  } catch {
    /* 저장소 접근 불가 시 빈 상태 */
  }
  return empty;
}

interface Ctx {
  project: ProjectState;
  loadSamsung: () => void;
  reset: () => void;
}
const ProjectCtx = createContext<Ctx | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<ProjectState>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(project));
    } catch {
      /* ignore */
    }
  }, [project]);
  // 삼성전자 데이터 불러오기: Historical Data 만 채운다. 가정과 결과는 건드리지 않는다.
  const loadSamsung = useCallback(() => setProject((p) => ({ ...p, historicalData: samsungHistoricalData })), []);
  const reset = useCallback(() => setProject(empty), []);
  const value = useMemo(() => ({ project, loadSamsung, reset }), [project, loadSamsung, reset]);
  return <ProjectCtx.Provider value={value}>{children}</ProjectCtx.Provider>;
}

export function useProject() {
  const c = useContext(ProjectCtx);
  if (!c) throw new Error('ProjectProvider 가 필요합니다.');
  return c;
}
