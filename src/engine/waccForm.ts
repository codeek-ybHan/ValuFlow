// WACC 입력 폼의 순수 로직: 문자열 입력 ↔ WACC 입력 변환, UI 단계 검증·경고, Live Preview.
// UI 는 % 로 입력받고 Engine 은 소수로 받는다 (Rf 3% ↔ 0.03). 금액은 억원 기준이다.
//
// 계산식은 여기서 다시 구현하지 않는다. Live Preview 는 valuation 공개 API 의 WACC 함수
// (calculateCostOfEquity / calculateAfterTaxCostOfDebt / calculateCapitalWeights / calculateWacc)를 호출하며,
// valuation 의 내부 파일을 직접 import 하지 않는다. Preview 는 valuationResult 를 만들지 않는다.
import {
  calculateAfterTaxCostOfDebt, calculateCapitalWeights, calculateCostOfEquity, calculateWacc, ValuationError,
} from '../valuation/index.ts';
import type { ValuationInput } from '../valuation/index.ts';
import { amountText, decimalToPercentText, parseNumber, percentToDecimal } from './forecastForm.ts';

export const WACC_INPUT_FIELDS = ['riskFreeRate', 'beta', 'marketRiskPremium', 'preTaxCostOfDebt', 'equityMarketValue', 'debtMarketValue'] as const;
export type WaccField = (typeof WACC_INPUT_FIELDS)[number];

/** 사용자가 입력하는 값. Tax Rate 는 Forecast 입력(valuationAssumptions.taxRate)을 재사용하므로 여기에 없다. */
export type WaccInputs = Pick<ValuationInput, WaccField>;

/** 폼 문자열. 비율은 % 단위('3'), Beta 는 배수('1.1'), 시가총액·부채는 억원. */
export type WaccFormValues = Record<WaccField, string>;

/** 폼 오류 키: WACC 필드 이름 또는 'capitalStructure' (E + D 합) */
export type WaccErrorKey = WaccField | 'capitalStructure';
export type WaccParseResult = { ok: true; value: WaccInputs } | { ok: false; errors: Partial<Record<WaccErrorKey, string>> };

// ---- Source / Assumption 라벨 (이후 Market data, Comparable 등으로 확장) ----

export type AssumptionSource = 'assumption' | 'market-data' | 'comparable' | 'analyst' | 'manual';
export const SOURCE_LABELS: Record<AssumptionSource, string> = {
  assumption: 'Assumption',
  'market-data': 'Market data',
  comparable: 'Comparable companies',
  analyst: 'Analyst assumption',
  manual: 'Manual input',
};
/** 지금은 모든 WACC 입력이 사용자 가정(Assumption)이다. 데이터 연동 단계에서 필드별로 바꾼다. */
export const WACC_FIELD_SOURCE: Record<WaccField, AssumptionSource> = {
  riskFreeRate: 'assumption', beta: 'assumption', marketRiskPremium: 'assumption',
  preTaxCostOfDebt: 'assumption', equityMarketValue: 'assumption', debtMarketValue: 'assumption',
};

// ---- 폼 ↔ 입력 ----

export const emptyWaccForm = (): WaccFormValues => ({ riskFreeRate: '', beta: '', marketRiskPremium: '', preTaxCostOfDebt: '', equityMarketValue: '', debtMarketValue: '' });

/** 일부만 채워진 가정도 폼 문자열로 바꾼다. 없는 값은 '' 로 두며 기본값으로 채우지 않는다. */
export function waccDraftToForm(a: Partial<WaccInputs> | null): WaccFormValues {
  const pct = (v: number | undefined) => (v === undefined ? '' : decimalToPercentText(v));
  const amt = (v: number | undefined) => (v === undefined ? '' : amountText(v));
  return {
    riskFreeRate: pct(a?.riskFreeRate),
    beta: amt(a?.beta),
    marketRiskPremium: pct(a?.marketRiskPremium),
    preTaxCostOfDebt: pct(a?.preTaxCostOfDebt),
    equityMarketValue: amt(a?.equityMarketValue),
    debtMarketValue: amt(a?.debtMarketValue),
  };
}

export function mergeWaccDrafts(base: WaccFormValues, drafts: Record<string, string>): WaccFormValues {
  const out = { ...base };
  for (const [k, v] of Object.entries(drafts)) if ((WACC_INPUT_FIELDS as readonly string[]).includes(k)) out[k as WaccField] = v;
  return out;
}

/** 가정이 WACC 입력과 같은지 (없는 값은 같지 않은 것으로 본다) */
export function sameWaccInputs(a: Partial<WaccInputs>, b: WaccInputs): boolean {
  const pick = (x: Partial<WaccInputs>) => JSON.stringify(WACC_INPUT_FIELDS.map((k) => x[k] ?? null));
  return pick(a) === pick(b);
}

// ---- UI 단계 검증 ----

const FIELD_RULES: Record<WaccField, { percent: boolean; check: (n: number) => string | null }> = {
  riskFreeRate: { percent: true, check: (n) => (n < -0.05 || n >= 1 ? '-5% 이상 100% 미만이어야 합니다' : null) },
  beta: { percent: false, check: (n) => (n < 0 ? '0 이상이어야 합니다' : null) },
  marketRiskPremium: { percent: true, check: (n) => (n < 0 ? '0% 이상이어야 합니다' : n >= 1 ? '100% 미만이어야 합니다' : null) },
  preTaxCostOfDebt: { percent: true, check: (n) => (n < 0 ? '0% 이상이어야 합니다' : n >= 1 ? '100% 미만이어야 합니다' : null) },
  equityMarketValue: { percent: false, check: (n) => (n < 0 ? '0 이상이어야 합니다' : null) },
  debtMarketValue: { percent: false, check: (n) => (n < 0 ? '0 이상이어야 합니다' : null) },
};

