// STEP 08-6 Grounded Analysis: Claim → Evidence → Source 를 추적하기 위한 타입.
// 원칙: 계산은 ValuFlow deterministic Tool, 근거는 Tool 결과의 구체적 값 · 문단 · 기사, 해석은 LLM. LLM 이 만든 숫자는 Evidence 가 아니다.

/** Tool 결과에서 뽑은 구체적 근거 한 건 (숫자 하나 · 문서 문단 하나 · 뉴스 한 건 · 값 없음 표시). Tool 결과 전체를 복사하지 않는다. */
export interface Evidence {
  /** `${tool}[#n]:${fieldPath}` — 같은 Tool 이 여러 번 실행되면 두 번째부터 #n 이 붙는다. */
  evidenceId: string;
  tool: string;
  /** financial-data | disclosure-document | uploaded-document | market-data | peer-data | news (Tool 출처의 type, 없으면 kind) */
  sourceType: string;
  /** actual(공시 기반 실적) | assumption(사용자 가정) | calculated(엔진 결과) | document | external */
  sourceKind: string;
  origin?: string;
  /** Tool 결과 data 안의 경로 (예: `metrics.operatingMargin.values[2]`, `results[0]`) */
  fieldPath?: string;
  value?: unknown;
  unit?: string;
  /** Historical series 의 기간 라벨 (2025A) */
  period?: string;
  documentId?: string;
  page?: number;
  section?: string;
  /** 관측 시점 (시장: asOf · 뉴스: publishedAt · 공시: 공시일) */
  asOf?: string;
  /** 사람이 읽는 출처 라벨 (보고서명 · 문서 제목 · 기사 제목 · provider) */
  sourceLabel?: string;
  url?: string;
  /** 값이 없다고 표시된 항목 ({status:'missing'}): 근거로 쓸 수 없다 */
  missing?: boolean;
  /** 문서 · 뉴스 근거의 짧은 발췌 (표시용, ≤240자). audit 에는 저장하지 않는다. */
  excerpt?: string;
  /** 외부 provider 의 신뢰 등급 (ProviderInfo) */
  provider?: { name: string; reliability: string; tier: string };
  /** Historical DataQuality: 지표 상태(available | partial | ambiguous | missing …) 또는 Tool 의 review 경고('review') */
  quality?: string;
  /** 검색 품질 (문서 근거): 순위 · 점수 · 같은 검색의 결과 수 */
  retrieval?: { retrievalScore?: number; rerankScore?: number | null; rank?: number; count: number; maxRerank?: number | null };
}

export type ClaimType = 'fact' | 'calculation' | 'interpretation' | 'risk' | 'recommendation';
export type Confidence = 'high' | 'medium' | 'low';
export type ClaimStatus = 'supported' | 'partially-supported' | 'unsupported';

export type GroundingIssueCode =
  | 'no-evidence' | 'ungrounded-number' | 'number-from-other-tool' | 'evidence-ref-invalid' | 'evidence-missing-value' | 'text-not-in-evidence' | 'tool-not-executed'
  | 'number-field-mismatch' | 'valuation-number-not-from-engine' | 'calculation-not-deterministic' | 'contradicted-by-priority-source' | 'time-basis-not-stated' | 'wacc-component-conflation';

export interface NumberCheck {
  /** 문장에 적힌 그대로 (예: "13.1%", "1,763조원") */
  text: string;
  status: 'grounded' | 'grounded-other-tool' | 'derived' | 'ungrounded';
  evidenceIds: string[];
}

/** 모델이 만든 claim (검증 전). evidenceRefs 는 Tool 이름과 그 결과 data 안의 fieldPath. */
export interface RawClaim {
  claimId: string;
  text: string;
  type: ClaimType;
  evidenceRefs: { tool: string; fieldPath: string | null }[];
}

/** 검증을 거친 claim: 연결된 Evidence · 상태 · 신뢰도. fact / calculation 은 객관 근거, 나머지는 judgment 다. */
export interface GroundedClaim {
  claimId: string;
  text: string;
  type: ClaimType;
  /** objective: 수치 · 문서로 확인되는 사실 · judgment: 해석 · 위험 · 권고 (근거가 있어도 객관적 사실이 되지 않는다) */
  basis: 'objective' | 'judgment';
  evidenceIds: string[];
  status: ClaimStatus;
  confidence?: Confidence;
  numbers: NumberCheck[];
  issues: GroundingIssueCode[];
  /** 이 claim 의 신뢰도를 낮춘 이유 (provider 등급 · 데이터 품질 · 검색 품질) */
  confidenceNotes: string[];
}

export interface Contradiction {
  metric: string;
  /** 우선하는 source (ValuFlow / OpenDART) */
  preferred: { evidenceId: string; value: number };
  other: { evidenceId: string; value: number; provider?: string };
  note: string;
}

/** Evidence Graph: claim → evidence → (tool, source). */
export interface EvidenceGraphEdge { claimId: string; evidenceId: string; tool: string; sourceType: string }

export interface GroundingIssue { target: string; code: string; detail: string; blocking: boolean }

export interface GroundingReport {
  evidenceCount: number;
  claims: GroundedClaim[];
  /** summary 문장의 수치 검증 (claim 에 속하지 않은 숫자 포함) */
  summaryNumbers: NumberCheck[];
  /** claims · summary 에서 실제 쓰인 근거만 (표시용 Evidence Map) */
  evidenceMap: Evidence[];
  graph: EvidenceGraphEdge[];
  contradictions: Contradiction[];
  /** 시점이 다른 데이터가 함께 쓰였을 때의 시점 요약 */
  timeBasis: { historical?: string; market?: string; news?: string } | null;
  hallucinatedSources: number;
  issues: GroundingIssue[];
  /** groundedClaims / totalClaims (핵심 claim 만; 모든 문장을 claim 으로 세지 않는다) */
  coverage: number | null;
  stats: { claims: number; supported: number; partial: number; unsupported: number; numbersChecked: number; numbersUngrounded: number };
}

/** audit 용: 개수와 코드만 담는다 (근거 값 · 발췌 · 문장은 저장하지 않는다). */
export interface GroundingAuditEvent {
  totalClaims: number;
  groundedClaims: number;
  violations: string[];
  unsupportedNumbers: number;
  hallucinatedSources: number;
  contradictions: number;
  corrections: string[];
  fallbackUsed: boolean;
  regenerated: boolean;
  coverage: number | null;
  evidenceCount: number;
}
