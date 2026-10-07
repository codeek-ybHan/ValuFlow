// AI Tool 카탈로그. 실제 LLM Tool Calling(STEP 08-2)에 그대로 넘길 수 있도록 이름 · 설명 · 입력/출력 JSON Schema 를 코드로 둔다.
// 출력은 AI 가 다시 계산할 필요가 없는 구조화된 값이며, 가능한 한 source / basis / quality / warnings 를 함께 담는다.
// 값이 없으면 null 또는 { status: 'missing', value: null, reason } 로 명시한다.
import type { CapabilityId } from '../capabilities.ts';

export type JsonSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  additionalProperties?: boolean | JsonSchema;
  oneOf?: readonly JsonSchema[];
};

export type ToolName =
  | 'getCompanyOverview' | 'getHistoricalAnalysis' | 'getHistoricalQuality' | 'getMappingTrace' | 'getForecastAssumptions'
  | 'getValuationResult' | 'getSensitivityAnalysis' | 'getScenarioAnalysis' | 'getRelativeValuation';

/** Tool 이 의존하는 context 요소. 없으면 'unavailable' 을 돌려준다. */
export type ToolRequirement = 'none' | 'historical' | 'quality' | 'assumptions' | 'valuation' | 'sensitivity';

export interface AiToolDefinition {
  name: ToolName;
  capability: CapabilityId | 'overview';
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  requires: ToolRequirement;
  /** 지원하지 않는 기업(unsupported)이어도 호출할 수 있는가. 개요만 허용한다. */
  allowedWhenUnsupported: boolean;
}

const NONE: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
const Num: JsonSchema = { type: 'number' };
const NumOrNull: JsonSchema = { oneOf: [{ type: 'number' }, { type: 'null' }] };
const Missing: JsonSchema = { type: 'object', description: '값이 없음. 채워 넣지 않는다.', properties: { status: { enum: ['missing'] }, value: { type: 'null' }, reason: { type: 'string' } }, required: ['status', 'value', 'reason'] };
const Series: JsonSchema = { type: 'array', items: NumOrNull };
const obj = (properties: Record<string, JsonSchema>, required: string[] = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required });

/** 모든 Tool 결과가 공유하는 envelope. data 의 모양은 Tool 별 outputSchema 가 정한다. */
export const TOOL_RESULT_ENVELOPE: JsonSchema = obj({
  status: { enum: ['ok', 'unsupported', 'unavailable', 'invalid-input'] },
  tool: { type: 'string' },
  data: { type: 'object' },
  reason: { type: 'string' },
  sources: { type: 'array', items: obj({ kind: { enum: ['actual', 'assumption', 'calculated'] }, origin: { type: 'string' }, basis: { oneOf: [{ type: 'string' }, { type: 'null' }] }, fetchedAt: { oneOf: [{ type: 'string' }, { type: 'null' }] }, persisted: { oneOf: [{ type: 'boolean' }, { type: 'null' }] }, note: { oneOf: [{ type: 'string' }, { type: 'null' }] } }) },
  warnings: { type: 'array', items: obj({ code: { type: 'string' }, text: { type: 'string' }, level: { enum: ['review', 'note'] } }) },
}, ['status', 'tool', 'sources', 'warnings']);

const METRIC_KEYS = ['revenueGrowth', 'grossMargin', 'operatingMargin', 'netMargin', 'nwc', 'deltaNwc', 'nwcToRevenue', 'cfo', 'capex', 'cfoMinusCapex', 'cash', 'interestBearingDebt', 'leaseLiabilities', 'netDebtExLease', 'depreciation'] as const;
export const HISTORICAL_METRIC_KEYS = METRIC_KEYS;
export const QUALITY_FIELD_KEYS = ['revenue', 'operatingProfit', 'netIncome', 'accountsReceivable', 'inventory', 'accountsPayable', 'cash', 'interestBearingDebt', 'leaseLiabilities', 'cfo', 'ppeAcquisition', 'intangibleAcquisition', 'depreciationAmortization', 'cogs', 'grossProfit', 'sga', 'totalAssets', 'totalLiabilities', 'totalEquity'] as const;

