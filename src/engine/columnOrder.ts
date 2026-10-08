/** 재무제표 표의 열 순서: 가장 최근 연도가 왼쪽 (DART 재무제표와 같다). 데이터 배열은 그대로 두고 표시 순서만 정한다 — 반환값은 원래 배열의 인덱스. */
export function newestFirstOrder(periods: readonly string[]): number[] {
  const year = (p: string) => Number.parseInt(p, 10);
  return periods.map((_, i) => i).sort((a, b) => (year(periods[b]!) || 0) - (year(periods[a]!) || 0) || b - a);
}