type FieldCheck = { value: number } | { error: string };
function checkField(field: WaccField, text: string): FieldCheck {
  if (text.trim() === '') return { error: '입력 필요' };
  const rule = FIELD_RULES[field];
  const n = rule.percent ? percentToDecimal(text) : parseNumber(text);
  if (Number.isNaN(n)) return { error: '숫자를 입력하세요' };
  const msg = rule.check(n);
  return msg ? { error: msg } : { value: n };
}

export function parseWaccForm(values: WaccFormValues): WaccParseResult {
  const errors: Partial<Record<WaccErrorKey, string>> = {};
  const parsed = {} as Partial<WaccInputs>;
  for (const f of WACC_INPUT_FIELDS) {
    const c = checkField(f, values[f]);
    if ('error' in c) errors[f] = c.error;
    else parsed[f] = c.value;
  }
  if (parsed.equityMarketValue !== undefined && parsed.debtMarketValue !== undefined && parsed.equityMarketValue + parsed.debtMarketValue <= 0) {
    errors.capitalStructure = 'Equity + Debt 는 0 보다 커야 합니다';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: parsed as WaccInputs };
}

/** 오류는 아니지만 비현실적으로 보이는 입력 (입력은 막지 않는다) */
export function waccWarnings(values: WaccFormValues): Partial<Record<WaccField, string>> {
  const w: Partial<Record<WaccField, string>> = {};
  const val = (f: WaccField) => {
    const c = checkField(f, values[f]);
    return 'value' in c ? c.value : null;
  };
  const rf = val('riskFreeRate');
  if (rf !== null && rf > 0.15) w.riskFreeRate = '무위험이자율이 15% 를 넘습니다. 단위(%)를 확인하세요';
  else if (rf !== null && rf < 0) w.riskFreeRate = '음수 금리입니다';
  const beta = val('beta');
  if (beta !== null && beta > 3) w.beta = 'Beta 가 3 을 넘습니다. 입력을 확인하세요';
  const mrp = val('marketRiskPremium');
  if (mrp !== null && mrp > 0.2) w.marketRiskPremium = 'MRP 가 20% 를 넘습니다. 단위(%)를 확인하세요';
  const kd = val('preTaxCostOfDebt');
  if (kd !== null && kd > 0.3) w.preTaxCostOfDebt = '조달금리가 30% 를 넘습니다. 단위(%)를 확인하세요';
  return w;
}

// ---- Live Preview (valuationResult 를 만들지 않는다) ----

export interface WaccPreview {
  costOfEquity: number | null;
  afterTaxCostOfDebt: number | null;
  equityWeight: number | null;
  debtWeight: number | null;
  wacc: number | null;
}

const validTaxRate = (t: number | undefined): t is number => typeof t === 'number' && Number.isFinite(t) && t >= 0 && t < 1;

/**
 * 폼 값으로 WACC 구성요소를 미리 계산한다. 각 구성요소는 자기 입력이 유효할 때만 계산되고(아니면 null),
 * WACC 는 네 구성요소가 모두 계산될 때만 나온다. 세율은 Forecast 가정(valuationAssumptions.taxRate)을 받아 쓴다.
 */
export function computeWaccPreview(values: WaccFormValues, taxRate: number | undefined): WaccPreview {
  const v = (f: WaccField) => {
    const c = checkField(f, values[f]);
    return 'value' in c ? c.value : null;
  };
  const rf = v('riskFreeRate'), beta = v('beta'), mrp = v('marketRiskPremium');
  const kd = v('preTaxCostOfDebt'), e = v('equityMarketValue'), d = v('debtMarketValue');
  const preview: WaccPreview = { costOfEquity: null, afterTaxCostOfDebt: null, equityWeight: null, debtWeight: null, wacc: null };
  try {
    if (rf !== null && beta !== null && mrp !== null) preview.costOfEquity = calculateCostOfEquity(rf, beta, mrp);
    if (kd !== null && validTaxRate(taxRate)) preview.afterTaxCostOfDebt = calculateAfterTaxCostOfDebt(kd, taxRate);
    if (e !== null && d !== null && e + d > 0) {
      const w = calculateCapitalWeights(e, d);
      preview.equityWeight = w.equityWeight;
      preview.debtWeight = w.debtWeight;
    }
    if (rf !== null && beta !== null && mrp !== null && kd !== null && e !== null && d !== null && validTaxRate(taxRate) && e + d > 0) {
      preview.wacc = calculateWacc({ riskFreeRate: rf, beta, marketRiskPremium: mrp, preTaxCostOfDebt: kd, taxRate, equityMarketValue: e, debtMarketValue: d }).wacc;
    }
  } catch (err) {
    if (!(err instanceof ValuationError)) throw err; // 검증은 위에서 끝났으므로 여기 오는 것은 예상 밖의 오류다
  }
  return preview;
}

/** WACC 에 대한 자기자본 / 타인자본의 기여도(가중치 × 비용). 두 값의 합이 WACC 이다. */
export function waccContributions(p: WaccPreview): { equity: number; debt: number } | null {
  if (p.wacc === null || p.costOfEquity === null || p.afterTaxCostOfDebt === null || p.equityWeight === null || p.debtWeight === null) return null;
  return { equity: p.equityWeight * p.costOfEquity, debt: p.debtWeight * p.afterTaxCostOfDebt };
}
