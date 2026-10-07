// Forecast 입력 폼의 순수 로직: 문자열 입력 ↔ ValuationInput 변환, UI 단계 검증, Historical 참고값.
// UI 는 % 로 입력받고 Engine 은 소수로 받는다 (8.0% ↔ 0.08). 금액은 억원 기준이다.
// 이 파일은 historicalData 와 입력 문자열만 사용하며 Valuation 결과는 읽지 않는다.
import type { ValuationInput } from '../valuation/index.ts';
import type { HistoricalData } from '../data/types';
import { deriveHistoricalMetrics } from './historical.ts';
import { krwMillionToEok } from './units.ts';

/** 현재 ValuationInput 구조에 맞춘 기본 예측 기간. 입력 배열 구조는 5년으로 확장해도 그대로 쓸 수 있다. */
export const FORECAST_YEARS = 3;

export type ForecastInputs = Pick<
  ValuationInput,
  'currentRevenue' | 'revenueGrowth' | 'operatingMargin' | 'taxRate' | 'depreciation' | 'capex' | 'deltaNwc'
>;

export const FORECAST_ARRAY_FIELDS = ['revenueGrowth', 'operatingMargin', 'depreciation', 'capex', 'deltaNwc'] as const;
export type ForecastArrayField = (typeof FORECAST_ARRAY_FIELDS)[number];

/** 폼 입력값. 모두 문자열이며 비율은 % 단위 (예: '8'), 금액은 억원 단위. */
export interface ForecastFormValues {
  currentRevenue: string;
  taxRate: string;
  revenueGrowth: string[];
  operatingMargin: string[];
  depreciation: string[];
  capex: string[];
  deltaNwc: string[];
}

/** 'currentRevenue' | 'taxRate' | 'revenueGrowth.0' … */
export type FieldKey = string;
export const fieldKey = (field: ForecastArrayField, i: number): FieldKey => `${field}.${i}`;

export type ParseResult = { ok: true; value: ForecastInputs } | { ok: false; errors: Record<FieldKey, string> };

// ---- 숫자 ↔ 텍스트 ----

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** 입력 텍스트를 숫자로. 콤마·공백·끝의 % 는 무시한다. 비었거나 숫자가 아니면 NaN. */
export function parseNumber(text: string): number {
  const t = text.replace(/[,\s]/g, '').replace(/%$/, '');
  return NUMBER_RE.test(t) ? Number(t) : NaN;
}

/** UI % → Engine 소수. '8' → 0.08, '8.1375' → 0.081375. 부동소수 잡음은 12자리에서 정리한다. */
export function percentToDecimal(text: string): number {
  const n = parseNumber(text);
  return Number.isNaN(n) ? NaN : Number((n / 100).toFixed(12));
}

/** Engine 소수 → UI % 텍스트. 0.08 → '8' */
export function decimalToPercentText(d: number): string {
  return String(Number((d * 100).toFixed(6)));
}

export function amountText(n: number): string {
  return String(Number(n.toFixed(6)));
}

// ---- 폼 ↔ 입력 ----

export function emptyForecastForm(years: number = FORECAST_YEARS): ForecastFormValues {
  const blanks = () => Array.from({ length: years }, () => '');
  return { currentRevenue: '', taxRate: '', revenueGrowth: blanks(), operatingMargin: blanks(), depreciation: blanks(), capex: blanks(), deltaNwc: blanks() };
}

export function forecastInputsToForm(a: ForecastInputs): ForecastFormValues {
  return {
    currentRevenue: amountText(a.currentRevenue),
    taxRate: decimalToPercentText(a.taxRate),
    revenueGrowth: a.revenueGrowth.map(decimalToPercentText),
    operatingMargin: a.operatingMargin.map(decimalToPercentText),
    depreciation: a.depreciation.map(amountText),
    capex: a.capex.map(amountText),
    deltaNwc: a.deltaNwc.map(amountText),
  };
}

