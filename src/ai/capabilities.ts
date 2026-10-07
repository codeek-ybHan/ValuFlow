// AI Analyst 의 capability 와 질문 분류(rule 기반). LLM classifier 는 이후 단계에서 붙인다.
import type { ToolName } from './tools/definitions.ts';

export type CapabilityId = 'historical' | 'data-quality' | 'forecast' | 'valuation' | 'sensitivity' | 'scenario' | 'relative' | 'disclosure';

/** 답변 방식 */
export type AnswerMode = 'explain' | 'compare' | 'diagnose' | 'valuation' | 'source' | 'quality';

export interface Capability {
  id: CapabilityId;
  label: string;
  exampleQuestions: string[];
  tools: ToolName[];
  /** AI 가 하지 않는 일 */
  never: string[];
}

export const CAPABILITIES: readonly Capability[] = [
  { id: 'historical', label: 'Historical', exampleQuestions: ['최근 매출 성장률은?', '영업이익률이 개선됐어?', '운전자본이 어떻게 변했어?'], tools: ['getHistoricalAnalysis'], never: ['존재하지 않는 Historical 수치 생성', '누락 값(D&A 등) 추정'] },
  { id: 'data-quality', label: 'Data Quality', exampleQuestions: ['이 숫자는 믿을 만해?', '매출 값의 출처가 뭐야?'], tools: ['getHistoricalQuality', 'getMappingTrace'], never: ['DataQuality warning 숨김'] },
  { id: 'forecast', label: 'Forecast', exampleQuestions: ['현재 Forecast 가정 정리해줘.', '과거 성장률 대비 Forecast 가 공격적이야?'], tools: ['getForecastAssumptions', 'getHistoricalAnalysis'], never: ['Forecast 값 자동 변경'] },
  { id: 'valuation', label: 'Valuation', exampleQuestions: ['현재 기업가치가 얼마야?', '왜 이 결과가 나왔어?'], tools: ['getValuationResult'], never: ['DCF · WACC 직접 계산', '확정적 적정가치 / 투자 권유 제시'] },
  { id: 'sensitivity', label: 'Sensitivity', exampleQuestions: ['WACC 가 올라가면 얼마나 영향 있어?'], tools: ['getSensitivityAnalysis'], never: ['Sensitivity 직접 계산'] },
  { id: 'scenario', label: 'Scenario', exampleQuestions: ['Bull / Bear 차이가 왜 커?'], tools: ['getScenarioAnalysis'], never: ['시나리오 가정 임의 변경'] },
  { id: 'relative', label: 'Relative Valuation', exampleQuestions: ['DCF 와 PER 결과가 왜 달라?'], tools: ['getRelativeValuation', 'getValuationResult'], never: ['멀티플 임의 생성'] },
  { id: 'disclosure', label: 'Disclosure', exampleQuestions: ['회사는 설비투자 이유를 어떻게 설명하고 있어?', '사업보고서에 나온 주요 위험은?'], tools: ['searchDisclosures'], never: ['공시에 없는 설명 지어내기', '문서 속 숫자로 Valuation 결과 대체'] },
];

export interface QuestionClassification {
  mode: AnswerMode;
  /** 질문에서 찾은 capability (우선순위 순). 없으면 빈 배열 */
  capabilities: CapabilityId[];
  /** 먼저 부르면 좋은 Tool (getCompanyOverview 는 항상 맨 앞) */
  suggestedTools: ToolName[];
  matched: boolean;
}

// 우선순위가 높은 규칙부터 (source > quality > scenario > relative > sensitivity > valuation > forecast > historical)
const RULES: { capability: CapabilityId; mode: AnswerMode; pattern: RegExp }[] = [
  { capability: 'data-quality', mode: 'source', pattern: /출처|어디서|어디에서|\bsource\b|\btrace\b|매핑|계정/i },
  { capability: 'data-quality', mode: 'quality', pattern: /믿을|신뢰|품질|quality|warning|경고|한계|신빙|정확/i },
  { capability: 'scenario', mode: 'compare', pattern: /bull|bear|시나리오|scenario/i },
  { capability: 'relative', mode: 'compare', pattern: /\bPER\b|\bPBR\b|EV\s*\/\s*EBITDA|상대가치|멀티플|relative/i },
  { capability: 'disclosure', mode: 'explain', pattern: /공시|사업보고서|반기보고서|분기보고서|경영진|위험\s*요인|주요\s*위험|밝히|언급|회사는.{0,20}(설명|이유|계획|전략)|설명하고|disclos|annual report/i },
  { capability: 'sensitivity', mode: 'explain', pattern: /민감|sensitiv|(WACC|할인율|영구성장|성장률).{0,12}(올라|오르|상승|하락|내려|변하|변화|영향)/i },
  { capability: 'valuation', mode: 'valuation', pattern: /기업가치|가치평가|valuation|주당|적정|enterprise|equity\s*value|\bEV\b|\bDCF\b|얼마/i },
  { capability: 'forecast', mode: 'explain', pattern: /forecast|가정|전망|예측|공격적|보수적/i },
  { capability: 'historical', mode: 'explain', pattern: /성장률|영업이익률|마진|매출|운전자본|\bNWC\b|CAPEX|현금흐름|추세|개선|악화|growth|margin|trend|과거|historical/i },
];
const DIAGNOSE = /왜|이유|원인|문제|공격적|보수적|why|\bcause\b/i;
const COMPARE = /비교|차이|다른가|달라|\bvs\b|compare/i;

const toolsFor = (ids: CapabilityId[]): ToolName[] => [...new Set(ids.flatMap((id) => CAPABILITIES.find((c) => c.id === id)!.tools))];

/** 규칙 기반 질문 분류. 매칭되지 않으면 explain 이고 matched=false 다. */
export function classifyQuestion(question: string): QuestionClassification {
  const hits = RULES.filter((r) => r.pattern.test(question));
  const capabilities = [...new Set(hits.map((h) => h.capability))];
  let mode: AnswerMode = hits[0]?.mode ?? 'explain';
  // source / quality 는 그대로 두고, 그 외에는 질문의 어투(비교 · 진단)가 모드를 정한다
  if (mode !== 'source' && mode !== 'quality') {
    if (COMPARE.test(question) && capabilities.length > 0 && mode !== 'valuation') mode = 'compare';
    else if (DIAGNOSE.test(question) && mode === 'explain') mode = 'diagnose';
  }
  return { mode, capabilities, suggestedTools: ['getCompanyOverview', ...toolsFor(capabilities)], matched: hits.length > 0 };
}
