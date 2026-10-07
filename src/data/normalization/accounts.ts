// 계정 매핑 테이블: 공시 계정 → ValuFlow canonical field. 규칙은 데이터이므로 계정을 추가해도 normalizeFinancials 는 바뀌지 않는다.
//
// 매핑 우선순위 (높은 것이 있으면 낮은 것은 쓰지 않는다):
//   1. account-id  신뢰할 수 있는 XBRL 표준 계정 ID            (ids)
//   2. exact-name  정확한 계정명                              (names)
//   3. alias       명시적으로 허용한 다른 표기                  (aliases)
//   4. weak        비슷하지만 같다고 단정할 수 없는 계정 → 항상 warning (weak)
// 찾지 못하면 missing 이며 어떤 경우에도 0 으로 바꾸지 않는다.
// 삼성전자 / 현대차 / SK하이닉스 / NAVER 의 실제 OpenDART 응답에서 확인한 accountId 를 반영했다 (docs/STEP06-3_raw_account_report.md).
import type { DartStatementType } from '../dart/types.ts';

export type RequiredField =
  | 'revenue' | 'cogs' | 'grossProfit' | 'sga' | 'operatingProfit' | 'netIncome'
  | 'accountsReceivable' | 'inventory' | 'accountsPayable' | 'totalAssets' | 'totalLiabilities' | 'totalEquity'
  | 'cfo' | 'ppeAcquisition' | 'intangibleAcquisition';
export type OptionalField = 'cash' | 'interestBearingDebt' | 'leaseLiabilities' | 'depreciationAmortization';
export type CanonicalField = RequiredField | OptionalField;

export const REQUIRED_FIELDS: readonly RequiredField[] = [
  'revenue', 'cogs', 'grossProfit', 'sga', 'operatingProfit', 'netIncome',
  'accountsReceivable', 'inventory', 'accountsPayable', 'totalAssets', 'totalLiabilities', 'totalEquity',
  'cfo', 'ppeAcquisition', 'intangibleAcquisition',
];
export const OPTIONAL_FIELDS: readonly OptionalField[] = ['cash', 'interestBearingDebt', 'leaseLiabilities', 'depreciationAmortization'];

export interface WeakMatch {
  id?: string;
  name?: string;
  note: string;
}

/** 합산 필드의 구성요소 하나. ids 가 이름보다 우선한다. combined 구성요소가 있으면 그것만 쓴다. */
export interface RulePart {
  label: string;
  ids?: readonly string[];
  names?: readonly string[];
  combined?: boolean;
}

export interface AccountRule {
  field: CanonicalField;
  label: string;
  /** 찾아보는 재무제표. 순서가 대표값 선택 우선순위다 (IS 와 CIS 에 같은 값이 있으면 IS 를 대표로 쓴다). */
  statements: readonly DartStatementType[];
  ids?: readonly string[];
  names: readonly string[];
  aliases?: readonly string[];
  weak?: readonly WeakMatch[];
  /** 이 ID 를 가진 행은 이름이 같아도 쓰지 않는다 (예: 비유동 채권 / 채무). */
  excludeIds?: readonly string[];
  /** 'components': parts 를 합산한다 (부채 · 리스부채 · D&A). */
  kind?: 'single' | 'components';
  parts?: readonly RulePart[];
  /** components 에서 일부 구성요소만 찾으면 warning. */
  warnIfPartial?: boolean;
  /** 현금흐름표의 취득 항목처럼 지출이 음수로 표기되는 계정은 크기(절댓값)로 저장한다. */
  magnitude?: boolean;
}

const IS: readonly DartStatementType[] = ['IS', 'CIS'];

