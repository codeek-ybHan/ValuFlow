// 대화 history (세션 내). Conversation state 는 Project valuation state 와 분리되어 있고, 이 모듈은 ProjectState 를 모른다.
import type { AnalystTurn, CheckpointDecision } from './view.ts';

export interface AnalystSession { turns: AnalystTurn[]; activeId: string | null }
export const emptySession: AnalystSession = { turns: [], activeId: null };

export const addTurn = (s: AnalystSession, t: AnalystTurn): AnalystSession => ({ turns: [...s.turns, t], activeId: t.id });
export const selectTurn = (s: AnalystSession, id: string | null): AnalystSession => (id === null || s.turns.some((t) => t.id === id) ? { ...s, activeId: id } : s);

/** 변경 제안에 대한 검토 결정을 기록한다. 값을 적용하지 않는다 (기록만 남는다). */
export function decideCheckpoint(s: AnalystSession, turnId: string, checkpointId: string, decision: CheckpointDecision): AnalystSession {
  return { ...s, turns: s.turns.map((t) => (t.id !== turnId ? t : { ...t, checkpoints: t.checkpoints.map((c) => (c.id === checkpointId ? { ...c, decision } : c)) })) };
}

/** 이 답변을 만든 뒤 Project state 가 바뀌었는가 ("Based on previous project state" 표시용). 과거 답변의 내용은 다시 계산하지 않는다. */
export const isStale = (t: AnalystTurn, currentSnapshotId: string): boolean => t.contextSnapshotId !== currentSnapshotId;

export const activeTurn = (s: AnalystSession): AnalystTurn | null => s.turns.find((t) => t.id === s.activeId) ?? null;
export const clearSession = (): AnalystSession => emptySession;
