// LEARN 라우트 규칙: /learn/step-01 … step-04. URL 표기와 내부 stepId(number) 변환을 한 곳에서 관리한다.

export const stepSlug = (id: number) => `step-${String(id).padStart(2, '0')}`;
export const stepPath = (id: number) => `/learn/${stepSlug(id)}`;

/** 'step-03' → 3. 형식이 맞지 않으면 NaN (getStep 에서 undefined 처리됨) */
export function stepIdFromSlug(slug: string | undefined): number {
  const m = slug?.match(/^step-(\d+)$/);
  return m ? Number(m[1]) : NaN;
}
