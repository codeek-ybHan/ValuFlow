// Forecast · WACC · DCF section: 가정(Estimate)과 엔진 결과(Calculated)를 그대로 옮긴다. DCF · WACC 를 다시 계산하지 않는다.
import { forecastLabels } from '../../engine/forecastForm.ts';
import type { ValuationInput, ValuationResult } from '../../valuation/index.ts';
import type { ReportInput } from '../input.ts';
import type { DcfSection, EquityBridge, ForecastSection, TableRow, WaccSection } from '../model.ts';
import { SRC_ASSUMPTIONS, SRC_ENGINE } from '../sources.ts';
import type { Cell, DataKind, Narrative, PeriodLabel, ReportUnit, SectionState } from '../types.ts';
import { cell } from '../units.ts';

const series = (key: string, label: string, unit: ReportUnit, kind: DataKind, src: string, values: number[], note: string | null = null): TableRow => ({ key, label, unit, note, cells: values.map((v) => cell(v, unit, kind, src)) });
const estimatePeriods = (input: ReportInput, n: number): PeriodLabel[] => forecastLabels(input.historical?.company.period, n).map((label) => ({ label, kind: 'estimate' as const }));

export function buildForecast(input: ReportInput, a: ValuationInput, r: ValuationResult, narrative: SectionState<Narrative>): ForecastSection {
  const n = r.fcff.length;
  const A = SRC_ASSUMPTIONS;
  return {
    periods: estimatePeriods(input, n),
    assumptions: [
      series('revenueGrowth', 'Revenue Growth', 'ratio', 'estimate', A, a.revenueGrowth),
      series('operatingMargin', 'Operating Margin', 'ratio', 'estimate', A, a.operatingMargin),
      series('depreciation', 'D&A', 'eok', 'estimate', A, a.depreciation, '사용자 가정 (Historical D&A 가 아니다)'),
      series('capex', 'CAPEX', 'eok', 'estimate', A, a.capex),
      series('deltaNwc', 'ΔNWC', 'eok', 'estimate', A, a.deltaNwc),
    ],
    projections: [
      series('revenue', 'Revenue (projected)', 'eok', 'estimate', SRC_ENGINE, r.revenue, '가정에서 엔진이 투영한 값 (Actual 이 아니다)'),
      series('ebit', 'EBIT (projected)', 'eok', 'estimate', SRC_ENGINE, r.ebit),
    ],
    scalars: [
      { key: 'currentRevenue', label: 'Base-year Revenue (입력)', cell: cell(a.currentRevenue, 'eok', 'estimate', A) },
      { key: 'taxRate', label: 'Tax Rate', cell: cell(a.taxRate, 'ratio', 'estimate', A) },
    ],
    basisNote: 'Forecast(E)는 가정과 그 투영이며 Actual(A)이 아닙니다.',
    narrative,
  };
}

export function buildWacc(a: ValuationInput, r: ValuationResult): WaccSection {
  const A = SRC_ASSUMPTIONS, E = SRC_ENGINE;
  const c = (key: string, label: string, v: number, unit: ReportUnit, kind: DataKind, src: string) => ({ key, label, cell: cell(v, unit, kind, src) });
  return {
    components: [
      c('riskFreeRate', 'Risk-free Rate', a.riskFreeRate, 'ratio', 'estimate', A), c('beta', 'Beta', a.beta, 'factor', 'estimate', A), c('marketRiskPremium', 'Market Risk Premium', a.marketRiskPremium, 'ratio', 'estimate', A),
      c('costOfEquity', 'Cost of Equity', r.costOfEquity, 'ratio', 'calculated', E), c('preTaxCostOfDebt', 'Cost of Debt (pre-tax)', a.preTaxCostOfDebt, 'ratio', 'estimate', A),
      c('taxRate', 'Tax Rate', a.taxRate, 'ratio', 'estimate', A), c('afterTaxCostOfDebt', 'Cost of Debt (after-tax)', r.afterTaxCostOfDebt, 'ratio', 'calculated', E), c('equityWeight', 'Equity Weight', r.equityWeight, 'ratio', 'calculated', E), c('debtWeight', 'Debt Weight', r.debtWeight, 'ratio', 'calculated', E),
    ],
    wacc: cell(r.wacc, 'ratio', 'calculated', E),
    note: 'WACC 는 구성요소(Risk-free · Beta · MRP · 부채비용 · 자본구조)의 결과입니다. 구성요소 입력은 Estimate, WACC 와 가중치는 엔진이 계산한 값입니다.',
  };
}

