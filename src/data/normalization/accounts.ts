// 계정 매핑 테이블: 공시 계정명 / XBRL ID → ValuFlow 의 canonical field.
// 규칙은 데이터이므로 계정이 추가돼도 normalizeFinancials 는 바뀌지 않는다.
import type { DartStatementType } from '../dart/types.ts';

export type RequiredField =
  | 'revenue' | 'cogs' | 'grossProfit' | 'sga' | 'operatingProfit' | 'netIncome'
  | 'accountsReceivable' | 'inventory' | 'accountsPayable' | 'totalAssets' | 'totalLiabilities' | 'totalEquity'
  | 'cfo' | 'ppeAcquisition' | 'intangibleAcquisition';
export type OptionalField = 'cash' | 'interestBearingDebt' | 'depreciationAmortization';
export type CanonicalField = RequiredField | OptionalField;

export const REQUIRED_FIELDS: readonly RequiredField[] = [
  'revenue', 'cogs', 'grossProfit', 'sga', 'operatingProfit', 'netIncome',
  'accountsReceivable', 'inventory', 'accountsPayable', 'totalAssets', 'totalLiabilities', 'totalEquity',
  'cfo', 'ppeAcquisition', 'intangibleAcquisition',
];
export const OPTIONAL_FIELDS: readonly OptionalField[] = ['cash', 'interestBearingDebt', 'depreciationAmortization'];

export interface AccountRule {
  field: CanonicalField;
  /** 이 규칙이 찾아보는 재무제표. 손익계산서 항목은 IS 또는 CIS 어느 쪽에 있어도 된다. */
  statements: readonly DartStatementType[];
  /** 정확히 같다고 보는 계정명 (공백 제거 후 비교). */
  names: readonly string[];
  /** 정확히 같다고 보는 XBRL ID. */
  ids?: readonly string[];
  /** 비슷하지만 같다고 단정할 수 없는 계정명. strong 후보가 없을 때만 쓰고 warning 을 남긴다. */
  weakNames?: readonly { name: string; note: string }[];
  /** 'sum' : names 의 각 항목을 구성요소로 보고 찾은 것들을 합산한다. */
  kind?: 'single' | 'sum';
  /** sum 일 때 일부 구성요소만 찾으면 warning 을 남긴다. */
  warnIfPartial?: boolean;
  /** 현금흐름표의 취득 항목처럼 지출이 음수로 표기되는 계정은 크기(절댓값)로 저장한다. */
  magnitude?: boolean;
  label: string;
}

const IS: readonly DartStatementType[] = ['IS', 'CIS'];

export const ACCOUNT_RULES: readonly AccountRule[] = [
  { field: 'revenue', label: 'Revenue', statements: IS, names: ['매출액', '수익(매출액)', '영업수익', '매출', 'Revenue'], ids: ['ifrs-full_Revenue'] },
  { field: 'cogs', label: 'COGS', statements: IS, names: ['매출원가', 'Costofsales'], ids: ['ifrs-full_CostOfSales'] },
  { field: 'grossProfit', label: 'Gross Profit', statements: IS, names: ['매출총이익', '매출총이익(손실)'], ids: ['ifrs-full_GrossProfit'] },
  { field: 'sga', label: 'SG&A', statements: IS, names: ['판매비와관리비', '판매비와일반관리비'], ids: ['dart_TotalSellingGeneralAdministrativeExpenses'] },
  { field: 'operatingProfit', label: 'Operating Profit', statements: IS, names: ['영업이익', '영업이익(손실)', '영업손익'], ids: ['dart_OperatingIncomeLoss'] },
  { field: 'netIncome', label: 'Net Income', statements: IS, names: ['당기순이익', '당기순이익(손실)', '연결당기순이익', '연결당기순이익(손실)', '당기순손익'], ids: ['ifrs-full_ProfitLoss'] },

  {
    field: 'accountsReceivable', label: 'Accounts Receivable', statements: ['BS'], names: ['매출채권'],
    weakNames: [{ name: '매출채권및기타채권', note: 'Accounts Receivable mapped from trade and other receivables' }],
  },
  { field: 'inventory', label: 'Inventory', statements: ['BS'], names: ['재고자산'], ids: ['ifrs-full_Inventories'] },
  {
    field: 'accountsPayable', label: 'Accounts Payable', statements: ['BS'], names: ['매입채무'],
    weakNames: [{ name: '매입채무및기타채무', note: 'Accounts Payable mapped from trade and other payables' }],
  },
  { field: 'totalAssets', label: 'Total Assets', statements: ['BS'], names: ['자산총계'], ids: ['ifrs-full_Assets'] },
  { field: 'totalLiabilities', label: 'Total Liabilities', statements: ['BS'], names: ['부채총계'], ids: ['ifrs-full_Liabilities'] },
  { field: 'totalEquity', label: 'Total Equity', statements: ['BS'], names: ['자본총계'], ids: ['ifrs-full_Equity'] },
  { field: 'cash', label: 'Cash', statements: ['BS'], names: ['현금및현금성자산'], ids: ['ifrs-full_CashAndCashEquivalents'] },
  {
    field: 'interestBearingDebt', label: 'Interest-bearing Debt', statements: ['BS'], kind: 'sum',
    names: ['단기차입금', '유동성장기부채', '유동성사채', '사채', '장기차입금'],
  },

  { field: 'cfo', label: 'CFO', statements: ['CF'], names: ['영업활동현금흐름', '영업활동으로인한현금흐름', '영업활동순현금흐름'], ids: ['ifrs-full_CashFlowsFromUsedInOperatingActivities'] },
  { field: 'ppeAcquisition', label: 'PPE Acquisition', statements: ['CF'], names: ['유형자산의취득', '유형자산취득'], ids: ['ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'], magnitude: true },
  { field: 'intangibleAcquisition', label: 'Intangible Acquisition', statements: ['CF'], names: ['무형자산의취득', '무형자산취득'], ids: ['ifrs-full_PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities'], magnitude: true },
  { field: 'depreciationAmortization', label: 'D&A', statements: ['CF'], kind: 'sum', warnIfPartial: true, names: ['감가상각비', '무형자산상각비'] },
];

/** 비교용 정규화: 공백 · 앞 번호(Ⅰ. 1.) 제거, 소문자. "영업이익 (손실)" 과 "영업이익(손실)" 을 같게 본다. */
export function normalizeAccountName(name: string): string {
  return name.replace(/^[\sⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ0-9.]+/, '').replace(/\s+/g, '').toLowerCase();
}
