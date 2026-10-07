// 원본 금액 단위 → 내부 Historical 기준(KRW million) 변환.
//   내부 Historical 기준 : KRW million
//   Valuation Engine 진입 : KRW million → 억원 은 engine/units.ts 의 krwMillionToEok 를 그대로 사용한다 (여기서 중복 구현하지 않는다).
import type { DartRawUnit } from '../dart/types.ts';

const KRW_PER_UNIT: Record<DartRawUnit, number> = { KRW: 1, thousand: 1_000, million: 1_000_000 };
const KRW_PER_MILLION = 1_000_000;

export function isRawUnit(v: unknown): v is DartRawUnit {
  return v === 'KRW' || v === 'thousand' || v === 'million';
}

/** 원 / 천원 / 백만원 → KRW million. 원본 값은 바꾸지 않고 새 값을 반환한다. */
export function toKrwMillion(amount: number, unit: DartRawUnit): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new TypeError('toKrwMillion: 유한한 숫자가 아닙니다.');
  const per = KRW_PER_UNIT[unit];
  if (per === undefined) throw new TypeError(`toKrwMillion: 알 수 없는 단위 ${String(unit)}`);
  return (amount * per) / KRW_PER_MILLION;
}