export const ACCOUNT_RULES: readonly AccountRule[] = [
  { field: 'revenue', label: 'Revenue', statements: IS, ids: ['ifrs-full_Revenue'], names: ['매출액'], aliases: ['수익(매출액)', '영업수익', '매출', 'Revenue'] },
  { field: 'cogs', label: 'COGS', statements: IS, ids: ['ifrs-full_CostOfSales'], names: ['매출원가'], aliases: ['Cost of sales'] },
  { field: 'grossProfit', label: 'Gross Profit', statements: IS, ids: ['ifrs-full_GrossProfit'], names: ['매출총이익'], aliases: ['매출총이익(손실)'] },
  { field: 'sga', label: 'SG&A', statements: IS, ids: ['dart_TotalSellingGeneralAdministrativeExpenses'], names: ['판매비와관리비'], aliases: ['판매비와일반관리비'] },
  { field: 'operatingProfit', label: 'Operating Profit', statements: IS, ids: ['dart_OperatingIncomeLoss'], names: ['영업이익'], aliases: ['영업이익(손실)', '영업손익'] },
  // 지배/비지배 귀속분(ProfitLossAttributableTo…)이 아니라 총 당기순이익(ifrs-full_ProfitLoss)이다.
  { field: 'netIncome', label: 'Net Income', statements: IS, ids: ['ifrs-full_ProfitLoss'], names: ['당기순이익'], aliases: ['당기순이익(손실)', '연결당기순이익', '연결당기순이익(손실)', '당기순손익'] },

  {
    field: 'accountsReceivable', label: 'Accounts Receivable', statements: ['BS'],
    ids: ['ifrs-full_CurrentTradeReceivables'], names: ['매출채권'],
    weak: [
      { id: 'ifrs-full_TradeAndOtherCurrentReceivables', note: 'Accounts Receivable mapped from broader trade and other receivables account.' },
      { name: '매출채권및기타채권', note: 'Accounts Receivable mapped from broader trade and other receivables account.' },
    ],
    excludeIds: ['ifrs-full_NoncurrentTradeReceivables', 'ifrs-full_NoncurrentReceivables', 'ifrs-full_NoncurrentTradeAndOtherNoncurrentReceivables'],
  },
  { field: 'inventory', label: 'Inventory', statements: ['BS'], ids: ['ifrs-full_Inventories'], names: ['재고자산'] },
  {
    field: 'accountsPayable', label: 'Accounts Payable', statements: ['BS'],
    ids: ['ifrs-full_TradeAndOtherCurrentPayablesToTradeSuppliers', 'dart_ShortTermTradePayables', 'ifrs-full_CurrentTradePayables'], names: ['매입채무'],
    weak: [
      { id: 'ifrs-full_TradeAndOtherCurrentPayables', note: 'Accounts Payable mapped from broader trade and other payables account.' },
      { name: '매입채무및기타채무', note: 'Accounts Payable mapped from broader trade and other payables account.' },
    ],
    excludeIds: ['dart_LongTermTradeAndOtherNonCurrentPayables', 'ifrs-full_TradeAndOtherNoncurrentPayables', 'dart_LongTermTradePayables'],
  },
  { field: 'totalAssets', label: 'Total Assets', statements: ['BS'], ids: ['ifrs-full_Assets'], names: ['자산총계'] },
  { field: 'totalLiabilities', label: 'Total Liabilities', statements: ['BS'], ids: ['ifrs-full_Liabilities'], names: ['부채총계'] },
  { field: 'totalEquity', label: 'Total Equity', statements: ['BS'], ids: ['ifrs-full_Equity'], names: ['자본총계'] },
  { field: 'cash', label: 'Cash', statements: ['BS'], ids: ['ifrs-full_CashAndCashEquivalents'], names: ['현금및현금성자산'] },
  {
    // 이자부부채 = 차입금 + 사채(유동성 포함). 리스부채는 정책상 포함하지 않고 leaseLiabilities 로 따로 보존한다.
    field: 'interestBearingDebt', label: 'Interest-bearing Debt', statements: ['BS'], kind: 'components',
    names: [],
    parts: [
      { label: '단기차입금', ids: ['ifrs-full_ShorttermBorrowings'], names: ['단기차입금'] },
      { label: '유동성장기부채', ids: ['ifrs-full_CurrentPortionOfLongtermBorrowings'], names: ['유동성장기부채', '유동성장기차입금'] },
      { label: '유동성사채', ids: ['ifrs-full_CurrentBondsIssuedAndCurrentPortionOfNoncurrentBondsIssued'], names: ['유동성사채'] },
      { label: '사채', ids: ['ifrs-full_NoncurrentPortionOfNoncurrentBondsIssued'], names: ['사채'] },
      { label: '장기차입금', ids: ['ifrs-full_NoncurrentPortionOfNoncurrentLoansReceived'], names: ['장기차입금'] },
      { label: '차입금(유동)', ids: ['ifrs-full_CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings'] },
      { label: '차입금(장기)', ids: ['ifrs-full_LongtermBorrowings'] },
    ],
  },
  {
    field: 'leaseLiabilities', label: 'Lease Liabilities', statements: ['BS'], kind: 'components', names: [],
    parts: [
      { label: '리스부채(유동)', ids: ['ifrs-full_CurrentLeaseLiabilities'] },
      { label: '리스부채(비유동)', ids: ['ifrs-full_NoncurrentLeaseLiabilities'] },
    ],
  },

  { field: 'cfo', label: 'CFO', statements: ['CF'], ids: ['ifrs-full_CashFlowsFromUsedInOperatingActivities'], names: ['영업활동현금흐름'], aliases: ['영업활동으로인한현금흐름', '영업활동순현금흐름'] },
  { field: 'ppeAcquisition', label: 'PPE Acquisition', statements: ['CF'], ids: ['ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'], names: ['유형자산의취득'], aliases: ['유형자산취득'], magnitude: true },
  { field: 'intangibleAcquisition', label: 'Intangible Acquisition', statements: ['CF'], ids: ['ifrs-full_PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities'], names: ['무형자산의취득'], aliases: ['무형자산취득'], magnitude: true },
  {
    // 재무제표 본문에 직접 계정이 있을 때만 쓴다. 없으면 missing 이며 어떤 방법으로도 추정하지 않는다.
    field: 'depreciationAmortization', label: 'D&A', statements: ['CF'], kind: 'components', warnIfPartial: true, names: [],
    parts: [
      { label: '감가상각비 및 무형자산상각비', names: ['감가상각비및무형자산상각비', 'Depreciation and amortization'], combined: true },
      { label: '감가상각비', names: ['감가상각비'] },
      { label: '무형자산상각비', names: ['무형자산상각비'] },
    ],
  },
];

/** 비교용 정규화: 공백 · 앞 번호(Ⅰ. 1.) 제거, 소문자. "영업이익 (손실)" 과 "영업이익(손실)" 을 같게 본다. */
export function normalizeAccountName(name: string): string {
  return name.replace(/^[\sⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ0-9.]+/, '').replace(/\s+/g, '').toLowerCase();
}
