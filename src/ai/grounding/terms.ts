// 한국어 · 영어 용어 정규화: 문장의 용어("영업이익률", "발행주식수" …)를 Tool 결과의 field 이름(operatingMargin, sharesOutstanding …)에 연결한다.
// claim ↔ evidence 연결, 값이 없는 항목(missing)을 채우는 답변 감지, WACC 구성요소 판별에 쓴다. 더 긴 표현이 우선한다 ("영업이익률" 안의 "영업이익"은 따로 세지 않는다).
export type TermCategory = 'historical' | 'valuation' | 'wacc' | 'market' | 'peer';

export interface Term {
  key: string;
  category: TermCategory;
  ko: string[];
  en: string[];
  /** 이 용어에 해당하는 field 이름(경로의 한 segment) */
  fields: string[];
}

const T = (key: string, category: TermCategory, ko: string[], en: string[], fields: string[] = [key]): Term => ({ key, category, ko, en, fields });

export const TERMS: readonly Term[] = [
  T('operatingMargin', 'historical', ['영업이익률', '영업 이익률'], ['operating margin']),
  T('grossMargin', 'historical', ['매출총이익률', '매출 총이익률'], ['gross margin']),
  T('netMargin', 'historical', ['순이익률', '당기순이익률'], ['net margin']),
  T('revenueGrowth', 'historical', ['매출 성장률', '매출성장률', '매출 증가율', '매출액 증가율'], ['revenue growth']),
  T('operatingProfit', 'historical', ['영업이익'], ['operating profit', 'operating income']),
  T('netIncome', 'historical', ['당기순이익', '순이익'], ['net income']),
  T('revenue', 'historical', ['매출액', '매출'], ['revenue', 'sales']),
  T('nwc', 'historical', ['운전자본', 'NWC'], ['nwc', 'net working capital']),
  T('deltaNwc', 'historical', ['운전자본 증감', '운전자본 변동'], ['delta nwc'], ['deltaNwc']),
  T('capex', 'historical', ['CAPEX', '설비투자', '시설투자', '유형자산 취득'], ['capex', 'capital expenditure'], ['capex', 'ppeAcquisition']),
  T('cfoMinusCapex', 'historical', ['CFO−CAPEX', 'CFO-CAPEX', 'CFO–CAPEX', 'CFO 대비 CAPEX', '순현금흐름', '잉여현금흐름(참고)'], ['cfo minus capex']),
  T('nwcToRevenue', 'historical', ['매출 대비 운전자본', '운전자본 비중', 'NWC/매출', 'NWC / Revenue'], ['nwc to revenue']),
  T('leaseLiabilities', 'historical', ['리스부채', '리스 부채'], ['lease liabilities']),
  T('cfo', 'historical', ['영업활동현금흐름', '영업현금흐름', 'CFO'], ['cfo', 'operating cash flow']),
  T('depreciation', 'historical', ['감가상각', 'D&A'], ['depreciation', 'd&a'], ['depreciation', 'depreciationAmortization']),
  T('enterpriseValue', 'valuation', ['기업가치', 'EV'], ['enterprise value']),
  T('equityValue', 'valuation', ['주주가치', '지분가치', '자기자본가치'], ['equity value']),
  T('perShareValue', 'valuation', ['주당가치', '주당 가치', '주당 가격'], ['per share value']),
  T('terminalGrowth', 'valuation', ['영구성장률', '영구 성장률', '영구성장'], ['terminal growth']),
  T('fcff', 'valuation', ['FCFF', '잉여현금흐름', '잉여 현금흐름'], ['fcff', 'free cash flow']),
  T('tvContribution', 'valuation', ['터미널 가치 비중', '터미널밸류 비중', '영구가치 비중', '터미널 가치 기여도', 'Terminal Value 기여도', 'TV 기여도', '영구가치 기여도', '터미널밸류 기여도'], ['terminal value share', 'terminal value contribution'], ['tvContribution']),
  T('wacc', 'wacc', ['WACC', '가중평균자본비용', '할인율'], ['wacc', 'discount rate']),
  T('riskFreeRate', 'wacc', ['무위험수익률', '무위험이자율', '무위험 금리', '무위험률', '국고채'], ['risk-free rate', 'risk free rate']),
  T('beta', 'wacc', ['베타'], ['beta']),
  T('marketRiskPremium', 'wacc', ['시장위험프리미엄', '시장 위험 프리미엄', '위험프리미엄', 'MRP'], ['market risk premium']),
  T('costOfDebt', 'wacc', ['타인자본비용', '부채비용', '차입비용'], ['cost of debt'], ['preTaxCostOfDebt', 'afterTaxCostOfDebt']),
  T('costOfEquity', 'wacc', ['자기자본비용', '자본비용'], ['cost of equity'], ['costOfEquity']),
  T('taxRate', 'wacc', ['세율', '법인세율'], ['tax rate']),
  T('capitalStructure', 'wacc', ['자본구조', '부채비율', '자본 구조'], ['capital structure'], ['equityMarketValue', 'debtMarketValue', 'equityWeight', 'debtWeight', 'debtToEquity']),
  T('marketCap', 'market', ['시가총액', '시총'], ['market cap', 'market capitalization']),
  T('price', 'market', ['주가', '현재가'], ['stock price']),
  T('sharesOutstanding', 'market', ['발행주식수', '발행 주식수', '주식수', '유통주식수'], ['shares outstanding']),
  T('fiftyTwoWeekHigh', 'market', ['52주 최고', '52주 고가'], ['52-week high']),
  T('fiftyTwoWeekLow', 'market', ['52주 최저', '52주 저가'], ['52-week low']),
  T('totalDebt', 'market', ['총부채', '차입금', '이자부담부채'], ['total debt'], ['totalDebt', 'interestBearingDebt']),
  T('netDebt', 'valuation', ['순부채'], ['net debt'], ['netDebt', 'netDebtExLease']),
  T('cash', 'valuation', ['현금성자산', '보유 현금', '현금'], ['cash']),
  T('per', 'peer', ['PER', '주가수익비율'], ['p/e'], ['per']),
  T('pbr', 'peer', ['PBR', '주가순자산비율'], ['p/b'], ['pbr']),
  T('evEbitda', 'peer', ['EV/EBITDA', 'EV / EBITDA'], ['ev/ebitda'], ['evEbitda']),
];

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

