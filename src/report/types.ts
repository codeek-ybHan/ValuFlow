// STEP 09-1 Report 의 기본 타입. Report 는 Project State(UI state)를 직접 읽지 않는다:
//   Project State → ReportInput(snapshot) → ReportModel → Renderer / Export
// 이 파일의 타입은 숫자 · 출처 · 상태(Actual / Estimate / Calculated, missing / unavailable / not-applicable)를 구분해서 담는다.

export const REPORT_SCHEMA_VERSION = '1.0' as const;
export type ReportSchemaVersion = typeof REPORT_SCHEMA_VERSION;

/** Actual: 공시 확정값 · Estimate: 가정 · 예측값(2026E …) · Calculated: 엔진이 계산한 결과. Estimate 를 Actual 처럼 표현하지 않는다. */
export type DataKind = 'actual' | 'estimate' | 'calculated';

/** 값이 없는 이유를 구분한다: missing(있어야 하는데 없음) · unavailable(출처가 제공하지 않음) · not-applicable(정의상 해당 없음). 0 · N/A 로 뭉뚱그리지 않는다. */
export type CellState = 'ok' | 'missing' | 'unavailable' | 'not-applicable';

/** eok 억원 · won 원(주당) · ratio 소수(표시는 %) · shares 주 · multiple 배 · factor 단위 없는 값(베타 · 할인계수) */
export type ReportUnit = 'eok' | 'won' | 'ratio' | 'shares' | 'multiple' | 'factor';

export interface Cell {
  state: CellState;
  /** 원본 값(반올림하지 않는다). ok 가 아니면 null */
  value: number | null;
  unit: ReportUnit;
  kind: DataKind;
  /** 정책 단위로 만든 표시 문자열 (display.ts 의 deterministic 환산). ok 가 아니면 null */
  text: string | null;
  /** 1조원 이상 금액의 조원 표기 (보조) */
  largeText: string | null;
  /** ReportModel.sources 의 id. 모든 숫자는 출처를 추적할 수 있다. */
  sourceId: string | null;
  /** ok 가 아닐 때의 사유 */
  reason: string | null;
}

export type SourceKind = 'historical' | 'assumption' | 'engine' | 'market' | 'disclosure' | 'document' | 'news' | 'ai';

export interface SourceRef {
  id: string;
  kind: SourceKind;
  label: string;
  /** opendart · database · fixture · user-input · learning-fixture · valuation-engine · yahoo-finance … (Report 가 새로 만들지 않고 원본 출처에서 가져온다) */
  origin: string;
  basis: string | null;
  asOf: string | null;
  /** 외부 provider 등급 (development · unofficial …) */
  reliability: string | null;
  note: string | null;
}

export interface PeriodLabel { label: string; kind: 'actual' | 'estimate' }

/** 선택 section 은 없을 수 있다: 없으면 이유와 함께 상태로 남긴다 (빈 표를 만들지 않는다). */
export type SectionState<T> =
  | { status: 'ok'; data: T }
  | { status: 'unavailable' | 'missing' | 'not-applicable'; reason: string };

// ---- AI narrative (STEP 08 Grounded Analysis 결과만 재사용한다) ----
export interface NarrativeItem {
  claimId: string;
  text: string;
  claimType: 'fact' | 'calculation' | 'interpretation' | 'risk' | 'recommendation';
  /** objective: 수치 · 문서로 확인되는 사실 · judgment: AI 의 해석 · 위험 · 제안 */
  basis: 'objective' | 'judgment';
  confidence: 'high' | 'medium' | 'low' | null;
  evidenceIds: string[];
  /** evidence 를 SourceRef 로 연결한 id */
  sourceIds: string[];
}

export interface Narrative {
  origin: 'ai-grounded';
  groundingLevel: 'claim-evidence';
  analysisId: string;
  /** 이 분석을 만든 Project snapshot (Report snapshot 과 같아야 쓸 수 있다) */
  contextSnapshotId: string;
  items: NarrativeItem[];
  /** 검증을 통과하지 못해 제외한 claim 수 */
  excludedClaims: number;
  limitations: string[];
}
