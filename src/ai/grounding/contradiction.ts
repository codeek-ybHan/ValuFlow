// Source 충돌 탐지: 같은 지표를 서로 다른 source 가 다르게 말할 때 충돌을 숨기지 않는다.
// 우선순위: ValuFlow deterministic 결과 / OpenDART 정규화 실적 > 외부 provider 값. 충돌하면 provider 값은 재무 Actual 로 쓰지 않는다.
import type { EvidenceIndex } from './evidence.ts';
import type { Contradiction, Evidence } from './types.ts';

/** 같은 비율 지표가 이 값(절대 차이, 비율 단위)보다 다르면 충돌로 본다 (영업이익률 13% vs 52% 같은 경우). */
export const CONFLICT_THRESHOLD = 0.10;
const METRICS = ['operatingMargin', 'revenueGrowth'] as const;

const latest = (list: Evidence[], metric: string): Evidence | null => {
  const re = new RegExp(`^metrics\\.${metric}\\.values\\[(\\d+)\\]$`);
  const cands = list.filter((e) => !e.missing && typeof e.value === 'number' && re.test(e.fieldPath ?? ''));
  cands.sort((a, b) => Number(re.exec(b.fieldPath!)![1]) - Number(re.exec(a.fieldPath!)![1]));
  return cands[0] ?? null;
};

export function detectContradictions(index: EvidenceIndex): Contradiction[] {
  const out: Contradiction[] = [];
  for (const metric of METRICS) {
    const a = latest(index.byTool.get('getHistoricalAnalysis') ?? [], metric);
    const b = (index.byTool.get('getComparableCompanies') ?? []).find((e) => e.fieldPath === `subject.${metric}` && typeof e.value === 'number' && !e.missing);
    if (!a || !b) continue;
    const av = a.value as number, bv = b.value as number;
    if (Math.abs(av - bv) > CONFLICT_THRESHOLD) {
      out.push({
        metric, preferred: { evidenceId: a.evidenceId, value: av }, other: { evidenceId: b.evidenceId, value: bv, provider: b.provider?.name },
        note: `외부 provider 값(${(bv * 100).toFixed(1)}%)이 OpenDART 기준 값(${(av * 100).toFixed(1)}%)과 불일치해 재무 Actual 에는 사용하지 않았습니다.`,
      });
    }
  }
  return out;
}
