// 금액 · 비율의 표시용 deterministic 값 (단일 출처).
// 원칙: LLM 은 금액 단위 환산을 직접 하지 않는다. Tool · Evidence 는 원본(full precision) 값과 함께 표시용 값(억원 · 조원 · 퍼센트)을 제공하고,
// 모델은 제공된 표시용 값을 그대로 인용한다. Grounding 검증도 같은 환산 규칙(이 파일)을 쓴다 — UI · Prompt · 검증에 환산 로직을 따로 두지 않는다.
// 엔진의 원본 값은 반올림하지 않는다. 표시용 값도 숫자는 반올림하지 않고(formatFinancialValue 의 문자열만 자릿수를 정한다).

export type DisplayUnit = 'krw-million' | 'eok' | 'jo' | 'krw' | 'won' | 'ratio' | 'percent' | 'shares' | 'multiple' | 'unknown';

/** Tool 이 쓰는 단위 문자열("KRW million (비율 제외)", "억원", "ratio (소수)" …)을 정규화한다. */
export function normalizeDisplayUnit(unit?: string | null): DisplayUnit {
  const u = (unit ?? '').trim().toLowerCase();
  if (u === '') return 'unknown';
  if (u.startsWith('krw million') || u === 'million krw') return 'krw-million';
  if (u === '억원' || u === 'eok') return 'eok';
  if (u === '조원' || u === 'trillion' || u === 'trillion krw') return 'jo';
  if (u === 'krw') return 'krw';
  if (u === '원' || u === 'won') return 'won';
  if (u.startsWith('ratio') || u.startsWith('decimal') || u === '소수') return 'ratio';
  if (u.startsWith('percent') || u === '%') return 'percent';
  if (u === '주' || u === 'shares') return 'shares';
  if (u === '배' || u === 'x' || u === 'multiple') return 'multiple';
  return 'unknown';
}

/** 금액 단위의 원화(KRW) 환산 배율. 금액 단위가 아니면 null. */
export const KRW_PER_UNIT: Readonly<Partial<Record<DisplayUnit, number>>> = { 'krw-million': 1e6, eok: 1e8, jo: 1e12, krw: 1, won: 1 };
export const isAmountUnit = (u: DisplayUnit): boolean => KRW_PER_UNIT[u] !== undefined;

export const toKrw = (value: number, unit: DisplayUnit): number | null => (KRW_PER_UNIT[unit] === undefined ? null : value * KRW_PER_UNIT[unit]!);
export const krwMillionToEok = (v: number) => v / 100;
export const krwMillionToTrillion = (v: number) => v / 1e6;
export const eokToTrillion = (v: number) => v / 1e4;
export const ratioToPercent = (v: number) => v * 100;

export interface FinancialDisplay {
  /** 원본 단위가 KRW million 일 때의 원본 값 (그 외에는 없다) */
  valueMillionKrw?: number;
  valueEok: number;
  valueTrillion: number;
}

/** 금액 값 → 표시용 값. 금액 단위가 아니면 null. 반올림하지 않는다. */
export function financialDisplayValue(value: number, unit?: string | null): FinancialDisplay | null {
  const du = normalizeDisplayUnit(unit);
  const krw = toKrw(value, du);
  if (krw === null || !Number.isFinite(krw)) return null;
  return { ...(du === 'krw-million' ? { valueMillionKrw: value } : {}), valueEok: krw / 1e8, valueTrillion: krw / 1e12 };
}

const nf = (x: number, d: number) => x.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });

/** 사람이 읽는 문자열. as: 억원 · 조원 · auto(1조원 이상이면 조원). 문자열만 자릿수를 정한다. */
export function formatFinancialValue(value: number, unit?: string | null, as: 'eok' | 'jo' | 'auto' = 'auto'): string | null {
  const d = financialDisplayValue(value, unit);
  if (!d) return null;
  const jo = as === 'jo' || (as === 'auto' && Math.abs(d.valueTrillion) >= 1);
  return jo ? `${nf(d.valueTrillion, 2)}조원` : `${nf(d.valueEok, Math.abs(d.valueEok) < 1000 ? 2 : 0)}억원`;
}

export const formatPercent = (ratio: number, digits = 2): string => `${nf(ratio * 100, digits)}%`;

/** 금액 시계열(KRW million 등) → 억원 · 조원 시계열. null 은 그대로 둔다. */
export function displaySeries(values: (number | null)[], unit?: string | null): { valuesEok: (number | null)[]; valuesTrillion: (number | null)[] } | null {
  if (!isAmountUnit(normalizeDisplayUnit(unit))) return null;
  const map = (f: (d: FinancialDisplay) => number) => values.map((v) => (v === null ? null : f(financialDisplayValue(v, unit)!)));
  return { valuesEok: map((d) => d.valueEok), valuesTrillion: map((d) => d.valueTrillion) };
}

/** 표시용 문자열 시계열 ("377,930억원", "37.79조원", "13.07%"): 모델은 숫자를 환산하지 않고 이 문자열을 그대로 옮긴다. */
export const textSeries = (values: (number | null)[], unit: string | null | undefined, as: 'eok' | 'jo'): (string | null)[] => values.map((v) => (v === null ? null : formatFinancialValue(v, unit, as)));
export const percentTextSeries = (values: (number | null)[]): (string | null)[] => values.map((v) => (v === null ? null : formatPercent(v)));

export const percentSeries = (values: (number | null)[]): (number | null)[] => values.map((v) => (v === null ? null : ratioToPercent(v)));
