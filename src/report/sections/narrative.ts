// AI Narrative 선택: STEP 08 Grounded Analysis 가 검증한 claim 만 쓴다. 새 문장 · 새 숫자를 만들지 않는다.
//  - supported + evidence 가 있고 그 evidence 가 입력에 실제로 존재하는 claim 만 포함한다 (추적할 수 없는 claim 은 제외).
//  - AI 분석이 Report 와 다른 Project snapshot 을 기준으로 했으면(stale) 사용하지 않는다.
import type { ClaimType } from '../../ai/grounding/types.ts';
import type { ReportInput } from '../input.ts';
import type { SourceRegistry } from '../sources.ts';
import type { Narrative, NarrativeItem, SectionState } from '../types.ts';

export function selectNarrative(input: ReportInput, reg: SourceRegistry, types: ClaimType[], max: number): SectionState<Narrative> {
  const ai = input.aiAnalysis;
  if (!ai) return { status: 'unavailable', reason: 'AI 분석(Deep Analysis) 결과가 없습니다.' };
  if (ai.contextSnapshotId !== input.snapshot.contextSnapshotId) return { status: 'unavailable', reason: 'AI 분석이 현재 Report snapshot 과 다른 Project 상태를 기준으로 해서 사용하지 않았습니다.' };
  const evidenceById = new Map(ai.evidence.map((e) => [e.evidenceId, e]));
  const wanted = ai.claims.filter((c) => types.includes(c.type));
  const usable = wanted.filter((c) => c.status === 'supported' && c.evidenceIds.length > 0 && c.evidenceIds.every((id) => evidenceById.has(id)));
  const items: NarrativeItem[] = usable.slice(0, max).map((c) => ({
    claimId: c.claimId, text: c.text, claimType: c.type, basis: c.basis, confidence: c.confidence ?? null, evidenceIds: [...c.evidenceIds],
    sourceIds: [...new Set(c.evidenceIds.map((id) => reg.fromEvidence(evidenceById.get(id)!)))],
  }));
  if (items.length === 0) return { status: 'unavailable', reason: wanted.length === 0 ? '해당 유형의 AI claim 이 없습니다.' : '검증을 통과한(supported · 근거 추적 가능) claim 이 없습니다.' };
  return { status: 'ok', data: { origin: 'ai-grounded', groundingLevel: 'claim-evidence', analysisId: ai.analysisId, contextSnapshotId: ai.contextSnapshotId, items, excludedClaims: wanted.length - items.length, limitations: [...ai.limitations] } };
}
