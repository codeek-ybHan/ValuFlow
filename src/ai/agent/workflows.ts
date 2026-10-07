// Workflow 정의(템플릿). 각 workflow 는 "이 업무에서 보통 쓰는 Tool 의 순서"일 뿐이며 모든 Tool 을 무조건 호출하지 않는다:
// optional 단계는 질문 · 관찰에 따라 생략되고, 관찰에 따라 계획에 없던 Tool 이 추가될 수도 있다 (한도 안에서).
// 이 목록은 backend 로 내보내져(export-ai) gateway 가 workflow 요청을 검증하는 데 쓴다.
import type { CapabilityId } from '../capabilities.ts';
import type { ToolName } from '../tools/definitions.ts';
import type { WorkflowType } from './types.ts';

export interface WorkflowTemplateStep { id: string; capability: CapabilityId; tool: ToolName; purpose: string; optional: boolean }
export interface WorkflowTemplate {
  type: WorkflowType;
  label: string;
  /** 질문이 이 workflow 인지 판단하는 규칙 (우선순위가 높은 순으로 평가) */
  pattern: RegExp;
  steps: WorkflowTemplateStep[];
}

const S = (id: string, capability: CapabilityId, tool: ToolName, purpose: string, optional = false): WorkflowTemplateStep => ({ id, capability, tool, purpose, optional });

