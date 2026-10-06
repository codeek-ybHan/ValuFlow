import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FinancialRecord, LessonNotes } from '../types';
import { SEED_COMPLETED_LESSONS } from '../content';

// 학습 콘텐츠(content/)와 분리된 사용자 상태. 현재는 localStorage, 추후 DB/API 로 교체 가능.

export interface QuizState {
  answers: Record<string, string>;
  submitted: boolean;
  completed: boolean;
  correct?: number;
  total?: number;
  seeded?: boolean;
}
export interface PracticeState {
  values: Record<string, string>;
  completed: boolean;
  updatedAt?: string;
}
export interface ReflectionState {
  answers: Record<string, string>;
  completed: boolean;
}
export interface AppState {
  lessons: Record<string, boolean>;
  quiz: Record<number, QuizState>;
  practice: Record<number, PracticeState>;
  build: Record<number, { completed: boolean }>;
  reflection: Record<number, ReflectionState>;
  notes: Record<string, LessonNotes>;
  dataset: FinancialRecord[];
}

const KEY = 'valuflow:v1';

export const emptyNotes: LessonNotes = { understood: '', confusing: '', formula: '', practice: '', interview: '' };

function seed(): AppState {
  return {
    lessons: Object.fromEntries(SEED_COMPLETED_LESSONS.map((k) => [k, true])),
    quiz: { 1: { answers: {}, submitted: false, completed: true, seeded: true } },
    practice: {},
    build: {},
    reflection: {},
    notes: {},
    dataset: [],
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...seed(), ...JSON.parse(raw) };
  } catch {
    /* 저장소 접근 불가 시 기본 상태 */
  }
  return seed();
}

interface Ctx {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  reset: () => void;
}
const StateCtx = createContext<Ctx | null>(null);

export function StateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);
  const update = useCallback((fn: (s: AppState) => AppState) => setState((s) => fn(s)), []);
  const reset = useCallback(() => setState(seed()), []);
  const value = useMemo(() => ({ state, update, reset }), [state, update, reset]);
  return <StateCtx.Provider value={value}>{children}</StateCtx.Provider>;
}

export function useApp() {
  const c = useContext(StateCtx);
  if (!c) throw new Error('StateProvider 가 필요합니다.');
  return c;
}
