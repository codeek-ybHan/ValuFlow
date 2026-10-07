// Report 전역 단위 정책. Renderer 가 단위를 임의로 추정하지 않도록 모든 값은 이 정책으로 Cell 이 된다.
// 환산은 STEP 08-6 의 display helper(`ai/tools/display.ts`)만 쓴다 — Report 에 환산 로직을 따로 두지 않는다. 엔진 값은 반올림하지 않고 표시 문자열만 자릿수를 정한다.
import { formatFinancialValue, formatPercent, krwMillionToEok } from '../ai/tools/display.ts';
import type { Cell, CellState, DataKind, ReportUnit } from './types.ts';

export const REPORT_UNIT_POLICY = {
  currency: 'KRW',
  /** 재무제표 · 가치 금액 */
  monetaryUnit: '억원',
  /** 1조원 이상은 조원 표기를 보조로 함께 둔다 */
  largeValue: '조원 (보조 표기)',
  perShare: '원',
  rates: '% (원본은 소수)',
  shares: '주',
  historicalSourceUnit: 'KRW million → 억원 (÷100, display helper)',
} as const;

const LARGE_EOK = 10_000;   // 1조원

const textOf = (value: number, unit: ReportUnit): { text: string; largeText: string | null } => {
  switch (unit) {
    case 'eok': return { text: formatFinancialValue(value, '억원', 'eok')!, largeText: Math.abs(value) >= LARGE_EOK ? formatFinancialValue(value, '억원', 'jo') : null };
    case 'won': return { text: `${Math.round(value).toLocaleString('ko-KR')}원`, largeText: null };
    case 'ratio': return { text: formatPercent(value), largeText: null };
    case 'shares': return { text: `${Math.round(value).toLocaleString('ko-KR')}주`, largeText: null };
    case 'multiple': return { text: `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}배`, largeText: null };
    case 'factor': return { text: value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }), largeText: null };
  }
};

export function missingCell(state: Exclude<CellState, 'ok'>, unit: ReportUnit, kind: DataKind, reason: string, sourceId: string | null = null): Cell {
  return { state, value: null, unit, kind, text: null, largeText: null, sourceId, reason };
}

/** 값이 유한한 숫자면 ok Cell, 아니면 missing. 없는 값을 0 으로 채우지 않는다. */
export function cell(value: number | null | undefined, unit: ReportUnit, kind: DataKind, sourceId: string | null, ifMissing: { state?: Exclude<CellState, 'ok'>; reason?: string } = {}): Cell {
  if (typeof value !== 'number' || !Number.isFinite(value)) return missingCell(ifMissing.state ?? 'missing', unit, kind, ifMissing.reason ?? '값이 없습니다.', sourceId);
  const t = textOf(value, unit);
  return { state: 'ok', value, unit, kind, text: t.text, largeText: t.largeText, sourceId, reason: null };
}

/** Historical 원본(KRW million)을 정책 단위(억원)로 바꿔 Cell 로 만든다. */
export const eokFromKrwMillion = (v: number | null | undefined, kind: DataKind, sourceId: string | null, ifMissing?: Parameters<typeof cell>[4]): Cell =>
  cell(typeof v === 'number' && Number.isFinite(v) ? krwMillionToEok(v) : v, 'eok', kind, sourceId, ifMissing);