export const WORKFLOWS: readonly WorkflowTemplate[] = [
  {
    type: 'full-valuation-review', label: 'Full Valuation Review',
    pattern: /(valuation|밸류에이션|가치평가|기업가치).{0,12}(전체|전반|종합|총체)|(전체|전반|종합).{0,12}(valuation|밸류에이션|가치평가|검토)|full\s*(valuation\s*)?review/i,
    steps: [
      S('company', 'historical', 'getCompanyOverview', '기업 · 데이터 준비 상태 확인'),
      S('quality', 'data-quality', 'getHistoricalQuality', 'Historical 데이터 품질 확인'),
      S('historical', 'historical', 'getHistoricalAnalysis', '과거 실적 추세 확인'),
      S('forecast', 'forecast', 'getForecastAssumptions', 'Forecast 가정 확인'),
      S('wacc-market', 'market-assumptions', 'getMarketAssumptions', 'WACC 가정과 시장 관찰값 비교'),
      S('valuation', 'valuation', 'getValuationResult', 'DCF 결과 확인'),
      S('sensitivity', 'sensitivity', 'getSensitivityAnalysis', '민감도 확인'),
      S('scenario', 'scenario', 'getScenarioAnalysis', 'Bull / Bear 시나리오 확인', true),
      S('relative', 'relative', 'getRelativeValuation', '상대가치 입력 확인', true),
      S('peers', 'comparables', 'getComparableCompanies', 'Peer 후보 확인', true),
      S('disclosure', 'disclosure', 'searchDisclosures', '공시에서 주요 변화 · 위험의 근거 확인', true),
      S('news', 'news', 'searchCompanyNews', '최근 이벤트 확인', true),
    ],
  },
  {
    type: 'wacc-review', label: 'WACC Review',
    pattern: /(WACC|할인율|무위험|국고채|베타|\bbeta\b|위험\s*프리미엄|자본\s*비용).{0,25}(적절|검토|점검|타당|합리|괜찮|높|낮|맞|비교|근거)|(검토|점검|적절).{0,15}(WACC|할인율|베타)/i,
    steps: [
      S('current-assumption', 'forecast', 'getForecastAssumptions', '현재 ValuFlow 의 WACC 가정 확인'),
      S('valuation', 'valuation', 'getValuationResult', '현재 가정이 만든 DCF 결과 확인'),
      S('market-reference', 'market-assumptions', 'getMarketAssumptions', '시장에서 관찰되는 무위험수익률 · 베타 확인'),
      S('peers', 'comparables', 'getComparableCompanies', '비교기업 후보로 베타 · 위험 수준 맥락 확인', true),
    ],
  },
  {
    type: 'comparable-review', label: 'Comparable Valuation Review',
    pattern: /(peer|피어|비교\s*기업|동종|경쟁사|comparable|상대\s*가치|멀티플|\bPER\b|\bPBR\b)/i,
    steps: [
      S('valuation', 'valuation', 'getValuationResult', 'DCF 결과 확인'),
      S('peers', 'comparables', 'getComparableCompanies', 'Peer 후보와 배수 확인'),
      S('relative', 'relative', 'getRelativeValuation', '현재 상대가치 입력 · 결과 확인'),
      S('historical', 'historical', 'getHistoricalAnalysis', '차이를 설명할 과거 실적 맥락', true),
    ],
  },
  {
    type: 'event-review', label: 'Risk / News Review',
    pattern: /(뉴스|기사|이벤트|사건|\bnews\b|최근\s*(소식|이슈|동향)).{0,30}(valuation|밸류에이션|가치|위험|리스크|risk|영향)|(valuation|밸류에이션|가치|위험|리스크|risk).{0,30}(뉴스|기사|이벤트|사건|최근)|valuation\s*risk|밸류에이션\s*(위험|리스크)|시장\s*상황.{0,30}(위험|리스크|risk)/i,
    steps: [
      S('news', 'news', 'searchCompanyNews', '최근 기업 뉴스 · 이벤트 확인'),
      S('disclosure', 'disclosure', 'searchDisclosures', '이벤트의 공시 근거 확인', true),
      S('valuation', 'valuation', 'getValuationResult', '현재 DCF 결과와 비교할 맥락'),
      S('forecast', 'forecast', 'getForecastAssumptions', '현재 Forecast 가정 맥락', true),
      S('historical', 'historical', 'getHistoricalAnalysis', '최근 실적 맥락', true),
      S('market', 'market', 'getMarketData', '현재 시장 상황 (시가총액 · 주가)', true),
    ],
  },
  {
    type: 'disclosure-review', label: 'Disclosure Review',
    pattern: /공시|사업보고서|반기보고서|분기보고서|(회사|경영진).{0,12}(설명|밝혔|밝히|언급|발표)|(이유|배경|계획).{0,10}(설명했|밝혔|언급)/i,
    steps: [
      S('disclosure', 'disclosure', 'searchDisclosures', '공시에서 회사의 설명과 근거 확인'),
      S('historical', 'historical', 'getHistoricalAnalysis', '설명과 비교할 실제 수치 확인', true),
      S('knowledge', 'disclosure', 'searchKnowledge', '업로드 문서를 함께 확인', true),
    ],
  },
  {
    type: 'dcf-review', label: 'DCF Review',
    pattern: /\bDCF\b|현금흐름\s*할인|기업가치.{0,10}(검토|산출|가정)|(검토|점검).{0,10}기업가치/i,
    steps: [
      S('valuation', 'valuation', 'getValuationResult', 'DCF 결과 확인'),
      S('forecast', 'forecast', 'getForecastAssumptions', '결과를 만든 Forecast 가정 확인', true),
      S('sensitivity', 'sensitivity', 'getSensitivityAnalysis', '핵심 민감도 확인'),
      S('scenario', 'scenario', 'getScenarioAnalysis', '시나리오 차이 확인', true),
    ],
  },
  {
    type: 'sensitivity-scenario-review', label: 'Sensitivity / Scenario Review',
    pattern: /민감|시나리오|sensitiv|scenario|\bbull\b|\bbear\b/i,
    steps: [
      S('valuation', 'valuation', 'getValuationResult', '기준 DCF 결과 확인'),
      S('sensitivity', 'sensitivity', 'getSensitivityAnalysis', 'WACC · 영구성장률 민감도 확인'),
      S('scenario', 'scenario', 'getScenarioAnalysis', 'Bull / Bear 시나리오 확인'),
    ],
  },
  {
    type: 'forecast-review', label: 'Forecast Review',
    pattern: /forecast|가정.{0,10}(과도|공격|보수|적절|검토|점검)|(과도|공격|보수).{0,10}(가정|forecast)|전망.{0,10}(과도|공격|보수|검토)/i,
    steps: [
      S('forecast', 'forecast', 'getForecastAssumptions', '현재 Forecast 가정과 과거 대비 차이 확인'),
      S('historical', 'historical', 'getHistoricalAnalysis', '비교 기준이 되는 과거 실적 확인'),
      S('knowledge', 'disclosure', 'searchKnowledge', '가정과 관련된 회사 · 산업 근거 확인', true),
    ],
  },
  {
    type: 'historical-review', label: 'Historical Performance Review',
    pattern: /(최근|과거|historical).{0,10}(실적|성과|재무|performance)|실적.{0,10}(분석|검토|정리)|(분석|검토).{0,10}실적|(영업이익률|매출|성장률|마진|수익성|운전자본|CAPEX).{0,12}(분석|검토|정리)/i,
    steps: [
      S('historical', 'historical', 'getHistoricalAnalysis', '매출 성장 · 영업이익률 · NWC · CAPEX · CFO 추세 확인'),
      S('quality', 'data-quality', 'getHistoricalQuality', '데이터 품질 · 신뢰도 확인'),
      S('disclosure', 'disclosure', 'searchDisclosures', '주요 변화의 원인에 대한 회사 설명 확인', true),
    ],
  },
];

export const WORKFLOW_BY_TYPE: Readonly<Record<WorkflowType, WorkflowTemplate>> = Object.fromEntries(WORKFLOWS.map((w) => [w.type, w])) as Record<WorkflowType, WorkflowTemplate>;
