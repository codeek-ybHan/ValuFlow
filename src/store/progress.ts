import type { Step } from '../types';
import type { AppState } from './state';

export type StepStatus = 'NOT STARTED' | 'IN PROGRESS' | 'COMPLETE';

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  to: string;
}

export const lessonKey = (stepId: number, lessonId: string) => `${stepId}:${lessonId}`;

export function checklist(step: Step, s: AppState): ChecklistItem[] {
  const base = `/learn/step/${step.id}`;
  const items: ChecklistItem[] = step.lessons.map((l, i) => ({
    id: `lesson-${l.id}`,
    label: `LESSON ${String(i + 1).padStart(2, '0')} ${l.title}`,
    done: !!s.lessons[lessonKey(step.id, l.id)],
    to: `${base}/lesson/${l.id}`,
  }));
  if (step.quiz) items.push({ id: 'quiz', label: 'Check Quiz', done: !!s.quiz[step.id]?.completed, to: `${base}/quiz` });
  items.push({ id: 'practice', label: '실제 기업 Practice', done: !!s.practice[step.id]?.completed, to: `${base}/practice` });
  items.push({ id: 'build', label: 'Project Build', done: !!s.build[step.id]?.completed, to: `${base}/build` });
  items.push({ id: 'reflection', label: `${step.code} Reflection`, done: !!s.reflection[step.id]?.completed, to: `${base}/reflection` });
  return items;
}

export function stepProgress(step: Step, s: AppState) {
  const items = checklist(step, s);
  const done = items.filter((i) => i.done).length;
  const status: StepStatus = done === items.length ? 'COMPLETE' : done > 0 ? 'IN PROGRESS' : 'NOT STARTED';
  return { items, done, total: items.length, ratio: done / items.length, status };
}

export function overallProgress(steps: Step[], s: AppState) {
  let done = 0;
  let total = 0;
  for (const st of steps) {
    const p = stepProgress(st, s);
    done += p.done;
    total += p.total;
  }
  return { done, total, ratio: total ? done / total : 0 };
}

/** 로드맵 표시 라벨. 잠금은 권장 순서 안내일 뿐 접근을 막지 않는다. */
export type RoadmapLabel = 'COMPLETE' | 'IN PROGRESS' | 'NEXT' | 'LOCKED';

export function roadmapLabels(steps: Step[], s: AppState): RoadmapLabel[] {
  const st = steps.map((x) => stepProgress(x, s).status);
  let nextAssigned = false;
  return st.map((status) => {
    if (status === 'COMPLETE') return 'COMPLETE';
    if (status === 'IN PROGRESS') return 'IN PROGRESS';
    if (!nextAssigned) {
      nextAssigned = true;
      return 'NEXT';
    }
    return 'LOCKED';
  });
}

/** 현재 진행 중인(없으면 다음) STEP */
export function currentStep(steps: Step[], s: AppState): Step {
  return (
    steps.find((x) => stepProgress(x, s).status === 'IN PROGRESS') ??
    steps.find((x) => stepProgress(x, s).status !== 'COMPLETE') ??
    steps[steps.length - 1]
  );
}

/** 지금 이어서 해야 할 첫 미완료 항목 (없으면 현재 STEP 개요) */
export function nextAction(steps: Step[], s: AppState): { step: Step; to: string; label: string } {
  const step = currentStep(steps, s);
  const item = stepProgress(step, s).items.find((i) => !i.done);
  return { step, to: item ? item.to : `/learn/step/${step.id}`, label: item ? item.label : `${step.code} 개요` };
}