export function extractForecastInputs(a: ForecastInputs): ForecastInputs {
  return {
    currentRevenue: a.currentRevenue,
    revenueGrowth: [...a.revenueGrowth],
    operatingMargin: [...a.operatingMargin],
    taxRate: a.taxRate,
    depreciation: [...a.depreciation],
    capex: [...a.capex],
    deltaNwc: [...a.deltaNwc],
  };
}

export function sameForecastInputs(a: ForecastInputs, b: ForecastInputs): boolean {
  return JSON.stringify(extractForecastInputs(a)) === JSON.stringify(extractForecastInputs(b));
}

/** drafts(편집 중인 문자열)를 기준 폼 위에 덮어 현재 폼 값을 만든다. */
export function mergeDrafts(base: ForecastFormValues, drafts: Record<FieldKey, string>): ForecastFormValues {
  const out: ForecastFormValues = { ...base, revenueGrowth: [...base.revenueGrowth], operatingMargin: [...base.operatingMargin], depreciation: [...base.depreciation], capex: [...base.capex], deltaNwc: [...base.deltaNwc] };
  for (const [key, text] of Object.entries(drafts)) {
    if (key === 'currentRevenue' || key === 'taxRate') {
      out[key] = text;
    } else {
      const [field, idx] = key.split('.');
      const arr = out[field as ForecastArrayField];
      if (arr && Number(idx) < arr.length) arr[Number(idx)] = text;
    }
  }
  return out;
}

// ---- UI 단계 검증 ----
// Engine 호출 전에 잘못된 입력을 필드별로 알려 준다. (Engine 도 같은 입력을 다시 검증한다.)

export function parseForecastForm(values: ForecastFormValues, years: number = FORECAST_YEARS): ParseResult {
  const errors: Record<FieldKey, string> = {};

  // 단일 값
  const currentRevenue = parseNumber(values.currentRevenue);
  if (values.currentRevenue.trim() === '') errors.currentRevenue = '입력 필요';
  else if (Number.isNaN(currentRevenue)) errors.currentRevenue = '숫자를 입력하세요';
  else if (currentRevenue <= 0) errors.currentRevenue = '0 보다 커야 합니다';

  const taxRate = percentToDecimal(values.taxRate);
  if (values.taxRate.trim() === '') errors.taxRate = '입력 필요';
  else if (Number.isNaN(taxRate)) errors.taxRate = '숫자를 입력하세요';
  else if (taxRate < 0 || taxRate >= 1) errors.taxRate = '0% 이상 100% 미만이어야 합니다';

  // 연도별 배열
  const rules: Record<ForecastArrayField, { convert: (t: string) => number; check: (n: number) => string | null }> = {
    revenueGrowth: { convert: percentToDecimal, check: (n) => (n <= -1 ? '-100% 보다 커야 합니다' : null) },
    operatingMargin: { convert: percentToDecimal, check: (n) => (n < -1 || n > 1 ? '-100% ~ 100% 범위여야 합니다' : null) },
    depreciation: { convert: parseNumber, check: (n) => (n < 0 ? '0 이상이어야 합니다' : null) },
    capex: { convert: parseNumber, check: (n) => (n < 0 ? '0 이상이어야 합니다' : null) },
    deltaNwc: { convert: parseNumber, check: () => null }, // 운전자본 감소(음수)도 허용
  };
  const arrays = {} as Record<ForecastArrayField, number[]>;
  for (const field of FORECAST_ARRAY_FIELDS) {
    const texts = values[field];
    if (texts.length !== years) {
      errors[fieldKey(field, 0)] = `예측 기간(${years}년)과 입력 개수(${texts.length})가 다릅니다`;
      continue;
    }
    arrays[field] = texts.map((t, i) => {
      const n = rules[field].convert(t);
      if (t.trim() === '') errors[fieldKey(field, i)] = '입력 필요';
      else if (Number.isNaN(n)) errors[fieldKey(field, i)] = '숫자를 입력하세요';
      else {
        const msg = rules[field].check(n);
        if (msg) errors[fieldKey(field, i)] = msg;
      }
      return n;
    });
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      currentRevenue,
      revenueGrowth: arrays.revenueGrowth,
      operatingMargin: arrays.operatingMargin,
      taxRate,
      depreciation: arrays.depreciation,
      capex: arrays.capex,
      deltaNwc: arrays.deltaNwc,
    },
  };
}

