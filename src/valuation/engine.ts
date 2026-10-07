// Valuation Engine v1 진입점. 결정적(deterministic) 계산만 수행하며 UI / LLM 과 무관하다.
//
//   ValuationInput → 입력 검증 → Forecast → WACC → DCF → Equity → ValuationResult
//
// 반올림은 하지 않는다. 표시용 반올림은 UI 의 포맷 함수에서만 한다.
import { runForecast } from './forecast.ts';
import { calculateWacc } from './wacc.ts';
import { calculateEquityValue, calculateNetDebt, calculatePerShareValue, runDcf } from './dcf.ts';
import type { ValuationInput, ValuationResult } from './models.ts';
import { ValuationError } from './models.ts';
import { assertFinite, assertSeries, isFiniteNumber } from './validate.ts';

const SCALARS: (keyof ValuationInput)[] = [
  'currentRevenue', 'taxRate', 'riskFreeRate', 'beta', 'marketRiskPremium', 'preTaxCostOfDebt',
  'equityMarketValue', 'debtMarketValue', 'terminalGrowth', 'interestBearingDebt', 'cash', 'sharesOutstanding',
];
const SERIES: (keyof ValuationInput)[] = ['revenueGrowth', 'operatingMargin', 'depreciation', 'capex', 'deltaNwc'];

/** 계산 전에 입력 전체를 점검한다. 세부 범위(세율, 성장률, WACC > g 등)는 각 계산 함수가 다시 검증한다. */
export function validateInput(input: ValuationInput): void {
  for (const k of SCALARS) assertFinite(k, input[k]);
  assertSeries('revenueGrowth', input.revenueGrowth);
  const years = input.revenueGrowth.length;
  for (const k of SERIES) {
    assertSeries(k, input[k]);
    if ((input[k] as number[]).length !== years) {
      throw new ValuationError(`${k}: 예측 기간(${years}년)과 길이가 다릅니다(${(input[k] as number[]).length}).`);
    }
  }
  if (input.sharesOutstanding <= 0) throw new ValuationError('sharesOutstanding: 0 보다 커야 합니다.');
  if (input.equityMarketValue + input.debtMarketValue <= 0) throw new ValuationError('equityMarketValue + debtMarketValue: 0 보다 커야 합니다.');
}

/** 결과에 NaN / Infinity 가 섞이지 않았는지 마지막으로 확인한다. */
function assertFiniteResult(result: ValuationResult): void {
  for (const [key, value] of Object.entries(result)) {
    const nums = Array.isArray(value) ? value : [value];
    if (nums.some((n) => !isFiniteNumber(n))) throw new ValuationError(`계산 결과(${key})가 유한한 숫자가 아닙니다. 입력을 확인하세요.`);
  }
}

export function runValuation(input: ValuationInput): ValuationResult {
  validateInput(input);

  // Forecast
  const { revenue, ebit, nopat, fcff } = runForecast(input);

  // WACC
  const w = calculateWacc(input);

  // DCF
  const dcf = runDcf(fcff, w.wacc, input.terminalGrowth);

  // Equity
  const netDebt = calculateNetDebt(input.interestBearingDebt, input.cash);
  const equityValue = calculateEquityValue(dcf.enterpriseValue, netDebt);
  const perShareValue = calculatePerShareValue(equityValue, input.sharesOutstanding);

  const result: ValuationResult = {
    revenue, ebit, nopat, fcff,
    costOfEquity: w.costOfEquity, afterTaxCostOfDebt: w.afterTaxCostOfDebt,
    equityWeight: w.equityWeight, debtWeight: w.debtWeight, wacc: w.wacc,
    discountFactors: dcf.discountFactors, pvFcff: dcf.pvFcff,
    terminalFcff: dcf.terminalFcff, terminalValue: dcf.terminalValue, pvTerminalValue: dcf.pvTerminalValue,
    enterpriseValue: dcf.enterpriseValue,
    netDebt, equityValue, perShareValue,
  };
  assertFiniteResult(result);
  return result;
}
