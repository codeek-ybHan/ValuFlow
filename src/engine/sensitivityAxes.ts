// Sensitivity 기본 축(WACC × Terminal Growth) 생성. Base 값을 중심으로 만들어 Base 칸이 항상 격자에 들어오게 한다.
//
// 규칙: 0.5%p 단위의 "깔끔한" 값 중 Base 에 가장 가까운 4개 + Base 자신 = 5개.
//   Base WACC 8.1375% → 7.5 / 8.0 / 8.1375 / 8.5 / 9.0     Base g 2% → 1.0 / 1.5 / 2.0 / 2.5 / 3.0
//   Base WACC 8.2155% → 7.5 / 8.0 / 8.2155 / 8.5 / 9.0     Base g 2.5% → 1.5 / 2.0 / 2.5 / 3.0 / 3.5
// 모든 조합에서 WACC > g 가 되도록, 필요하면 Base 에서 먼 쪽 값부터 덜어낸다 (Base 는 항상 남는다).

const STEP = 0.005;
const tidy = (x: number) => Number(x.toFixed(6));
const EPS = 1e-9;

export interface SensitivityAxes {
  waccValues: number[];
  terminalGrowthValues: number[];
}

/** base 주변의 0.5%p 단위 값 중 가까운 `count` 개 (base 자신은 제외). 거리가 같으면 낮은 값 먼저. */
function nearestRoundValues(base: number, count: number): number[] {
  const k0 = Math.round(base / STEP);
  const candidates: number[] = [];
  for (let k = k0 - count - 1; k <= k0 + count + 1; k++) candidates.push(tidy(k * STEP));
  return candidates
    .filter((v) => Math.abs(v - base) > EPS)
    .sort((a, b) => Math.abs(a - base) - Math.abs(b - base) || a - b)
    .slice(0, count);
}

const axisAround = (base: number): number[] => [...nearestRoundValues(base, 4), base].sort((a, b) => a - b);

export function buildSensitivityAxes(baseWacc: number, baseTerminalGrowth: number): SensitivityAxes {
  // Base 자체가 계산 불가(WACC ≤ g)이면 격자를 만들 수 없다. 엔진이 같은 이유로 오류를 내도록 Base 한 칸만 돌려준다.
  if (!(baseWacc > baseTerminalGrowth)) return { waccValues: [baseWacc], terminalGrowthValues: [baseTerminalGrowth] };

  let waccValues = axisAround(baseWacc);
  let terminalGrowthValues = axisAround(baseTerminalGrowth);
  // 모든 (WACC, g) 조합에서 WACC > g: 가장 불리한 쪽(최대 g, 최소 WACC)이 겹치면 Base 에서 먼 값을 덜어낸다.
  for (;;) {
    const minWacc = Math.min(...waccValues);
    const maxG = Math.max(...terminalGrowthValues);
    if (minWacc > maxG + EPS) break;
    if (maxG > baseTerminalGrowth + EPS) terminalGrowthValues = terminalGrowthValues.filter((g) => g !== maxG);
    else waccValues = waccValues.filter((w) => w !== minWacc);
  }
  return { waccValues, terminalGrowthValues };
}