// ---- Actual / Estimate 라벨 ----

/** 마지막 Actual 기간 다음 해부터 E 라벨. '2025A' → ['2026E','2027E','2028E']. Historical 이 없으면 Y1E, Y2E … */
export function forecastLabels(actualPeriods: string[] | null | undefined, years: number = FORECAST_YEARS): string[] {
  const last = actualPeriods && actualPeriods.length > 0 ? Number(actualPeriods[actualPeriods.length - 1].replace(/\D/g, '')) : NaN;
  return Array.from({ length: years }, (_, i) => (Number.isFinite(last) ? `${last + 1 + i}E` : `Y${i + 1}E`));
}

// ---- Historical 참고값 (reference-only. 입력값으로 자동 반영하지 않는다) ----

export interface ReferenceRow {
  key: ForecastArrayField;
  label: string;
  unit: '%' | '억원';
  helper: string;
  /** percent 행은 소수(0.162), 금액 행은 억원. 없으면 null */
  values: (number | null)[];
  note?: string;
}

export interface ForecastReference {
  /** Actual 라벨 (2023A …) */
  periods: string[];
  rows: ReferenceRow[];
  /** 'Historical Revenue Growth: +16.2% → +10.9%' 같은 참고 문구 */
  hints: string[];
  /** 최근 Actual 매출을 억원으로 환산한 값 */
  latestRevenueEok: number;
  latestRevenuePeriod: string;
}

const signed = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const plain = (x: number) => `${(x * 100).toFixed(1)}%`;

export function buildForecastReference(h: HistoricalData | null): ForecastReference | null {
  if (!h) return null;
  const m = deriveHistoricalMetrics(h);
  const eok = (arr: (number | null)[]) => arr.map((v) => (v === null ? null : krwMillionToEok(v)));
  const periods = h.company.period;
  const last = periods.length - 1;

  const growth = m.revenueGrowth.filter((v): v is number => v !== null);
  const margin = m.operatingMargin.filter((v): v is number => v !== null);
  const hints: string[] = [];
  if (growth.length > 0) hints.push(`Historical Revenue Growth: ${growth.map(signed).join(' → ')}`);
  if (margin.length > 0) hints.push(`Historical Operating Margin: ${margin.map(plain).join(' → ')}`);

  return {
    periods,
    rows: [
      { key: 'revenueGrowth', label: 'Revenue Growth', unit: '%', helper: '매출 성장률 가정', values: m.revenueGrowth },
      { key: 'operatingMargin', label: 'Operating Margin', unit: '%', helper: '매출 대비 영업이익 비율', values: m.operatingMargin },
      { key: 'depreciation', label: 'D&A', unit: '억원', helper: '감가상각비', values: periods.map(() => null), note: 'Historical D&A 데이터가 없어 참고값을 제공하지 않습니다.' },
      { key: 'capex', label: 'CAPEX', unit: '억원', helper: '설비 등 장기자산 투자 (과거 참고값은 유형자산 취득액 기준)', values: eok(m.capex) },
      { key: 'deltaNwc', label: 'ΔNWC', unit: '억원', helper: '운전자본 증가분 (감소는 음수)', values: eok(m.deltaNwc) },
    ],
    hints,
    latestRevenueEok: krwMillionToEok(h.incomeStatement.revenue[last]),
    latestRevenuePeriod: periods[last],
  };
}

/** 입력한 Current Revenue 가 최근 Actual 매출 환산값과 같은지 ("Based on latest actual revenue" 표시용) */
export function isBasedOnLatestActual(currentRevenue: number, ref: ForecastReference | null): boolean {
  return ref !== null && Math.abs(currentRevenue - ref.latestRevenueEok) < 0.005;
}
