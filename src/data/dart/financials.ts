// OpenDART 재무제표 요청 모델. (STEP 06-1: 타입만 정의하고 HTTP 호출은 구현하지 않는다.)
import type { DartBasis } from './types.ts';

export interface DartFinancialsRequest {
  corpCode: string;
  /** 사업보고서의 사업연도. 한 보고서에는 당기·전기·전전기가 함께 들어 있다. */
  reportYear: number;
  basis: DartBasis;
}
