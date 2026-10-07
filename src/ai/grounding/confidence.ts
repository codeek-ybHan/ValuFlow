// Source priority · Confidence.
//  High: ValuFlow deterministic Tool 의 직접 값 (엔진 결과 · 정규화된 공시 실적 · 사용자 가정)
//  Medium: 공시 · 업로드 문서, 공식 / 상용 external provider
//  Low: 개발용 · 비공식 provider, 뉴스
//  내려가는 경우: Historical DataQuality 가 partial · ambiguous · missing · review, 검색 품질이 약함(순위가 낮거나 같은 검색의 최고 점수 대비 낮음).
//  해석 · 위험 · 권고(judgment)는 근거가 아무리 좋아도 high 가 될 수 없다 (객관적 사실이 아니다).
import type { ClaimType, Confidence, Evidence } from './types.ts';

const ORDER: Confidence[] = ['low', 'medium', 'high'];
const down = (c: Confidence): Confidence => ORDER[Math.max(0, ORDER.indexOf(c) - 1)];
const min = (a: Confidence, b: Confidence): Confidence => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

const OFFICIAL = new Set(['official', 'commercial']);
const isEngine = (e: Evidence) => e.sourceKind === 'calculated' || e.sourceKind === 'actual' || e.sourceKind === 'assumption';

/** 낮을수록 우선: 1 ValuFlow 엔진 결과 · 2 OpenDART 정규화 실적 / 사용자 가정 · 3 공식 공시 · 4 업로드 문서 · 5 공식 external provider · 6 개발용 provider · 7 뉴스. */
export function sourcePriority(e: Evidence): number {
  if (e.sourceKind === 'calculated') return 1;
  if (e.sourceKind === 'actual' || e.sourceKind === 'assumption') return 2;
  if (e.sourceType === 'disclosure-document') return 3;
  if (e.sourceType === 'uploaded-document') return 4;
  if (e.sourceType === 'news') return 7;
  if (e.provider && OFFICIAL.has(e.provider.reliability) && e.provider.tier === 'production') return 5;
  return 6;
}

/** deterministic Tool 결과인가 (calculation claim 의 근거 조건). */
export const isDeterministic = (e: Evidence): boolean => isEngine(e);

export function evidenceConfidence(e: Evidence): { level: Confidence; notes: string[] } {
  const notes: string[] = [];
  let level: Confidence;
  if (isEngine(e)) level = 'high';
  else if (e.sourceType === 'disclosure-document' || e.sourceType === 'uploaded-document') level = 'medium';
  else if (e.sourceType === 'news') { level = 'low'; notes.push('news (headline-level source)'); }
  else if (e.provider && OFFICIAL.has(e.provider.reliability) && e.provider.tier === 'production') level = 'medium';
  else { level = 'low'; notes.push(`provider ${e.provider?.name ?? 'external'} is ${e.provider?.reliability ?? 'unverified'} (${e.provider?.tier ?? 'development'} tier)`); }
  if (e.quality && e.quality !== 'available' && e.quality !== 'ok') { level = down(level); notes.push(`data quality: ${e.quality}`); }
  const r = e.retrieval;
  if (r) {
    const weakRank = r.rank !== undefined && r.rank > 3;
    const weakScore = typeof r.rerankScore === 'number' && typeof r.maxRerank === 'number' && r.maxRerank > 0 && r.rerankScore < 0.5 * r.maxRerank;   // 절대 임계값이 아니라 같은 검색 안에서의 상대 비교
    if (weakRank || weakScore) { level = down(level); notes.push(weakRank ? `retrieval rank ${r.rank}` : 'retrieval score is low relative to the best passage'); }
  }
  return { level, notes };
}

export function claimConfidence(evidence: Evidence[], type: ClaimType): { level: Confidence | undefined; notes: string[] } {
  if (evidence.length === 0) return { level: undefined, notes: [] };
  const per = evidence.map(evidenceConfidence);
  let level = per.map((p) => p.level).reduce(min);
  const notes = [...new Set(per.flatMap((p) => p.notes))];
  // 문서 근거가 하나뿐이면 한 단계 낮춘다 (여러 근거가 서로 받쳐 주지 않는다)
  const docs = evidence.filter((e) => e.retrieval);
  if (docs.length === 1 && evidence.length === 1 && docs[0].retrieval!.count > 1) { level = down(level); notes.push('single supporting passage'); }
  if (type === 'interpretation' || type === 'risk' || type === 'recommendation') level = min(level, 'medium');
  return { level, notes };
}
