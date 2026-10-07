import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssumptionsDraft } from '../../store/assumptions';

type Errors = Record<string, string>;
type Parsed<I> = { ok: true; value: I } | { ok: false; errors: Errors };

interface Options<V, I> {
  assumptions: AssumptionsDraft | null;
  /** 저장된 가정 → 폼 문자열 (없는 값은 '') */
  toForm: (a: AssumptionsDraft | null) => V;
  /** 편집 중인 문자열(drafts)을 기준 폼 위에 덮는다 */
  merge: (base: V, drafts: Record<string, string>) => V;
  /** 폼 문자열 → 입력(소수 / 억원) + 필드별 검증 */
  parse: (values: V) => Parsed<I>;
  /** 현재 가정이 방금 우리가 반영한 입력과 같은지 (같으면 외부 변경이 아니다) */
  isOurs: (a: AssumptionsDraft, pushed: I) => boolean;
  /** 유효하고 완성된 입력을 가정에 반영 (이전 결과는 비워진다) */
  push: (value: I) => void;
  /** 입력이 유효하지 않을 때: 가정은 유지하고 어긋난 결과만 비운다 */
  onInvalid: () => void;
}

/**
 * Forecast / WACC 입력 폼 공통 로직.
 * - 사용자가 타이핑하는 문자열(drafts)을 그대로 보여 준다 ("1." 같은 중간 입력이 지워지지 않는다).
 * - 유효하고 완성된 입력만 가정에 반영한다.
 * - 가정이 외부에서 바뀌면(학습용 가정 적용, 초기화 등) drafts 를 지운다.
 */
export function useAssumptionForm<V, I>(options: Options<V, I>) {
  const o = useRef(options);
  o.current = options;

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const lastPushed = useRef<I | null>(null);

  const { assumptions } = options;
  useEffect(() => {
    const ours = assumptions !== null && lastPushed.current !== null && o.current.isOurs(assumptions, lastPushed.current);
    if (!ours) {
      setDrafts({});
      setTouched(new Set());
    }
  }, [assumptions]);

  const base = useMemo(() => o.current.toForm(assumptions), [assumptions]);
  const values = useMemo(() => o.current.merge(base, drafts), [base, drafts]);
  const parsed = useMemo(() => o.current.parse(values), [values]);
  const errors: Errors = parsed.ok ? {} : parsed.errors;

  const edit = (key: string, text: string) => {
    const nextDrafts = { ...drafts, [key]: text };
    setDrafts(nextDrafts);
    setTouched((t) => new Set(t).add(key));
    const next = o.current.parse(o.current.merge(base, nextDrafts));
    if (next.ok) {
      lastPushed.current = next.value;
      o.current.push(next.value);
    } else {
      o.current.onInvalid();
    }
  };
  const blur = (key: string) => setTouched((t) => new Set(t).add(key));
  /** 사용자가 건드린 칸의 오류만 보여 준다 (빈 폼에 오류가 한꺼번에 뜨지 않게) */
  const shown = (key: string): string | undefined => (touched.has(key) ? errors[key] : undefined);

  return { values, parsed, errors, touched, edit, blur, shown };
}
