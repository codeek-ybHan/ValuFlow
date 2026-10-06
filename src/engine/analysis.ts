// 재무분석 계산. UI/LLM 과 무관한 순수 함수. 계산 불가 시 null 반환(가짜 값 생성 금지).
import type { FinancialRecord } from '../types';

export type Num = number | null | undefined;

const ok = (n: Num): n is number => typeof n === 'number' && Number.isFinite(n);

export function safeDiv(a: Num, b: Num): number | null {
  if (!ok(a) || !ok(b) || b === 0) return null;
  return a / b;
}

export const growth = (cur: Num, prev: Num): number | null =>
  ok(cur) && ok(prev) && prev > 0 ? cur / prev - 1 : null;

export const revenueGrowth = (cur: Num, prev: Num) => growth(cur, prev);
export const operatingIncomeGrowth = (cur: Num, prev: Num) => growth(cur, prev);
export const operatingMargin = (oi: Num, revenue: Num) => safeDiv(oi, revenue);
export const grossMargin = (gp: Num, revenue: Num) => safeDiv(gp, revenue);
export const netMargin = (ni: Num, revenue: Num) => safeDiv(ni, revenue);
export const roe = (ni: Num, equity: Num) => safeDiv(ni, equity);
export const roa = (ni: Num, assets: Num) => safeDiv(ni, assets);
export const debtRatio = (liabilities: Num, equity: Num) => safeDiv(liabilities, equity);
export const currentRatio = (ca: Num, cl: Num) => safeDiv(ca, cl);

/** CAGR. 시작값이 0 이하이거나 기간이 1 미만이면 null */
export function cagr(first: Num, last: Num, years: number): number | null {
  if (!ok(first) || !ok(last) || first <= 0 || last <= 0 || years < 1) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

export const nwc = (r: Pick<FinancialRecord, 'receivables' | 'inventory' | 'payables'>): number | null =>
  ok(r.receivables) && ok(r.inventory) && ok(r.payables) ? r.receivables + r.inventory - r.payables : null;

export const netDebt = (debt: Num, cash: Num): number | null => (ok(debt) && ok(cash) ? debt - cash : null);

export interface YearMetrics {
  year: number;
  revenue: Num;
  operatingIncome: Num;
  netIncome: Num;
  revenueGrowth: number | null;
  operatingIncomeGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  roa: number | null;
  debtRatio: number | null;
  currentRatio: number | null;
  cfo: Num;
  capex: Num;
  cfoToNetIncome: number | null;
  cfoMinusCapex: number | null;
}

/** 같은 기업·같은 기준(연결/별도)의 연도별 레코드로 지표 계산 */
export function computeMetrics(records: FinancialRecord[]): YearMetrics[] {
  const sorted = [...records].sort((a, b) => a.year - b.year);
  return sorted.map((r, i) => {
    const prev = i > 0 && sorted[i - 1].year === r.year - 1 ? sorted[i - 1] : undefined;
    return {
      year: r.year,
      revenue: r.revenue,
      operatingIncome: r.operatingIncome,
      netIncome: r.netIncome,
      revenueGrowth: growth(r.revenue, prev?.revenue),
      operatingIncomeGrowth: growth(r.operatingIncome, prev?.operatingIncome),
      grossMargin: grossMargin(r.grossProfit, r.revenue),
      operatingMargin: operatingMargin(r.operatingIncome, r.revenue),
      netMargin: netMargin(r.netIncome, r.revenue),
      roe: roe(r.netIncome, r.equity),
      roa: roa(r.netIncome, r.assets),
      debtRatio: debtRatio(r.liabilities, r.equity),
      currentRatio: currentRatio(r.currentAssets, r.currentLiabilities),
      cfo: r.cfo,
      capex: r.capex,
      cfoToNetIncome: safeDiv(r.cfo, r.netIncome),
      cfoMinusCapex: ok(r.cfo) && ok(r.capex) ? r.cfo - Math.abs(r.capex) : null,
    };
  });
}

/** 입력 정합성 점검: 자산 = 부채 + 자본 */
export function balanceCheck(r: FinancialRecord): { ok: boolean; diff: number } | null {
  if (!ok(r.assets) || !ok(r.liabilities) || !ok(r.equity)) return null;
  const diff = r.assets - (r.liabilities + r.equity);
  const tol = Math.max(1, Math.abs(r.assets) * 0.0005);
  return { ok: Math.abs(diff) <= tol, diff };
}