export function buildDcf(input: ReportInput, a: ValuationInput, r: ValuationResult, narrative: SectionState<Narrative>): DcfSection {
  const E = SRC_ENGINE, A = SRC_ASSUMPTIONS;
  const t = (key: string, label: string, v: number, unit: ReportUnit, kind: DataKind, src: string) => ({ key, label, cell: cell(v, unit, kind, src) });
  return {
    periods: estimatePeriods(input, r.fcff.length),
    rows: [
      series('revenue', 'Revenue', 'eok', 'estimate', E, r.revenue), series('ebit', 'EBIT', 'eok', 'estimate', E, r.ebit),
      series('nopat', 'NOPAT', 'eok', 'calculated', E, r.nopat),
      series('depreciation', 'D&A', 'eok', 'estimate', A, a.depreciation), series('capex', 'CAPEX', 'eok', 'estimate', A, a.capex), series('deltaNwc', 'ΔNWC', 'eok', 'estimate', A, a.deltaNwc),
      series('fcff', 'FCFF', 'eok', 'calculated', E, r.fcff),
      series('discountFactor', 'Discount Factor', 'factor', 'calculated', E, r.discountFactors), series('pvFcff', 'PV of FCFF', 'eok', 'calculated', E, r.pvFcff),
    ],
    terminal: [
      t('terminalGrowth', 'Terminal Growth (g)', a.terminalGrowth, 'ratio', 'estimate', A), t('terminalFcff', 'Terminal FCFF', r.terminalFcff, 'eok', 'calculated', E),
      t('terminalValue', 'Terminal Value', r.terminalValue, 'eok', 'calculated', E), t('pvTerminalValue', 'PV of Terminal Value', r.pvTerminalValue, 'eok', 'calculated', E),
    ],
    bridge: [
      t('enterpriseValue', 'Enterprise Value', r.enterpriseValue, 'eok', 'calculated', E),
      t('interestBearingDebt', 'Interest-bearing Debt (입력)', a.interestBearingDebt, 'eok', 'estimate', A), t('cash', 'Cash (입력)', a.cash, 'eok', 'estimate', A),
      t('netDebt', 'Net Debt', r.netDebt, 'eok', 'calculated', E), t('equityValue', 'Equity Value', r.equityValue, 'eok', 'calculated', E),
      t('sharesOutstanding', 'Shares Outstanding (입력)', a.sharesOutstanding, 'shares', 'estimate', A), t('perShareValue', 'Value per Share', r.perShareValue, 'won', 'calculated', E),
    ],
    equityBridge: buildEquityBridge(a, r),
    narrative,
    tvContribution: cell(input.reviewMetrics?.terminalValueContribution, 'ratio', 'calculated', E, { state: 'unavailable', reason: 'PV(TV) / EV 를 구할 수 없습니다.' }),
  };
}

export type { Cell };

/** Equity Bridge 표기: 순부채면 EV − Net Debt = Equity, 순현금(Net Debt < 0)이면 EV + Net Cash = Equity. Net Cash 는 Net Debt 의 부호만 바꾼 표시이고 새 계산이 아니다. */
export function buildEquityBridge(a: ValuationInput, r: ValuationResult): EquityBridge {
  const E = SRC_ENGINE;
  const kind: EquityBridge['kind'] = r.netDebt > 0 ? 'net-debt' : r.netDebt < 0 ? 'net-cash' : 'neutral';
  const debtLine = kind === 'net-cash'
    ? { key: 'netCash', label: 'Net Cash', operator: '+' as const, cell: cell(-r.netDebt, 'eok', 'calculated', E) }
    : { key: 'netDebt', label: 'Net Debt', operator: '-' as const, cell: cell(r.netDebt, 'eok', 'calculated', E) };
  return {
    kind,
    lines: [
      { key: 'enterpriseValue', label: 'Enterprise Value', operator: null, cell: cell(r.enterpriseValue, 'eok', 'calculated', E) },
      debtLine,
      { key: 'equityValue', label: 'Equity Value', operator: '=', cell: cell(r.equityValue, 'eok', 'calculated', E) },
    ],
    sharesOutstanding: cell(a.sharesOutstanding, 'shares', 'estimate', SRC_ASSUMPTIONS),
    perShareValue: cell(r.perShareValue, 'won', 'calculated', E),
  };
}
