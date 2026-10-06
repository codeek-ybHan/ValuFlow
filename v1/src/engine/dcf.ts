// FCFF / WACC / DCF / Sensitivity 엔진. 순수 함수 + 명시적 예외처리.
// LLM 은 이 모듈을 Tool 로 호출만 해야 하며 핵심 숫자를 직접 계산하지 않는다.

export class ValuationError extends Error {}

export const calculateNopat = (ebit: number, taxRate: number): number => {
  if (taxRate < 0 || taxRate >= 1) throw new ValuationError('세율은 0 이상 1 미만이어야 합니다.');
  return ebit * (1 - taxRate);
};

/** FCFF = NOPAT + D&A - CAPEX - ΔNWC (CAPEX, D&A 는 양수로 입력) */
export const calculateFcff = (nopat: number, da: number, capex: number, deltaNwc: number): number =>
  nopat + da - capex - deltaNwc;

export const costOfEquity = (rf: number, beta: number, mrp: number) => rf + beta * mrp;
export const afterTaxCostOfDebt = (kd: number, tax: number) => kd * (1 - tax);

export function calculateWacc(p: {
  equityValue: number;
  debtValue: number;
  costOfEquity: number;
  costOfDebt: number;
  taxRate: number;
}): number {
  const v = p.equityValue + p.debtValue;
  if (!(v > 0) || p.equityValue < 0 || p.debtValue < 0) throw new ValuationError('자본(E)과 부채(D)는 0 이상이고 합이 0보다 커야 합니다.');
  return (p.equityValue / v) * p.costOfEquity + (p.debtValue / v) * afterTaxCostOfDebt(p.costOfDebt, p.taxRate);
}

export interface ForecastAssumptions {
  baseRevenue: number;
  growth: number[]; // 연도별 성장률 (길이 = 예측기간)
  operatingMargin: number[]; // 연도별 영업이익률
  taxRate: number;
  daPctRevenue: number;
  capexPctRevenue: number;
  /** 연도별 ΔNWC 를 매출 증가분의 몇 %로 가정하는가 */
  nwcPctOfRevenueChange: number;
}

export interface ForecastRow {
  year: number; // 1..n
  revenue: number;
  ebit: number;
  nopat: number;
  da: number;
  capex: number;
  deltaNwc: number;
  fcff: number;
}

export function forecastFcff(a: ForecastAssumptions): ForecastRow[] {
  if (a.growth.length !== a.operatingMargin.length || a.growth.length === 0)
    throw new ValuationError('성장률과 영업이익률의 연도 수가 같고 1 이상이어야 합니다.');
  if (!(a.baseRevenue > 0)) throw new ValuationError('기준 매출은 0보다 커야 합니다.');
  const rows: ForecastRow[] = [];
  let prevRev = a.baseRevenue;
  a.growth.forEach((g, i) => {
    const revenue = prevRev * (1 + g);
    const ebit = revenue * a.operatingMargin[i];
    const nopat = calculateNopat(ebit, a.taxRate);
    const da = revenue * a.daPctRevenue;
    const capex = revenue * a.capexPctRevenue;
    const deltaNwc = (revenue - prevRev) * a.nwcPctOfRevenueChange;
    rows.push({ year: i + 1, revenue, ebit, nopat, da, capex, deltaNwc, fcff: calculateFcff(nopat, da, capex, deltaNwc) });
    prevRev = revenue;
  });
  return rows;
}

/** Gordon Growth: TV_n = FCFF_n × (1+g) / (WACC - g) */
export function calculateTerminalValue(lastFcff: number, wacc: number, g: number): number {
  if (!(wacc > g)) throw new ValuationError('WACC 가 영구성장률 g 보다 커야 Terminal Value 를 계산할 수 있습니다.');
  return (lastFcff * (1 + g)) / (wacc - g);
}

/** 기말(end-of-year) 할인 가정 */
export const discountFactor = (wacc: number, t: number) => 1 / Math.pow(1 + wacc, t);

export interface DcfResult {
  pvFcff: number[];
  sumPvFcff: number;
  terminalValue: number;
  pvTerminalValue: number;
  enterpriseValue: number;
  tvShare: number;
  wacc: number;
  g: number;
}

export function calculateEnterpriseValue(fcffs: number[], wacc: number, g: number): DcfResult {
  if (fcffs.length === 0) throw new ValuationError('FCFF 예측값이 없습니다.');
  const pvFcff = fcffs.map((f, i) => f * discountFactor(wacc, i + 1));
  const sumPvFcff = pvFcff.reduce((s, x) => s + x, 0);
  const terminalValue = calculateTerminalValue(fcffs[fcffs.length - 1], wacc, g);
  const pvTerminalValue = terminalValue * discountFactor(wacc, fcffs.length);
  const enterpriseValue = sumPvFcff + pvTerminalValue;
  return { pvFcff, sumPvFcff, terminalValue, pvTerminalValue, enterpriseValue, tvShare: enterpriseValue !== 0 ? pvTerminalValue / enterpriseValue : NaN, wacc, g };
}

/** Equity Value = EV - Net Debt (기타 조정항목은 adjustments 로 별도 차감) */
export const calculateEquityValue = (ev: number, netDebt: number, adjustments = 0) => ev - netDebt - adjustments;

export interface SensitivityCell {
  wacc: number;
  g: number;
  ev: number | null; // WACC <= g 인 조합은 null (계산 불가로 표시)
  equity: number | null;
}

export function sensitivityMatrix(fcffs: number[], waccs: number[], gs: number[], netDebt: number): SensitivityCell[][] {
  return waccs.map((w) =>
    gs.map((g) => {
      if (!(w > g)) return { wacc: w, g, ev: null, equity: null };
      const ev = calculateEnterpriseValue(fcffs, w, g).enterpriseValue;
      return { wacc: w, g, ev, equity: calculateEquityValue(ev, netDebt) };
    }),
  );
}
