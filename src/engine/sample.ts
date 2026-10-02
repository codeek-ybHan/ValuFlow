import type { ForecastAssumptions } from './dcf';

/** STEP 03 Practice 가상기업. content/step03.ts 의 가정 표와 반드시 일치해야 한다. */
export const sampleCompany = {
  assumptions: {
    baseRevenue: 1000,
    growth: [0.1, 0.1, 0.1],
    operatingMargin: [0.15, 0.15, 0.15],
    taxRate: 0.25,
    daPctRevenue: 0.04,
    capexPctRevenue: 0.05,
    nwcPctOfRevenueChange: 0.1,
  } satisfies ForecastAssumptions,
  wacc: 0.1,
  g: 0.02,
};
