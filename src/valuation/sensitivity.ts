// Sensitivity: WACC × Terminal Growth → Enterprise Value 매트릭스. [05-2 구현 예정]
// 중요: 시나리오 WACC 를 바꾸면 FCFF 할인, TV 공식, PV(TV) 모두 그 WACC 를 사용해야 한다.
import type { ValuationInput } from './models.ts';
import { notImplemented } from './models.ts';

export interface SensitivityMatrix {
  waccs: number[];
  terminalGrowths: number[];
  /** enterpriseValue[i][j] = waccs[i], terminalGrowths[j] 일 때의 EV (억원) */
  enterpriseValue: number[][];
}

export function runSensitivity(_input: ValuationInput, _waccs: number[], _terminalGrowths: number[]): SensitivityMatrix {
  return notImplemented('runSensitivity');
}
