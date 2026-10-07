// 정규화 결과의 sanity check. 검증에 실패해도 데이터를 수정하지 않고 warning 만 더한다.
// 금액은 KRW million. tolerance 를 두어 반올림 차이로는 경고하지 않는다.
import type { QualityCheck } from './quality.ts';

export interface CheckInput {
  years: readonly number[];
  series: Partial<Record<string, (number | null)[]>>;
}

const REL_TOL = 0.001;     // 0.1%
const ABS_TOL = 1;         // 1 KRW million
const UNIT_JUMP = 100;     // 연도 간 100배 이상 차이면 단위 불일치 의심

const within = (a: number, b: number) => Math.abs(a - b) <= Math.max(ABS_TOL, REL_TOL * Math.max(Math.abs(a), Math.abs(b)));

export function runChecks(input: CheckInput): QualityCheck[] {
  const out: QualityCheck[] = [];
  const get = (f: string, i: number) => input.series[f]?.[i] ?? null;

  input.years.forEach((year, i) => {
    const assets = get('totalAssets', i), liab = get('totalLiabilities', i), eq = get('totalEquity', i);
    if (assets !== null && liab !== null && eq !== null) {
      const ok = within(assets, liab + eq);
      out.push({ name: 'assets = liabilities + equity', fiscalYear: year, status: ok ? 'pass' : 'warn',
        message: ok ? 'ok' : `Assets (${assets}) differ from Liabilities + Equity (${liab + eq}) in ${year}` });
    }
    const rev = get('revenue', i), cogs = get('cogs', i), gp = get('grossProfit', i);
    if (rev !== null && cogs !== null && gp !== null) {
      const ok = within(gp, rev - cogs);
      out.push({ name: 'gross profit = revenue - cogs', fiscalYear: year, status: ok ? 'pass' : 'warn',
        message: ok ? 'ok' : `Gross Profit (${gp}) differs from Revenue - COGS (${rev - cogs}) in ${year}` });
    }
    const op = get('operatingProfit', i);
    if (rev !== null && op !== null && rev !== 0) {
      const margin = op / rev;
      const ok = Number.isFinite(margin) && Math.abs(margin) <= 1;
      out.push({ name: 'operating margin in range', fiscalYear: year, status: ok ? 'pass' : 'warn',
        message: ok ? 'ok' : `Operating margin ${(margin * 100).toFixed(1)}% is outside ±100% in ${year}` });
    }
    // 부호 이상: 이 값들은 일반적으로 음수가 아니다
    for (const f of ['revenue', 'totalAssets', 'inventory', 'accountsReceivable', 'accountsPayable', 'cash', 'interestBearingDebt', 'depreciationAmortization']) {
      const v = get(f, i);
      if (v !== null && v < 0) out.push({ name: 'sign anomaly', fiscalYear: year, status: 'warn', message: `Sign anomaly: ${f} is negative in ${year}` });
    }
    const ar = get('accountsReceivable', i), inv = get('inventory', i), ap = get('accountsPayable', i);
    if (ar !== null && inv !== null && ap !== null) {
      out.push({ name: 'nwc computable', fiscalYear: year, status: Number.isFinite(ar + inv - ap) ? 'pass' : 'warn', message: 'NWC = AR + Inventory - AP' });
    }
  });

  // 연도 간 단위 불일치: 같은 계정이 인접 연도에서 비정상적으로 크게 달라지면 단위가 섞였을 수 있다
  for (const f of ['revenue', 'totalAssets']) {
    for (let i = 1; i < input.years.length; i++) {
      const a = get(f, i - 1), b = get(f, i);
      if (a !== null && b !== null && a > 0 && b > 0 && (b / a >= UNIT_JUMP || a / b >= UNIT_JUMP)) {
        out.push({ name: 'unit mismatch', fiscalYear: input.years[i], status: 'warn', message: `Possible unit mismatch: ${f} changes by more than ${UNIT_JUMP}x between ${input.years[i - 1]} and ${input.years[i]}` });
      }
    }
  }
  return out;
}
