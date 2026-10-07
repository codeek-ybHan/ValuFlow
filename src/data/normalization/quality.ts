// Normalization 결과의 데이터 품질 보고.
import type { DartBasis } from '../dart/types.ts';
import type { CanonicalField } from './accounts.ts';

/** available: 모든 연도에 값이 있음 · partial: 일부 연도만 있음 · missing: 없음 · ambiguous: 값은 있으나 후보가 여러 개(첫 후보 사용) */
export type FieldStatus = 'available' | 'partial' | 'missing' | 'ambiguous';

/** 값을 찾은 방식. account-id: XBRL ID · exact-name: 계정명 일치 · weak-name: 비슷한 계정명 · sum: 구성 계정 합산 */
export type MatchType = 'account-id' | 'exact-name' | 'weak-name' | 'sum';

export interface FieldQuality {
  status: FieldStatus;
  /** 이 필드를 찾으려 한 출처 (없는 경우에도 기록한다). 예: 'OpenDART Financial Statement' */
  source?: string;
  /** 값을 찾은 방식 (찾지 못하면 없음). */
  matchType?: MatchType;
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
