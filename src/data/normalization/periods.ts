// 기간 표기 정규화: "당기 / 전기 / 전전기", "FY2023", "2023.12" → 회계연도(2023) → "2023A".

const RELATIVE_OFFSET: Record<string, number> = { 당기: 0, 전기: 1, 전전기: 2 };

/** 회계연도 → Actual 라벨 (2023 → "2023A"). */
export function fiscalYearLabel(year: number): string {
  if (!Number.isInteger(year)) throw new TypeError('fiscalYearLabel: 정수 연도가 필요합니다.');
  return `${year}A`;
}

/** "2023A" / "FY2023" / "2023" / "2023.12.31" / "2023년" → 2023. 해석할 수 없으면 null. */
export function parseFiscalYear(label: string): number | null {
  const m = /^\s*(?:FY)?\s*((?:19|20)\d{2})\s*(?:A|E|년|[.\-/]\d{1,2}(?:[.\-/]\d{1,2})?)?\s*$/i.exec(label);
  return m ? Number(m[1]) : null;
}

/** 상대 표기를 회계연도로: ("당기", 2025) → 2025, ("전기", 2025) → 2024, ("전전기", 2025) → 2023. */
export function resolveRelativePeriod(label: string, reportYear: number): number | null {
  const offset = RELATIVE_OFFSET[label.replace(/\s+/g, '')];
  return offset === undefined ? null : reportYear - offset;
}

/** 회계연도 목록 → 오름차순·중복 없는 라벨 목록. */
export function buildPeriods(years: readonly number[]): { years: number[]; labels: string[] } {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  return { years: sorted, labels: sorted.map(fiscalYearLabel) };
}
