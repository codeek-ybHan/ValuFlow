// STEP 09-4 Report Narrative: AI 가 Report 용 문장을 새로 쓰지 않는다. STEP 08 Grounded Analysis 가 검증한 claim 을 Report 서술 항목으로 조립한다.
//  - 사용: supported · 같은 Project snapshot · evidence/source 로 추적 가능한 claim
//  - 제외: partially-supported · unsupported · stale snapshot · evidence/source 없는 claim (제외 이유를 기록한다)
//  - claim → NarrativeItem 은 1:1 이고 claim 의 text 를 그대로 쓴다 (새 숫자 · 새 문장 없음). 한 claim 은 한 section 에만 나온다.
//  - Fact(objective)와 Judgment 는 basis 로 구분을 유지한다.
import type { GroundedClaim } from '../../ai/grounding/types.ts';
import type { ReportInput } from '../input.ts';
import type { SourceRegistry } from '../sources.ts';
import type { Narrative, NarrativeItem, SectionState } from '../types.ts';

export type NarrativeSectionId = 'executiveSummary' | 'historicalCommentary' | 'forecastCommentary' | 'valuationCommentary' | 'keyRisks' | 'conclusion';
export type RejectionReason = 'partially-supported' | 'unsupported' | 'stale-snapshot' | 'no-evidence' | 'untraceable-evidence' | 'no-source';
export interface NarrativeRejection { claimId: string; reason: RejectionReason }

export interface ReportNarrative {
  sections: Record<NarrativeSectionId, SectionState<Narrative>>;
  /** 사용하지 못한 claim 과 이유 (Appendix · 검증에 쓴다) */
  rejected: NarrativeRejection[];
  /** 검증은 통과했지만 section 별 항목 수 제한으로 싣지 않은 claim 수 */
  omitted: number;
  analysisId: string | null;
  stale: boolean;
}

type Topic = 'historical' | 'forecast' | 'valuation';
const TOOL_TOPIC: Record<string, Topic> = {
  getHistoricalAnalysis: 'historical', getHistoricalQuality: 'historical', getMappingTrace: 'historical', getCompanyOverview: 'historical',
  searchDisclosures: 'historical', searchKnowledge: 'historical', searchUploadedDocuments: 'historical', searchCompanyNews: 'historical',
  getForecastAssumptions: 'forecast', getMarketAssumptions: 'forecast',
  getValuationResult: 'valuation', getSensitivityAnalysis: 'valuation', getScenarioAnalysis: 'valuation', getRelativeValuation: 'valuation', getComparableCompanies: 'valuation', getMarketData: 'valuation',
};
const TOPIC_PRIORITY: Topic[] = ['valuation', 'forecast', 'historical'];
const CONF_RANK = { high: 0, medium: 1, low: 2 } as const;
const LIMITS = { executiveSummary: 4, historicalCommentary: 3, forecastCommentary: 3, valuationCommentary: 3, keyRisks: 5, conclusion: 3 } as const;
const SECTIONS: NarrativeSectionId[] = ['executiveSummary', 'historicalCommentary', 'forecastCommentary', 'valuationCommentary', 'keyRisks', 'conclusion'];

const unavailable = (reason: string): SectionState<Narrative> => ({ status: 'unavailable', reason });

