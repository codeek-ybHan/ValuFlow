// 단위 변환 helper.
//   Historical Data : KRW million
//   Valuation Engine: 억원   (1억원 = 100,000,000원 = 100 KRW million)
// 원본 값을 변경하지 않고 새 값을 반환한다.

export const KRW_MILLION_PER_EOK = 100;

function assertFinite(name: string, v: number): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${name}: 유한한 숫자가 아닙니다.`);
}

/** KRW million → 억원  (333,605,938 → 3,336,059.38) */
export function krwMillionToEok(krwMillion: number): number {
  assertFinite('krwMillionToEok', krwMillion);
  return krwMillion / KRW_MILLION_PER_EOK;
}

/** 억원 → KRW million */
export function eokToKrwMillion(eok: number): number {
  assertFinite('eokToKrwMillion', eok);
  return eok * KRW_MILLION_PER_EOK;
}
