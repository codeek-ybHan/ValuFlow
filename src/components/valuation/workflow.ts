// Valuation Workflow 정의. Stepper 와 단계 이동 링크가 이 설정을 읽는다. 계산식은 여기에 두지 않는다.
// 계산은 valuation 공개 API(runValuation / runSensitivity)가 하고, 각 단계 컴포넌트가 입력과 결과를 보여 준다.

import { SOURCE_LABELS } from '../../engine/waccForm.ts';

export type StageId = 'historical' | 'forecast' | 'wacc' | 'dcf' | 'result' | 'validation';

export interface WorkflowStage {
  id: StageId;
  no: number;
  label: string;
  summary: string;
}

export const DEFAULT_STAGE: StageId = 'historical';

export const stages: WorkflowStage[] = [
  {
    id: 'historical', no: 1, label: 'Historical',
    summary: '공시 기반 과거 재무데이터를 확인하고 Forecast 의 기준으로 삼습니다.',
  },
  {
    id: 'forecast', no: 2, label: 'Forecast',
    summary: '미래 가정을 입력하고 FCFF 를 추정합니다.',
  },
  {
    id: 'wacc', no: 3, label: 'WACC',
    summary: 'CAPM 으로 자기자본비용을, 자본구조로 WACC 를 산출합니다.',
  },
  {
    id: 'dcf', no: 4, label: 'DCF',
    summary: 'FCFF 를 할인하고 Terminal Value 를 더해 Enterprise Value 를 구합니다.',
  },
  {
    id: 'result', no: 5, label: 'Result',
    summary: 'Net Debt 를 차감해 Equity Value 와 주당 가치를 확인합니다.',
  },
  {
    id: 'validation', no: 6, label: 'Validation',
    summary: '민감도 · 시나리오 · 상대가치로 DCF 결과가 합리적인지 검토합니다. 하나의 숫자가 아니라 범위와 차이를 봅니다.',
  },
];

export const stageIndex = (id: string | undefined) => stages.findIndex((s) => s.id === id);

/**
 * 단계별 입력의 출처(basis). 이후 Source / Date / Note 로 확장할 수 있다.
 *  Historical : 공시 기반 실적(Actual)        Forecast : 애널리스트 가정
 *  WACC / DCF / Validation(상대가치) : 사용자 가정(Assumption)
 */
export const STAGE_BASIS: Record<StageId, string> = {
  historical: 'Actual · 공시 기반',
  forecast: SOURCE_LABELS.analyst,
  wacc: SOURCE_LABELS.assumption,
  dcf: SOURCE_LABELS.assumption,
  result: '엔진 계산 결과',
  validation: `${SOURCE_LABELS.assumption} (상대가치 입력) · 엔진 계산`,
};
