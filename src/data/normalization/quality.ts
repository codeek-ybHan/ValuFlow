// Normalization 결과의 데이터 품질 보고.
import type { DartBasis } from '../dart/types.ts';
import type { CanonicalField } from './accounts.ts';

/** available: 모든 연도에 값이 있음 · partial: 일부 연도만 있음 · missing: 없음 · ambiguous: 값은 있으나 후보가 여러 개(첫 후보 사용) */
export type FieldStatus = 'available' | 'partial' | 'missing' | 'ambiguous';

export interface FieldQuality {
  status: FieldStatus;
  /** 값이 없는 연도 (status 가 partial / missing 일 때). */
  missingYears: number[];
  /** 실제로 사용한 공시 계정명 (추적용). */
  sources: string[];
}

export interface DataQuality {
  basisRequested: DartBasis;
  basisUsed: DartBasis;
  /** 요청한 기준으로 데이터를 만들 수 없어 다른 기준을 사용했는가. */
  basisFallback: boolean;
  fields: Partial<Record<CanonicalField, FieldQuality>>;
  /** 사람이 읽는 경고. 예: "D&A account not found" */
  warnings: string[];
}
