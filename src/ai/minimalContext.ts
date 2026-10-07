// 질문과 함께 backend 로 보내는 가벼운 context 요약. 수치 · Raw 행 · 전체 ProjectState 를 담지 않는다 (필요한 값은 Tool 로 조회한다).
import type { AiValuationContext } from './context.ts';
import { getCompanyOverview } from './tools/historical.ts';

export function buildMinimalContext(ctx: AiValuationContext): Record<string, unknown> {
  const r = getCompanyOverview(ctx);
  if (r.status !== 'ok') return {};
  const d = r.data;
  return { company: d.company, support: d.support, dataKinds: d.dataKinds, periods: d.periods, availability: d.availability };
}