const ALIASES = TERMS.flatMap((t) => [...t.ko, ...t.en].map((a) => ({ alias: squash(a), term: t }))).sort((a, b) => b.alias.length - a.alias.length);

/** 문장에 나온 용어(중복 제거). 겹치는 짧은 표현은 긴 표현이 소비한 뒤에는 세지 않는다. */
export function termsIn(text: string): Term[] {
  const s = squash(text);
  const used: boolean[] = new Array(s.length).fill(false);
  const found = new Map<string, Term>();
  for (const { alias, term } of ALIASES) {
    let from = 0;
    for (;;) {
      const i = s.indexOf(alias, from);
      if (i < 0) break;
      if (!used.slice(i, i + alias.length).some(Boolean)) { used.fill(true, i, i + alias.length); found.set(term.key, term); }
      from = i + alias.length;
    }
  }
  return [...found.values()];
}

/** field 이름(camelCase)에 해당하는 한국어 표현. "발행주식수" ↔ sharesOutstanding 처럼 한국어 라벨로 누락 값을 채우는 답변을 잡는 데 쓴다. */
export function koreanAliases(fieldKey: string): string[] {
  return TERMS.filter((t) => t.fields.includes(fieldKey) || t.key === fieldKey).flatMap((t) => t.ko);
}

/** 경로의 마지막 segment 들로 용어를 찾는다 (`metrics.operatingMargin.values[2]` → operatingMargin). */
export function termsForPath(path: string): Term[] {
  const segs = path.split('.').map((s) => s.replace(/\[\d+\]/g, ''));
  for (let i = segs.length - 1; i >= 0; i--) {   // 가장 가까운(마지막) 알려진 field 만 쓴다: wacc.riskFreeRate 는 WACC 가 아니라 무위험수익률이다
    const hit = TERMS.filter((t) => t.fields.includes(segs[i]));
    if (hit.length > 0) return hit;
  }
  return [];
}

export const termByKey = (key: string): Term | undefined => TERMS.find((t) => t.key === key);
