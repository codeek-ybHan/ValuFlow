// STEP 08-8 지표: Tool selection · workflow · 집계. 순수 함수 (테스트 대상).
import type { EvalCase } from './dataset.ts';

export interface ToolSelection {
  executed: string[];
  /** 모든 required Tool 을 호출했고 anyOf 묶음마다 하나 이상 호출했다 */
  hit: boolean;
  /** required 항목(Tool 하나 · anyOf 묶음 하나) 중 충족한 비율 */
  recall: number;
  /** 호출한 Tool 중 기대 집합(required ∪ anyOf ∪ optional)에 속한 비율 */
  precision: number;
  unnecessary: string[];
  missing: string[];
  /** 같은 Tool 을 둘 이상 호출한 횟수 (반복 호출) */
  repeated: number;
}

/** gateway 가 막은 호출(반복 · 승인 필요)은 실행으로 세지 않는다 (반복은 repeated 로 따로 센다). */
const BLOCKED = new Set(['repeat-blocked', 'approval-required', 'invalid-input']);

export function toolSelection(c: Pick<EvalCase, 'requiredTools' | 'anyOf' | 'optionalTools'>, calls: { tool: string; status: string }[]): ToolSelection {
  const counted = calls.filter((x) => !BLOCKED.has(x.status));
  const executed = [...new Set(counted.map((x) => x.tool))];
  const repeated = calls.filter((x) => x.status === 'repeat-blocked').length + (counted.length - executed.length);
  const groups = c.anyOf ?? [];
  const missing = [...c.requiredTools.filter((t) => !executed.includes(t)), ...groups.filter((g) => !g.some((t) => executed.includes(t))).map((g) => g.join('|'))];
  const total = c.requiredTools.length + groups.length;
  const expected = new Set([...c.requiredTools, ...groups.flat(), ...(c.optionalTools ?? [])]);
  const unnecessary = executed.filter((t) => !expected.has(t));
  return {
    executed, hit: missing.length === 0, recall: total === 0 ? 1 : (total - missing.length) / total,
    precision: executed.length === 0 ? (total === 0 ? 1 : 0) : (executed.length - unnecessary.length) / executed.length, unnecessary, missing, repeated,
  };
}

export interface ToolAggregate { cases: number; hitRate: number; recall: number; precision: number; unnecessaryCalls: number; repeatedCalls: number }

export function aggregateTools(list: ToolSelection[]): ToolAggregate {
  const n = list.length || 1;
  const sum = (f: (x: ToolSelection) => number) => list.reduce((s, x) => s + f(x), 0);
  return { cases: list.length, hitRate: sum((x) => (x.hit ? 1 : 0)) / n, recall: sum((x) => x.recall) / n, precision: sum((x) => x.precision) / n, unnecessaryCalls: sum((x) => x.unnecessary.length), repeatedCalls: sum((x) => x.repeated) };
}

export interface StepRecord { tool: string; optional: boolean; status: string; reason?: string | null }

/** 실행 중에 건너뛴(모델이 호출하지 않은) 단계의 사유. 그 밖의 skipped 는 계획 시점에 데이터가 없거나 지원하지 않아 해당이 없는 단계다. */
const RUNTIME_SKIP = new Set(['호출되지 않았습니다.', '필요하지 않아 호출하지 않았습니다.']);
const notApplicable = (s: StepRecord) => s.status === 'skipped' && !RUNTIME_SKIP.has(s.reason ?? '');

/** workflow 평가: 해당되는 required 단계 중 실제로 호출 · 완료된 비율, optional 단계의 실행 비율. */
export function workflowReliability(steps: StepRecord[]): { requiredApplicable: number; requiredAttempted: number; requiredCompleted: number; optionalApplicable: number; optionalExecuted: number } {
  const req = steps.filter((s) => !s.optional && !notApplicable(s));
  const opt = steps.filter((s) => s.optional && !notApplicable(s));
  const attempted = (s: StepRecord) => s.status === 'completed' || s.status === 'failed';
  return { requiredApplicable: req.length, requiredAttempted: req.filter(attempted).length, requiredCompleted: req.filter((s) => s.status === 'completed').length, optionalApplicable: opt.length, optionalExecuted: opt.filter(attempted).length };
}

export const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '-' : `${(x * 100).toFixed(d)}%`);
export const percentile = (xs: number[], p: number): number => { if (xs.length === 0) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };
export const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
