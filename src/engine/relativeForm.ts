// 상대가치(Relative Valuation) 입력 폼의 순수 로직. 멀티플은 사용자가 직접 입력한다 (Peer 자동 수집 없음).
// 입력 6개: Net Income·PER, Book Equity·PBR, EBITDA·EV/EBITDA. 금액은 억원, 멀티플은 배수.
// 세 방법은 독립적이다: 비어 있는 방법은 계산하지 않을 뿐 오류가 아니다. 값이 들어 있는데 잘못된 경우만 오류다.
import type { RelativeInput } from '../valuation/index.ts';
import type { HistoricalData } from '../data/types';
import { amountText, parseNumber } from './forecastForm.ts';
import { krwMillionToEok } from './units.ts';
import type { AssumptionSource } from './waccForm.ts';

export const RELATIVE_FIELDS = ['netIncome', 'per', 'bookEquity', 'pbr', 'ebitda', 'evEbitda'] as const;
export type RelativeField = (typeof RELATIVE_FIELDS)[number];

export type RelativeFormValues = Record<RelativeField, string>;
export type RelativeParseResult = { ok: true; value: RelativeInput } | { ok: false; errors: Partial<Record<RelativeField, string>> };

/** 입력값의 출처. 지금은 모두 사용자 가정이며, 이후 Peer Company / Source / Date 로 확장할 수 있다. */
export const RELATIVE_FIELD_SOURCE: Record<RelativeField, AssumptionSource> = {
  netIncome: 'assumption', per: 'assumption', bookEquity: 'assumption', pbr: 'assumption', ebitda: 'assumption', evEbitda: 'assumption',
};

export interface RelativeGroup {
  method: 'PER' | 'PBR' | 'EV/EBITDA';
  metric: RelativeField;
  metricLabel: string;
  metricHelper: string;
  multiple: RelativeField;
  multipleLabel: string;
  /** 결과 공식 설명 */
  formula: string;
}

export const RELATIVE_GROUPS: RelativeGroup[] = [
  { method: 'PER', metric: 'netIncome', metricLabel: 'Net Income', metricHelper: '당기순이익 (억원)', multiple: 'per', multipleLabel: 'PER', formula: 'Equity Value = Net Income × PER' },
  { method: 'PBR', metric: 'bookEquity', metricLabel: 'Book Equity', metricHelper: '자기자본 장부가 (억원)', multiple: 'pbr', multipleLabel: 'PBR', formula: 'Equity Value = Book Equity × PBR' },
  { method: 'EV/EBITDA', metric: 'ebitda', metricLabel: 'EBITDA', metricHelper: '영업이익 + 감가상각비 (억원)', multiple: 'evEbitda', multipleLabel: 'EV / EBITDA', formula: 'Enterprise Value = EBITDA × Multiple,  Equity Value = EV − Net Debt' },
];

export const emptyRelativeForm = (): RelativeFormValues => ({ netIncome: '', per: '', bookEquity: '', pbr: '', ebitda: '', evEbitda: '' });

/** 저장된 입력 → 폼 문자열. 없는 값은 '' 로 둔다. */
export function relativeDraftToForm(r: RelativeInput | null): RelativeFormValues {
  const out = emptyRelativeForm();
  if (r) for (const f of RELATIVE_FIELDS) if (r[f] !== undefined) out[f] = amountText(r[f] as number);
  return out;
}

export function mergeRelativeDrafts(base: RelativeFormValues, drafts: Record<string, string>): RelativeFormValues {
  const out = { ...base };
  for (const [k, v] of Object.entries(drafts)) if ((RELATIVE_FIELDS as readonly string[]).includes(k)) out[k as RelativeField] = v;
  return out;
}

export function sameRelativeInputs(a: RelativeInput, b: RelativeInput): boolean {
  const pick = (x: RelativeInput) => JSON.stringify(RELATIVE_FIELDS.map((k) => x[k] ?? null));
  return pick(a) === pick(b);
}

const METRIC_FIELDS: RelativeField[] = ['netIncome', 'bookEquity', 'ebitda'];

/**
 * 값이 들어 있는 칸만 검증한다 (빈 칸은 건너뜀). 지표(순이익·장부가·EBITDA)와 멀티플은 모두 0 보다 커야 한다.
 * 반환 값에는 입력한 필드만 들어간다.
 */
export function parseRelativeForm(values: RelativeFormValues): RelativeParseResult {
  const errors: Partial<Record<RelativeField, string>> = {};
  const value: RelativeInput = {};
  for (const f of RELATIVE_FIELDS) {
    const text = values[f];
    if (text.trim() === '') continue;
    const n = parseNumber(text);
    if (Number.isNaN(n)) errors[f] = '숫자를 입력하세요';
    else if (n <= 0) errors[f] = METRIC_FIELDS.includes(f) ? '0 보다 커야 합니다 (0 이하이면 이 방법은 의미가 없습니다)' : '0 보다 커야 합니다';
    else value[f] = n;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

// ---- 최근 Actual 참고값 (사용자가 버튼을 눌렀을 때만 입력된다) ----

export interface RelativeReference {
  period: string;
  /** 억원 (KRW million ÷ 100) */
  netIncomeEok: number;
  bookEquityEok: number;
}

export function buildRelativeReference(h: HistoricalData | null): RelativeReference | null {
  if (!h) return null;
  const last = h.company.period.length - 1;
  return {
    period: h.company.period[last],
    netIncomeEok: krwMillionToEok(h.incomeStatement.netIncome[last]),
    bookEquityEok: krwMillionToEok(h.balanceSheet.totalEquity[last]),
  };
}
