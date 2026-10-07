// Historical D&A 의 사용 가능 여부와 안내 문구. D&A 는 출처가 없으면 missing 으로 두고 어떤 방법으로도 추정하지 않는다
// (0 으로 저장 / 학습용 값 삽입 / CAPEX 비율 / PPE 증감 역산 / 산업 평균 모두 금지). 필요하면 Forecast 에서 사용자가 직접 입력한다.
import type { HistoricalData } from '../data/types';

/** 기간 수와 길이가 맞는 D&A 시리즈가 있으면 돌려주고, 없으면 null (missing). */
export function historicalDepreciation(h: HistoricalData): number[] | null {
  const d = h.cashFlow.depreciationAmortization;
  return d !== undefined && d.length === h.company.period.length ? d : null;
}

/** D&A 가 없을 때 표시할 문구. 출처에 맞춰 말한다. */
export function depreciationUnavailableNote(h: HistoricalData): string {
  return h.meta?.source === 'DART Annual Report'
    ? 'Data unavailable from current DART source. Forecast 에서 D&A 를 직접 입력하세요.'
    : 'Data unavailable from current source (학습용 fixture 에는 D&A 가 없습니다). Forecast 에서 D&A 를 직접 입력하세요.';
}
