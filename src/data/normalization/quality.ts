// Normalization 결과의 데이터 품질 보고. 단일 점수는 만들지 않고, 필드별 상태 + warnings + 추적 정보로 설명한다.
import type { DartBasis } from '../dart/types.ts';
import type { CanonicalField } from './accounts.ts';

/** available: 모든 연도에 값이 있음 · partial: 일부 연도만 있음 · missing: 없음 · ambiguous: 값은 있으나 weak 매핑이거나 후보 값이 여러 개(첫 후보 사용) */
export type FieldStatus = 'available' | 'partial' | 'missing' | 'ambiguous';

/** 값을 찾은 방식. account-id → exact-name → alias → weak 순으로 신뢰도가 낮아진다. sum 은 구성 계정 합산(각 구성요소의 방식은 trace.components). */
export type MatchType = 'account-id' | 'exact-name' | 'alias' | 'weak' | 'sum';

export interface FieldQuality {
  status: FieldStatus;
  /** 이 필드를 찾으려 한 출처 (없는 경우에도 기록한다). 예: 'OpenDART Financial Statement' */
  source?: string;
  /** 연도별 매칭 방식 중 가장 신뢰도가 낮은 것 (찾지 못하면 없음). */
  matchType?: MatchType;
  /** 값이 없는 연도 (status 가 partial / missing 일 때). */
  missingYears: number[];
  /** 실제로 사용한 공시 계정명 (추적용). */
  sources: string[];
}

export interface TraceComponent {
  accountName: string;
  accountId: string | null;
  /** KRW million */
  value: number;
  matchType: Exclude<MatchType, 'sum'>;
}

/** "이 숫자가 어디서 왔는가": canonical field 의 연도별 값과 원본 계정. */
export interface MappingTrace {
  canonicalField: CanonicalField;
  fiscalYear: number;
  /** KRW million (취득 계정은 크기). */
  value: number;
  sourceAccountName: string;
  sourceAccountId: string | null;
  matchType: MatchType;
  /** 원본 구분 (BS / IS / CIS / CF) */
  rawStatementType: string;
  /** CFS 연결 · OFS 별도 */
  basis: 'CFS' | 'OFS';
  /** 후보가 여러 개였을 때 왜 이것을 골랐는가. */
  selection?: string;
  /** 합산 필드(이자부부채 · D&A · 리스부채)의 구성 계정. */
  components?: TraceComponent[];
}

export interface QualityCheck {
  name: string;
  fiscalYear?: number;
  status: 'pass' | 'warn';
  message: string;
}

export interface DataQuality {
  basisRequested: DartBasis;
  basisUsed: DartBasis;
  /** 요청한 기준으로 데이터를 만들 수 없어 다른 기준을 사용했는가. */
  basisFallback: boolean;
  fields: Partial<Record<CanonicalField, FieldQuality>>;
  /** 사람이 읽는 경고. 예: "D&A not available from current OpenDART financial statement source." */
  warnings: string[];
  /** 필드 × 연도별 매핑 추적. */
  trace: MappingTrace[];
  /** 회계 항등식 · 연도 간 검증 결과 (실패해도 값은 수정하지 않고 warning 만 더한다). */
  checks: QualityCheck[];
}

/** field / year 의 매핑 추적을 찾는다. */
export function traceFor(quality: DataQuality, field: CanonicalField, fiscalYear: number): MappingTrace | undefined {
  return quality.trace.find((t) => t.canonicalField === field && t.fiscalYear === fiscalYear);
}
