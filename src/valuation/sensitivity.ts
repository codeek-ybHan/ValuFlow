// Sensitivity: WACC × Terminal Growth → EV / Equity Value / 주당가치.
//
// 원칙
//   - Forecast(FCFF) 는 base 입력으로 한 번만 계산하고 고정한다.
//   - 각 칸은 dcf.ts 의 runDcf(fcff, wacc, g) 로 계산한다. 같은 Scenario WACC 가
//     FCFF 할인, Terminal Value 공식, PV(TV) 에 모두 적용되며 base WACC 는 섞이지 않는다.
//   - Equity Value / 주당가치도 기존 dcf.ts 함수를 재사용한다 (계산식 중복 없음).
import { validateInput } from './engine.ts';
import { runForecast } from './forecast.ts';
import { calculateEquityValue, calculateNetDebt, calculatePerShareValue, runDcf } from './dcf.ts';
import { calculateWacc } from './wacc.ts';
import type { ValuationInput } from './models.ts';
import { ValuationError } from './models.ts';

export interface SensitivityCell {
  wacc: number;
  terminalGrowth: number;
  /** 억원 */
  enterpriseValue: number;
  /** 억원 */
  equityValue: number;
  /** 원 */
  perShareValue: number;
  /** 입력의 base WACC / base g 와 같은 칸 */
  isBaseCase: boolean;
}

export interface SensitivityResult {
  waccValues: number[];
  terminalGrowthValues: number[];
  /** cells[i][j] = waccValues[i] × terminalGrowthValues[j] */
  cells: SensitivityCell[][];
  /** 입력에서 계산한 base 값 (축에 포함되지 않을 수도 있다) */
  baseWacc: number;
  baseTerminalGrowth: number;
}

const BASE_TOLERANCE = 1e-9;

function assertAxis(name: string, values: number[]): void {
  if (!Array.isArray(values) || values.length === 0) throw new ValuationError(`${name}: 1개 이상의 값이 필요합니다.`);
  values.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new ValuationError(`${name}[${i}]: 숫자가 아닙니다.`);
  });
}

export function runSensitivity(input: ValuationInput, waccValues: number[], terminalGrowthValues: number[]): SensitivityResult {
  validateInput(input);
  assertAxis('waccValues', waccValues);
  assertAxis('terminalGrowthValues', terminalGrowthValues);

  // Gordon Growth 가 불가능한 조합이 하나라도 있으면 계산 전에 어떤 조합인지 알려 준다.
  for (const w of waccValues) {
    for (const g of terminalGrowthValues) {
      if (w <= g) {
        throw new ValuationError(`WACC ${(w * 100).toFixed(3)}% × g ${(g * 100).toFixed(3)}%: WACC 가 영구성장률 이하이면 Terminal Value 를 계산할 수 없습니다.`);
      }
    }
  }

  const { fcff } = runForecast(input);
  const netDebt = calculateNetDebt(input.interestBearingDebt, input.cash);
  const baseWacc = calculateWacc(input).wacc;
  const baseTerminalGrowth = input.terminalGrowth;

  const cells = waccValues.map((wacc) =>
    terminalGrowthValues.map((terminalGrowth): SensitivityCell => {
      const { enterpriseValue } = runDcf(fcff, wacc, terminalGrowth);
      const equityValue = calculateEquityValue(enterpriseValue, netDebt);
      const perShareValue = calculatePerShareValue(equityValue, input.sharesOutstanding);
      if (![enterpriseValue, equityValue, perShareValue].every(Number.isFinite)) {
        throw new ValuationError(`WACC ${wacc} × g ${terminalGrowth}: 계산 결과가 유한한 숫자가 아닙니다.`);
      }
      return {
        wacc,
        terminalGrowth,
        enterpriseValue,
        equityValue,
        perShareValue,
        isBaseCase: Math.abs(wacc - baseWacc) < BASE_TOLERANCE && Math.abs(terminalGrowth - baseTerminalGrowth) < BASE_TOLERANCE,
      };
    }),
  );

  return { waccValues: [...waccValues], terminalGrowthValues: [...terminalGrowthValues], cells, baseWacc, baseTerminalGrowth };
}