export function buildNarrative(input: ReportInput, reg: SourceRegistry): ReportNarrative {
  const ai = input.aiAnalysis;
  const none = (reason: string, stale = false): ReportNarrative => ({ sections: Object.fromEntries(SECTIONS.map((s) => [s, unavailable(reason)])) as ReportNarrative['sections'], rejected: [], omitted: 0, analysisId: ai?.analysisId ?? null, stale });
  if (!ai) return none('AI 분석(Deep Analysis) 결과가 없습니다.');
  if (ai.contextSnapshotId !== input.snapshot.contextSnapshotId) {
    const r = none('AI 분석이 현재 Report snapshot 과 다른 Project 상태를 기준으로 해서 사용하지 않았습니다.', true);
    r.rejected = ai.claims.map((c) => ({ claimId: c.claimId, reason: 'stale-snapshot' as const }));
    return r;
  }

  const evidence = new Map(ai.evidence.map((e) => [e.evidenceId, e]));
  const rejected: NarrativeRejection[] = [];
  const usable: { claim: GroundedClaim; order: number; topic: Topic; sourceIds: string[] }[] = [];
  ai.claims.forEach((c, order) => {
    const reject = (reason: RejectionReason) => { rejected.push({ claimId: c.claimId, reason }); };
    if (c.status === 'partially-supported') return reject('partially-supported');
    if (c.status !== 'supported') return reject('unsupported');
    if (c.evidenceIds.length === 0) return reject('no-evidence');
    if (!c.evidenceIds.every((id) => evidence.has(id))) return reject('untraceable-evidence');
    const sourceIds = [...new Set(c.evidenceIds.map((id) => reg.fromEvidence(evidence.get(id)!)))];
    if (sourceIds.length === 0 || !sourceIds.every((id) => reg.has(id))) return reject('no-source');
    const topics = c.evidenceIds.map((id) => TOOL_TOPIC[evidence.get(id)!.tool] ?? 'historical');
    usable.push({ claim: c, order, topic: TOPIC_PRIORITY.find((t) => topics.includes(t)) ?? 'historical', sourceIds });
  });

  const item = (u: (typeof usable)[number]): NarrativeItem => ({
    claimId: u.claim.claimId, text: u.claim.text, claimType: u.claim.type, basis: u.claim.basis, confidence: u.claim.confidence ?? null, evidenceIds: [...u.claim.evidenceIds], sourceIds: u.sourceIds,
  });
  const byConf = (a: (typeof usable)[number], b: (typeof usable)[number]) => (CONF_RANK[a.claim.confidence ?? 'low'] - CONF_RANK[b.claim.confidence ?? 'low']) || a.order - b.order;
  const used = new Set<string>();
  const pick = (list: typeof usable, n: number) => { const out = list.slice(0, n); out.forEach((u) => used.add(u.claim.claimId)); return out.sort((a, b) => a.order - b.order); };

  const risks = usable.filter((u) => u.claim.type === 'risk').sort(byConf);
  const recs = usable.filter((u) => u.claim.type === 'recommendation').sort(byConf);
  const narrative = usable.filter((u) => u.claim.type === 'fact' || u.claim.type === 'calculation' || u.claim.type === 'interpretation').sort(byConf);

  // Executive Summary: topic 별 최상위 claim 을 돌아가며 고른다 (Valuation → Forecast → Historical)
  const chosenExec: typeof usable = [];
  const rest = [...narrative];
  while (chosenExec.length < LIMITS.executiveSummary && rest.length > 0) {
    let progressed = false;
    for (const t of TOPIC_PRIORITY) {
      const i = rest.findIndex((u) => u.topic === t);
      if (i >= 0 && chosenExec.length < LIMITS.executiveSummary) { chosenExec.push(rest.splice(i, 1)[0]!); progressed = true; }
    }
    if (!progressed) break;
  }
  const exec = pick(chosenExec, LIMITS.executiveSummary);
  const topical = (t: Topic, n: number) => pick(rest.filter((u) => u.topic === t && !used.has(u.claim.claimId)), n);
  const picks: Record<NarrativeSectionId, typeof usable> = {
    executiveSummary: exec, historicalCommentary: topical('historical', LIMITS.historicalCommentary), forecastCommentary: topical('forecast', LIMITS.forecastCommentary), valuationCommentary: topical('valuation', LIMITS.valuationCommentary),
    keyRisks: pick(risks, LIMITS.keyRisks), conclusion: pick(recs, LIMITS.conclusion),
  };

  const typesOf: Record<NarrativeSectionId, GroundedClaim['type'][]> = { executiveSummary: ['fact', 'calculation', 'interpretation'], historicalCommentary: [], forecastCommentary: [], valuationCommentary: [], keyRisks: ['risk'], conclusion: ['recommendation'] };
  const claimType = new Map(ai.claims.map((c) => [c.claimId, c.type]));
  const sections = Object.fromEntries(SECTIONS.map((s) => {
    const list = picks[s];
    if (list.length === 0) return [s, unavailable('해당 section 에 쓸 수 있는 검증된(supported · 같은 snapshot · 출처 추적 가능) claim 이 없습니다.')];
    const excludedClaims = rejected.filter((r) => typesOf[s].includes(claimType.get(r.claimId)!)).length;
    return [s, { status: 'ok', data: { origin: 'ai-grounded', groundingLevel: 'claim-evidence', analysisId: ai.analysisId, contextSnapshotId: ai.contextSnapshotId, items: list.map(item), excludedClaims, limitations: [...ai.limitations] } } as SectionState<Narrative>];
  })) as ReportNarrative['sections'];

  const omitted = usable.filter((u) => !used.has(u.claim.claimId)).length;
  return { sections, rejected, omitted, analysisId: ai.analysisId, stale: false };
}
