// DCF / Equity 입력 폼의 순수 로직: 문자열 입력 ↔ DCF 입력 변환, UI 단계 검증·경고.
// UI 는 % 로 입력받고 Engine 은 소수로 받는다 (Terminal Growth 2% ↔ 0.02). 금액은 억원, 주식 수는 실제 주식 수(주).
// 입력 4개: Terminal Growth, 이자부부채, 현금, 발행주식수. 결과값(EV, Equity Value 등)은 입력이 아니다.
import type { ValuationInput } from '../valuation/index.ts';
import { amountText, decimalToPercentText, parseNumber, percentToDecimal } from './forecastForm.ts';
import type { AssumptionSource } from './waccForm.ts';

export const DCF_INPUT_FIELDS = ['terminalGrowth', 'interestBearingDebt', 'cash', 'sharesOutstanding'] as const;
export type DcfField = (typeof DCF_INPUT_FIELDS)[number];

export type DcfInputs = Pick<ValuationInput, DcfField>;

/** 폼 문자열. Terminal Growth 는 % 단위('2'), 부채·현금은 억원, 주식 수는 주. */
export type DcfFormValues = Record<DcfField, string>;
export type DcfParseResult = { ok: true; value: DcfInputs } | { ok: false; errors: Partial<Record<DcfField, string>> };

/** 입력값의 출처 라벨. 지금은 모두 사용자 가정(Assumption)이며 이후 Source / Date / Note 로 확장할 수 있다. */
export const DCF_FIELD_SOURCE: Record<DcfField, AssumptionSource> = {
  terminalGrowth: 'assumption', interestBearingDebt: 'assumption', cash: 'assumption', sharesOutstanding: 'assumption',
};

export const emptyDcfForm = (): DcfFormValues => ({ terminalGrowth: '', interestBearingDebt: '', cash: '', sharesOutstanding: '' });

/** 일부만 채워진 가정도 폼 문자열로 바꾼다. 없는 값은 '' 로 두며 기본값으로 채우지 않는다. */
export function dcfDraftToForm(a: Partial<DcfInputs> | null): DcfFormValues {
  const amt = (v: number | undefined) => (v === undefined ? '' : amountText(v));
  return {
    terminalGrowth: a?.terminalGrowth === undefined ? '' : decimalToPercentText(a.terminalGrowth),
    interestBearingDebt: amt(a?.interestBearingDebt),
    cash: amt(a?.cash),
    sharesOutstanding: amt(a?.sharesOutstanding),
  };
}

export function mergeDcfDrafts(base: DcfFormValues, drafts: Record<string, string>): DcfFormValues {
  const out = { ...base };
  for (const [k, v] of Object.entries(drafts)) if ((DCF_INPUT_FIELDS as readonly string[]).includes(k)) out[k as DcfField] = v;
  return out;
}

/** 가정이 DCF 입력과 같은지 (없는 값은 같지 않은 것으로 본다) */
export function sameDcfInputs(a: Partial<DcfInputs>, b: DcfInputs): boolean {
  const pick = (x: Partial<DcfInputs>) => JSON.stringify(DCF_INPUT_FIELDS.map((k) => x[k] ?? null));
  return pick(a) === pick(b);
}

// ---- UI 단계 검증 ----

export interface DcfParseContext {
  /** 현재 WACC (WACC 입력으로 미리 계산한 값). 있으면 Terminal Growth 와 비교한다. */
  wacc?: number | null;
}

const pctText = (d: number) => `${(d * 100).toFixed(4).replace(/\.?0+$/, '')}%`;

/**
 * 폼 값을 검증하고 변환한다.
 *  - Terminal Growth: 유한한 숫자, 그리고 WACC 를 알고 있다면 WACC 보다 낮아야 한다 (WACC ≤ g 는 Gordon Growth 불성립)
 *  - 이자부부채 ≥ 0, 현금 ≥ 0, 발행주식수 > 0
 *  - Net Debt(= 부채 − 현금)는 음수가 될 수 있다. 현금이 부채보다 많은 것은 오류가 아니다.
 */
export function parseDcfForm(values: DcfFormValues, ctx: DcfParseContext = {}): DcfParseResult {
  const errors: Partial<Record<DcfField, string>> = {};
  const out = {} as Partial<DcfInputs>;

  if (values.terminalGrowth.trim() === '') errors.terminalGrowth = '입력 필요';
  else {
    const g = percentToDecimal(values.terminalGrowth);
    if (Number.isNaN(g)) errors.terminalGrowth = '숫자를 입력하세요';
    else if (ctx.wacc !== undefined && ctx.wacc !== null && g >= ctx.wacc) errors.terminalGrowth = `WACC(${pctText(ctx.wacc)})보다 낮아야 합니다 (WACC ≤ g 이면 Terminal Value 를 계산할 수 없습니다)`;
    else out.terminalGrowth = g;
  }

  const amount = (field: 'interestBearingDebt' | 'cash' | 'sharesOutstanding', strictPositive: boolean) => {
    const text = values[field];
    if (text.trim() === '') { errors[field] = '입력 필요'; return; }
    const n = parseNumber(text);
    if (Number.isNaN(n)) errors[field] = '숫자를 입력하세요';
    else if (strictPositive ? n <= 0 : n < 0) errors[field] = strictPositive ? '0 보다 커야 합니다' : '0 이상이어야 합니다';
    else out[field] = n;
  };
  amount('interestBearingDebt', false);
  amount('cash', false);
  amount('sharesOutstanding', true);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: out as DcfInputs };
}

/** 오류는 아니지만 비현실적으로 보이는 입력 (입력은 막지 않는다) */
export function dcfWarnings(values: DcfFormValues): Partial<Record<DcfField, string>> {
  const w: Partial<Record<DcfField, string>> = {};
  const g = values.terminalGrowth.trim() === '' ? NaN : percentToDecimal(values.terminalGrowth);
  if (!Number.isNaN(g) && g > 0.05) w.terminalGrowth = '영구성장률이 5% 를 넘습니다. 장기 성장률로는 높은 편입니다';
  else if (!Number.isNaN(g) && g < 0) w.terminalGrowth = '음수 성장률입니다 (영구적인 역성장 가정)';
  const shares = parseNumber(values.sharesOutstanding);
  if (!Number.isNaN(shares) && shares > 0 && !Number.isInteger(shares)) w.sharesOutstanding = '주식 수가 정수가 아닙니다';
  return w;
}

/** WACC − g (소수). 둘 중 하나라도 없으면 null. 음수/0 이면 Terminal Value 를 계산할 수 없다. */
export function terminalSpread(wacc: number | null, terminalGrowth: number | null): number | null {
  return wacc === null || terminalGrowth === null ? null : wacc - terminalGrowth;
}
