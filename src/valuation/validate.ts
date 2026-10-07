// 엔진 내부 공통 입력 검증. 모든 실패는 ValuationError 로 던지며 임의의 값으로 대체하지 않는다.
import { ValuationError } from './models.ts';

export const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function assertFinite(name: string, n: unknown): asserts n is number {
  if (!isFiniteNumber(n)) throw new ValuationError(`${name}: 숫자가 아닙니다.`);
}

/** 예측 기간(1년 이상)의 유한한 숫자 배열인지 확인한다. */
export function assertSeries(name: string, values: unknown): asserts values is number[] {
  if (!Array.isArray(values) || values.length === 0) throw new ValuationError(`${name}: 예측 기간(1년 이상)의 값이 필요합니다.`);
  values.forEach((v, i) => {
    if (!isFiniteNumber(v)) throw new ValuationError(`${name}: Y${i + 1} 값이 숫자가 아닙니다.`);
  });
}

/** 세율은 0 이상 1 미만의 소수 (25% → 0.25) */
export function assertTaxRate(taxRate: number): void {
  if (!isFiniteNumber(taxRate) || taxRate < 0 || taxRate >= 1) throw new ValuationError('taxRate: 0 이상 1 미만의 소수여야 합니다 (25% → 0.25).');
}
