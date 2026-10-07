// 일반 제조업형 재무제표 구조인지 판별한다. 일반 normalizer 로 안정적으로 다룰 수 없는 구조는
// 그럴듯한 숫자를 만들지 않고 "지원하지 않는다" 고 명확히 돌려준다.
//   financial          은행 · 보험 · 증권 등: Revenue / Debt / NWC 개념이 일반 기업과 다르다.
//   expense-by-nature  비용을 성격별로 분류해 매출원가 · 매출총이익이 없는 손익계산서 (예: 일부 플랫폼 기업).
import type { DartRawAccount } from '../dart/types.ts';
import { normalizeAccountName } from './accounts.ts';

export type UnsupportedKind = 'financial' | 'expense-by-nature';

export interface Unsupported {
  kind: UnsupportedKind;
  message: string;
}

const FINANCIAL_BS_IDS = ['ifrs-full_DepositsFromCustomers', 'ifrs-full_InsuranceContractsIssuedThatAreLiabilities', 'ifrs-full_InsuranceContractLiabilities'];
const FINANCIAL_BS_NAMES = ['예수부채', '보험계약부채', '투자계약부채', '예수금'].map(normalizeAccountName);
const FINANCIAL_IS_NAMES = ['순이자손익', '이자수익', '보험료수익', '수수료수익', '보험손익'].map(normalizeAccountName);

export interface StructureFacts {
  hasRevenue: boolean;
  hasOperatingProfit: boolean;
  hasCogsOrGrossProfit: boolean;
}

export function detectUnsupported(rows: readonly DartRawAccount[], facts: StructureFacts): Unsupported | null {
  const bsSignal = rows.some((a) => a.statementType === 'BS' && ((a.accountId && FINANCIAL_BS_IDS.includes(a.accountId)) || FINANCIAL_BS_NAMES.includes(normalizeAccountName(a.accountName))));
  const isSignal = !facts.hasRevenue && !facts.hasOperatingProfit
    && rows.some((a) => a.statementType === 'IS' && FINANCIAL_IS_NAMES.includes(normalizeAccountName(a.accountName)));
  if (bsSignal || isSignal) {
    return { kind: 'financial', message: '금융업(은행 · 보험 · 증권) 재무제표 구조는 아직 지원하지 않습니다. 일반 기업용 계정 매핑으로 값을 만들지 않습니다.' };
  }
  if (facts.hasRevenue && facts.hasOperatingProfit && !facts.hasCogsOrGrossProfit) {
    return { kind: 'expense-by-nature', message: '비용을 성격별로 분류한 손익계산서(매출원가 · 매출총이익 없음)는 아직 지원하지 않습니다.' };
  }
  return null;
}

/** 금융 자회사를 연결하는 제조업 등: 금융업 계정이 섞여 있으면 부채 · 운전자본이 금융 부문을 포함할 수 있다. */
export function mixedFinancialBusiness(rows: readonly DartRawAccount[]): boolean {
  return rows.some((a) => a.statementType === 'BS' && a.accountName.replace(/\s+/g, '').startsWith('금융업'));
}
