// Relative Valuation(상대가치): PER / PBR / EV·EBITDA 멀티플로 가치를 가늠한다.
// 사용자가 멀티플을 직접 입력한다 (Peer 자동 수집 없음). 금액은 억원, 멀티플은 배수, 주당가치는 원.
//
//   PER         Equity Value = Net Income × PER
//   PBR         Equity Value = Book Equity × PBR
//   EV/EBITDA   Enterprise Value = EBITDA × Multiple,  Equity Value = EV − Net Debt
//
// Equity Value ↔ EV 환산과 주당가치는 DCF 의 Equity Bridge 함수(dcf.ts)를 그대로 재사용한다.
// 각 방법은 독립적이다: 입력이 모자라면 그 방법만 incomplete 이고, 잘못된 값이면 그 방법만 invalid 이다.
import { calculateEquityValue, calculateNetDebt, calculatePerShareValue } from './dcf.ts';

export type RelativeMethod = 'PER' | 'PBR' | 'EV/EBITDA';

/** 사용자가 입력하는 상대가치 입력. 모두 선택 사항이며 방법별로 필요한 쌍이 모두 있어야 계산된다. */
export interface RelativeInput {
  /** 순이익 (억원) */
  netIncome?: number;
  per?: number;
  /** 자기자본 장부가 (억원) */
  bookEquity?: number;
  pbr?: number;
  /** EBITDA (억원) */
  ebitda?: number;
  evEbitda?: number;
}

/** Equity Bridge 입력 (DCF 단계의 가정과 같은 값) */
export interface RelativeBridge {
  interestBearingDebt?: number;
  cash?: number;
  sharesOutstanding?: number;
}

export type RelativeOutcome =
  | {
      method: RelativeMethod;
      status: 'ok';
      /** 억원. PER / PBR 은 Equity Value + Net Debt 로 환산한 참고값 (evDerived). Net Debt 를 모르면 null */
      enterpriseValue: number | null;
      /** 억원. EV/EBITDA 에서 Net Debt 를 모르면 null */
      equityValue: number | null;
      /** 원. 주식 수를 모르거나 Equity Value 가 없으면 null */
      perShareValue: number | null;
      evDerived: boolean;
      notes: string[];
    }
  | { method: RelativeMethod; status: 'incomplete'; missing: string[] }
  | { method: RelativeMethod; status: 'invalid'; error: string };

const METHOD_FIELDS: Record<RelativeMethod, [keyof RelativeInput, keyof RelativeInput]> = {
  PER: ['netIncome', 'per'],
  PBR: ['bookEquity', 'pbr'],
  'EV/EBITDA': ['ebitda', 'evEbitda'],
};

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** EV = EBITDA × Multiple */
export function enterpriseValueFromEvEbitda(ebitda: number, multiple: number): number {
  return ebitda * multiple;
}
/** Equity Value = Net Income × PER */
export function equityValueFromPer(netIncome: number, per: number): number {
  return netIncome * per;
}
/** Equity Value = Book Equity × PBR */
export function equityValueFromPbr(bookEquity: number, pbr: number): number {
  return bookEquity * pbr;
}

function bridgeOf(bridge: RelativeBridge): { netDebt: number | null; shares: number | null } {
  const netDebt = finite(bridge.interestBearingDebt) && finite(bridge.cash) ? calculateNetDebt(bridge.interestBearingDebt, bridge.cash) : null;
  const shares = finite(bridge.sharesOutstanding) ? bridge.sharesOutstanding : null;
  return { netDebt, shares };
}

function evaluate(method: RelativeMethod, input: RelativeInput, bridge: RelativeBridge): RelativeOutcome {
  const [metricKey, multipleKey] = METHOD_FIELDS[method];
  const metric = input[metricKey];
  const multiple = input[multipleKey];
  const missing = [metricKey, multipleKey].filter((k) => input[k] === undefined) as string[];
  if (missing.length > 0) return { method, status: 'incomplete', missing };

  if (!finite(metric) || !finite(multiple)) return { method, status: 'invalid', error: '입력이 유한한 숫자가 아닙니다.' };
  const metricName = { PER: '순이익', PBR: '자기자본 장부가', 'EV/EBITDA': 'EBITDA' }[method];
  if (metric <= 0) return { method, status: 'invalid', error: `${metricName}가 0 이하이면 ${method} 가치평가가 의미 없습니다.` };
  if (multiple <= 0) return { method, status: 'invalid', error: `${method} 멀티플은 0 보다 커야 합니다.` };
  if (bridge.sharesOutstanding !== undefined && !(finite(bridge.sharesOutstanding) && bridge.sharesOutstanding > 0)) {
    return { method, status: 'invalid', error: '발행주식수는 0 보다 커야 합니다.' };
  }

  const { netDebt, shares } = bridgeOf(bridge);
  const notes: string[] = [];

  if (method === 'EV/EBITDA') {
    const enterpriseValue = enterpriseValueFromEvEbitda(metric, multiple);
    const equityValue = netDebt === null ? null : calculateEquityValue(enterpriseValue, netDebt);
    if (netDebt === null) notes.push('Equity Value 로 환산하려면 이자부부채와 현금이 필요합니다.');
    const perShareValue = equityValue !== null && shares !== null ? calculatePerShareValue(equityValue, shares) : null;
    if (equityValue !== null && shares === null) notes.push('주당가치를 계산하려면 발행주식수가 필요합니다.');
    return { method, status: 'ok', enterpriseValue, equityValue, perShareValue, evDerived: false, notes };
  }

  // PER / PBR: Equity Value 가 직접 나오고, EV 는 Net Debt 를 더해 환산한 참고값이다.
  const equityValue = method === 'PER' ? equityValueFromPer(metric, multiple) : equityValueFromPbr(metric, multiple);
  const enterpriseValue = netDebt === null ? null : equityValue + netDebt;
  if (netDebt === null) notes.push('Enterprise Value 로 환산하려면 이자부부채와 현금이 필요합니다.');
  const perShareValue = shares === null ? null : calculatePerShareValue(equityValue, shares);
  if (shares === null) notes.push('주당가치를 계산하려면 발행주식수가 필요합니다.');
  return { method, status: 'ok', enterpriseValue, equityValue, perShareValue, evDerived: true, notes };
}

/** 세 방법을 각각 계산한다. 한 방법의 입력 부족이나 오류가 다른 방법에 영향을 주지 않는다. */
export function calculateRelativeValuation(input: RelativeInput, bridge: RelativeBridge = {}): RelativeOutcome[] {
  return (['PER', 'PBR', 'EV/EBITDA'] as const).map((m) => evaluate(m, input, bridge));
}

