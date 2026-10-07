// Forecast: 매출 → EBIT → NOPAT → FCFF.
import type { ValuationInput } from './models.ts';
import { ValuationError } from './models.ts';
import { assertSeries, assertTaxRate, isFiniteNumber } from './validate.ts';

/** Y1 = Y0 × (1 + g1), Y2 = Y1 × (1 + g2), … 성장률 -100% 이하(매출 0 이하)는 허용하지 않는다. */
export function forecastRevenue(currentRevenue: number, growth: number[]): number[] {
  if (!isFiniteNumber(currentRevenue) || currentRevenue < 0) throw new ValuationError('currentRevenue: 0 이상의 숫자여야 합니다.');
  assertSeries('revenueGrowth', growth);
  const out: number[] = [];
  let prev = currentRevenue;
  growth.forEach((g, i) => {
    if (g <= -1) throw new ValuationError(`revenueGrowth: Y${i + 1} 성장률은 -100% 보다 커야 합니다.`);
    prev *= 1 + g;
    out.push(prev);
  });
  return out;
}

/** EBIT = Revenue × Operating Margin. 두 배열의 길이는 같아야 한다. */
export function calculateEbit(revenue: number[], operatingMargin: number[]): number[] {
  assertSeries('revenue', revenue);
  assertSeries('operatingMargin', operatingMargin);
  if (revenue.length !== operatingMargin.length) {
    throw new ValuationError(`operatingMargin: 예측 기간(${revenue.length}년)과 길이가 다릅니다(${operatingMargin.length}).`);
  }
  return revenue.map((r, i) => r * operatingMargin[i]);
}

/** NOPAT = EBIT × (1 − 세율). 세율은 0 이상 1 미만. */
export function calculateNopat(ebit: number[], taxRate: number): number[] {
  assertSeries('ebit', ebit);
  assertTaxRate(taxRate);
  return ebit.map((e) => e * (1 - taxRate));
}

/** FCFF = NOPAT + D&A − CAPEX − ΔNWC (D&A, CAPEX, ΔNWC 는 양수 입력, 부호는 여기서 적용). 모든 배열의 길이는 같아야 한다. */
export function calculateFcff(nopat: number[], depreciation: number[], capex: number[], deltaNwc: number[]): number[] {
  assertSeries('nopat', nopat);
  const others: [string, number[]][] = [['depreciation', depreciation], ['capex', capex], ['deltaNwc', deltaNwc]];
  for (const [name, values] of others) {
    assertSeries(name, values);
    if (values.length !== nopat.length) throw new ValuationError(`${name}: 예측 기간(${nopat.length}년)과 길이가 다릅니다(${values.length}).`);
  }
  return nopat.map((n, i) => n + depreciation[i] - capex[i] - deltaNwc[i]);
}

export interface ForecastResult {
  revenue: number[];
  ebit: number[];
  nopat: number[];
  fcff: number[];
}

/** ValuationInput 의 Forecast 구간을 한 번에 계산한다. runValuation 과 Sensitivity 가 공유한다. */
export function runForecast(input: ValuationInput): ForecastResult {
  const revenue = forecastRevenue(input.currentRevenue, input.revenueGrowth);
  const ebit = calculateEbit(revenue, input.operatingMargin);
  const nopat = calculateNopat(ebit, input.taxRate);
  const fcff = calculateFcff(nopat, input.depreciation, input.capex, input.deltaNwc);
  return { revenue, ebit, nopat, fcff };
}