export const TOOL_CATALOG: readonly AiToolDefinition[] = [
  {
    name: 'getCompanyOverview', capability: 'overview', requires: 'none', allowedWhenUnsupported: true,
    description: '현재 분석 대상 기업, 지원 여부, 데이터 출처 구분(Actual / Assumption / Calculated), 어떤 데이터가 준비되어 있는지를 알려 준다. 다른 Tool 을 부르기 전에 먼저 확인한다.',
    inputSchema: NONE,
    outputSchema: obj({
      company: { oneOf: [obj({ name: { type: 'string' }, corpCode: { type: 'string' }, stockCode: { type: 'string' }, basis: { type: 'string' } }, ['name']), { type: 'null' }] },
      support: obj({ status: { enum: ['supported', 'no-data', 'unsupported'] }, code: { type: 'string' }, reason: { type: 'string' }, message: { type: 'string' } }, ['status']),
      dataKinds: obj({ historical: { enum: ['actual', 'fixture', 'none'] }, assumptions: { enum: ['none', 'learning', 'user'] }, results: { enum: ['calculated', 'none'] } }),
      periods: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
      availability: obj({ historical: { type: 'boolean' }, dataQuality: { type: 'boolean' }, assumptionsComplete: { type: 'boolean' }, valuationResult: { type: 'boolean' }, sensitivity: { type: 'boolean' }, relativeInputs: { type: 'boolean' } }),
    }, ['company', 'support', 'dataKinds', 'availability']),
  },
  {
    name: 'getHistoricalAnalysis', capability: 'historical', requires: 'historical', allowedWhenUnsupported: false,
    description: '과거 실적 지표(성장률 · 마진 · NWC · CAPEX · CFO − CAPEX · 순부채 등)와 규칙 기반 추세, 지표별 데이터 품질을 돌려준다. 값이 없는 지표(예: D&A)는 missing 으로 표시한다. 계산은 이미 되어 있으므로 다시 계산하지 않는다.',
    inputSchema: obj({ metrics: { type: 'array', items: { enum: METRIC_KEYS }, description: '조회할 지표. 비우면 전체.' } }, []),
    outputSchema: obj({
      periods: { type: 'array', items: { type: 'string' } },
      unit: { type: 'string', description: 'KRW million (비율 제외)' },
      metrics: { type: 'object', description: '지표 key → { label, unit, values, status, notes, basis?, missing? }' },
      trends: { type: 'object', description: '지표별 { direction, from?, to?, change?, quality }. 기준은 UI 분석용 heuristic.' },
      revenueCagr: NumOrNull,
      capexBasis: { type: 'string' },
      depreciation: { oneOf: [Missing, obj({ status: { enum: ['available'] }, values: Series }, ['status', 'values'])] },
    }, ['periods', 'unit', 'metrics', 'trends', 'revenueCagr', 'capexBasis', 'depreciation']),
  },
  {
    name: 'getHistoricalQuality', capability: 'data-quality', requires: 'quality', allowedWhenUnsupported: false,
    description: '정규화 데이터의 품질: 필드별 상태(available / partial / missing / ambiguous), 검토 필요(review) · 데이터 노트(note), 사용한 기준(연결 / 별도), 수집 출처(provenance).',
    inputSchema: NONE,
    outputSchema: obj({
      basis: { type: 'string' },
      fields: { type: 'array', items: obj({ field: { type: 'string' }, label: { type: 'string' }, status: { enum: ['available', 'partial', 'missing', 'ambiguous'] } }) },
      reviewRequired: { type: 'array', items: { type: 'string' } },
      dataNotes: { type: 'array', items: { type: 'string' } },
      provenance: { type: 'object' },
    }),
  },
  {
    name: 'getMappingTrace', capability: 'data-quality', requires: 'quality', allowedWhenUnsupported: false,
    description: '특정 canonical 계정의 숫자가 어느 공시 계정(이름 · ID)에서 왔는지(Match 방식, 기준, 연도별 값)를 돌려준다. 값이 없으면 missing 과 사유를 돌려준다.',
    inputSchema: obj({ field: { enum: QUALITY_FIELD_KEYS }, fiscalYear: { type: 'integer', description: '비우면 모든 연도' } }, ['field']),
    outputSchema: obj({
      field: { type: 'string' }, label: { type: 'string' }, status: { enum: ['available', 'partial', 'missing', 'ambiguous'] },
      matchType: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      entries: { type: 'array', items: obj({ fiscalYear: { type: 'integer' }, value: Num, unit: { type: 'string', description: 'KRW million' }, valueEok: { type: 'number', description: '억원 환산 값 (직접 환산하지 말고 이 값을 쓴다)' }, sourceAccountName: { type: 'string' }, sourceAccountId: { oneOf: [{ type: 'string' }, { type: 'null' }] }, matchType: { type: 'string' }, rawStatementType: { type: 'string' }, basis: { type: 'string' } }) },
      missing: { oneOf: [Missing, { type: 'null' }] },
    }, ['field', 'label', 'status', 'matchType', 'entries', 'missing']),
  },
  {
    name: 'getForecastAssumptions', capability: 'forecast', requires: 'assumptions', allowedWhenUnsupported: false,
    description: '현재 Forecast · WACC · DCF 가정과 그 출처(사용자 입력 / 학습용), 완성도, 과거 대비 비교(성장률 · 영업이익률). 가정은 Actual 이 아니며 AI 는 값을 바꾸지 않는다.',
    inputSchema: NONE,
    outputSchema: obj({
      basis: { enum: ['none', 'learning', 'user'] }, complete: { type: 'boolean' }, missingInputs: { type: 'object' },
      forecast: { type: 'object' }, wacc: { type: 'object' }, dcf: { type: 'object' }, historicalComparison: { type: 'object' },
    }),
  },
  {
    name: 'getValuationResult', capability: 'valuation', requires: 'valuation', allowedWhenUnsupported: false,
    description: 'DCF 결과(EV · Equity Value · 주당가치 · WACC · g · TV 비중 · Net Debt)와 검토 경고. 엔진이 계산한 값이며 AI 가 다시 계산하지 않는다. 단위: 금액 억원, 주당 원.',
    inputSchema: NONE,
    outputSchema: obj({
      enterpriseValue: Num, equityValue: Num, perShareValue: Num, wacc: Num, terminalGrowth: Num, spread: Num, tvContribution: NumOrNull, netDebt: Num,
      fcff: { type: 'array', items: Num }, units: { type: 'object' }, validationWarnings: { type: 'array', items: { type: 'object' } },
    }),
  },
  {
    name: 'getSensitivityAnalysis', capability: 'sensitivity', requires: 'sensitivity', allowedWhenUnsupported: false,
    description: 'WACC × 영구성장률 민감도: Base 값과 분석 범위를 구분해서, 격자(EV · Equity · 주당가치)와 EV 변동 폭을 돌려준다.',
    inputSchema: NONE,
    outputSchema: obj({ base: { type: 'object' }, range: { type: 'object' }, rows: { type: 'array', items: { type: 'object' } }, enterpriseValueRange: { type: 'object' }, equityValueRange: { type: 'object' }, directionNotes: { type: 'array', items: { type: 'string' } } }),
  },
  {
    name: 'getScenarioAnalysis', capability: 'scenario', requires: 'assumptions', allowedWhenUnsupported: false,
    description: 'Bear / Base / Bull 시나리오: 각 시나리오가 실제로 쓴 가정과 결과, Equity 범위. 한 시나리오가 계산 불가여도 나머지는 유지된다.',
    inputSchema: NONE,
    outputSchema: obj({ columns: { type: 'array', items: { type: 'object' } }, equityRange: { oneOf: [{ type: 'object' }, { type: 'null' }] } }),
  },
  {
    name: 'getRelativeValuation', capability: 'relative', requires: 'valuation', allowedWhenUnsupported: false,
    description: '상대가치(PER / PBR / EV·EBITDA) 결과와 DCF 와의 차이. 멀티플과 이익은 사용자가 입력한 가정이며, 입력이 없으면 incomplete 로 표시한다.',
    inputSchema: NONE,
    outputSchema: obj({ inputs: { type: 'object' }, rows: { type: 'array', items: { type: 'object' } }, equityRange: { oneOf: [{ type: 'object' }, { type: 'null' }] }, maxDivergence: NumOrNull, disclaimer: { type: 'string' } }),
  },
];

export const TOOL_NAMES: readonly ToolName[] = TOOL_CATALOG.map((t) => t.name);
export const getToolDefinition = (name: string): AiToolDefinition | undefined => TOOL_CATALOG.find((t) => t.name === name);
