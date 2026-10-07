import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackendAiClient, type AiGatewayClient } from '../ai/client.ts';
import { askAnalyst, cancelledTurn, resolveMode, type Progress } from '../ai/analyst/ask.ts';
import { activeTurn, addTurn, decideCheckpoint, emptySession, selectTurn, type AnalystSession } from '../ai/analyst/session.ts';
import type { AnalystTurn, CheckpointDecision, ModePreference } from '../ai/analyst/view.ts';
import { buildAiContext } from '../ai/context.ts';
import { useProject } from './project';

// AI Analyst 의 대화 state. Project(valuation) state 와 분리되어 있고, 여기서 Project 를 바꾸는 함수는 하나도 쓰지 않는다 (읽기 전용).

interface Ctx {
  session: AnalystSession;
  active: AnalystTurn | null;
  running: Progress | null;
  preference: ModePreference;
  setPreference: (p: ModePreference) => void;
  ask: (question: string) => Promise<void>;
  cancel: () => void;
  select: (id: string | null) => void;
  decide: (turnId: string, checkpointId: string, decision: CheckpointDecision) => void;
}
const AnalystCtx = createContext<Ctx | null>(null);

export function AnalystProvider({ children, client, initial }: { children: ReactNode; client?: AiGatewayClient; initial?: AnalystSession }) {
  const { project, historicalStatus } = useProject();
  const [session, setSession] = useState<AnalystSession>(initial ?? emptySession);
  const [running, setRunning] = useState<Progress | null>(null);
  const [preference, setPreference] = useState<ModePreference>('auto');
  const gateway = useMemo(() => client ?? new BackendAiClient(), [client]);
  const seq = useRef(0);                                  // 취소했거나 늦게 도착한 결과는 버린다
  const abort = useRef<{ aborted: boolean } | null>(null);
  const pending = useRef<{ question: string } | null>(null);
  const latest = useRef({ project, historicalStatus });
  latest.current = { project, historicalStatus };

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (q === '' || abort.current) return;
    const mine = ++seq.current;
    const signal = { aborted: false };
    abort.current = signal;
    pending.current = { question: q };
    const { project: p, historicalStatus: hs } = latest.current;       // 질문 시점의 Project snapshot
    setRunning({ mode: resolveMode(q, buildAiContext(p, { historicalStatus: hs }), preference), label: null, steps: [], text: '질문을 준비하는 중…' });
    const turn = await askAnalyst({ question: q, project: p, historicalStatus: hs, client: gateway, preference, signal, onProgress: (pr) => { if (seq.current === mine) setRunning(pr); } });
    if (seq.current !== mine) return;
    abort.current = null;
    pending.current = null;
    setRunning(null);
    setSession((s) => addTurn(s, turn));
  }, [gateway, preference]);

  const cancel = useCallback(() => {
    const q = pending.current?.question;
    if (!abort.current || q === undefined) return;
    abort.current.aborted = true;
    seq.current += 1;
    abort.current = null;
    pending.current = null;
    const { project: p, historicalStatus: hs } = latest.current;
    setRunning(null);
    setSession((s) => addTurn(s, cancelledTurn({ question: q, project: p, historicalStatus: hs }, resolveMode(q, buildAiContext(p, { historicalStatus: hs }), preference))));
  }, [preference]);

  const select = useCallback((id: string | null) => setSession((s) => selectTurn(s, id)), []);
  const decide = useCallback((turnId: string, checkpointId: string, decision: CheckpointDecision) => setSession((s) => decideCheckpoint(s, turnId, checkpointId, decision)), []);
  const value = useMemo(() => ({ session, active: activeTurn(session), running, preference, setPreference, ask, cancel, select, decide }), [session, running, preference, ask, cancel, select, decide]);
  return <AnalystCtx.Provider value={value}>{children}</AnalystCtx.Provider>;
}

export function useAnalyst() {
  const c = useContext(AnalystCtx);
  if (!c) throw new Error('AnalystProvider 가 필요합니다.');
  return c;
}
