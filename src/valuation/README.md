# Valuation Engine v1

재무 입력으로 Forecast → WACC → DCF → Equity Value 와 WACC × g 민감도를 계산하는 **결정적(deterministic) 계산 엔진**입니다.
UI 와 LLM 은 숫자를 직접 계산하지 않고 이 엔진의 결과를 읽기만 합니다.

## 사용

외부에서는 `valuation/index.ts` 만 import 합니다. 내부 파일(`forecast.ts`, `wacc.ts`, `dcf.ts` …)은 직접 import 하지 않습니다.

```ts
import { runValuation, runSensitivity, ValuationError } from '../valuation';
import type { ValuationInput, ValuationResult, SensitivityResult } from '../valuation';

const result: ValuationResult = runValuation(input);
result.wacc;            // 0.081375   (8.1375%)
result.enterpriseValue; // 2345.563…  (억원)
result.perShareValue;   // 214556.3…  (원)

const sensitivity: SensitivityResult = runSensitivity(
  input,
  [0.075, 0.08, 0.081375, 0.085, 0.09], // WACC
  [0.01, 0.015, 0.02, 0.025, 0.03],     // Terminal Growth
);
sensitivity.cells[i][j].enterpriseValue; // waccValues[i] × terminalGrowthValues[j]
sensitivity.cells.flat().find((c) => c.isBaseCase); // Base Case 칸
```

WACC 입력 화면의 Live Preview 처럼 Valuation 결과 없이 WACC 구성요소만 필요할 때는 공개된 WACC 함수를 씁니다
(`calculateWacc`, `calculateCostOfEquity`, `calculateAfterTaxCostOfDebt`, `calculateCapitalWeights`, 타입 `WaccInput` / `WaccResult`).
계산식을 UI 에서 다시 구현하지 않습니다.

```ts
import { calculateWacc } from '../valuation';
const { wacc, costOfEquity } = calculateWacc({ riskFreeRate: 0.03, beta: 1.1, marketRiskPremium: 0.06, preTaxCostOfDebt: 0.05, taxRate: 0.25, equityMarketValue: 900, debtMarketValue: 300 });
```

잘못된 입력은 `ValuationError` 를 던집니다 (임의의 값으로 대체하지 않음).

```ts
try { runValuation(input); } catch (e) { if (e instanceof ValuationError) show(e.message); else throw e; }
```

## 입력 / 결과 규칙

| 항목 | 규칙 |
|---|---|
| 비율 (Percentage) | 소수. 8% = `0.08`, 25% = `0.25` |
| 금액 | 기본 단위 **억원** (Revenue, EBIT, FCFF, EV, Net Debt, Equity Value …) |
| `sharesOutstanding` | 실제 주식 수(주) |
| `perShareValue` | **원**. `Equity Value(억원) × 100,000,000 ÷ 주식 수` |
| 연도 배열 | Y1, Y2, … 순서. `revenueGrowth`, `operatingMargin`, `depreciation`, `capex`, `deltaNwc` 의 길이가 같아야 함 |
| D&A / CAPEX / ΔNWC | 양수로 입력. FCFF 계산에서 부호를 한 번만 적용 (`+D&A −CAPEX −ΔNWC`) |
| 반올림 | **엔진 내부에서는 하지 않음.** 표시용 포맷은 UI(`fmtNum`, `fmtPct`)에서만 |
| WACC ≤ g | Gordon Growth 가 성립하지 않으므로 **오류** (`runValuation`, `runSensitivity` 모두) |
| 할인 시점 | 연도 말(end-of-year). Terminal Value 는 마지막 해 FCFF × (1+g) ÷ (WACC − g) |

## 구조

```text
valuation/
├── models.ts       ValuationInput / ValuationResult / ValuationError, 단위 규칙
├── validate.ts     공통 입력 검증 (유한한 숫자, 예측 기간 배열, 세율)
├── forecast.ts     매출 → EBIT → NOPAT → FCFF   (runForecast)
├── wacc.ts         CAPM, 세후 Kd, 자본구조 가중치, WACC
├── dcf.ts          할인, Terminal Value, EV, Net Debt, Equity Value, 주당가치   (runDcf)
├── sensitivity.ts  WACC × g → EV / Equity / 주당가치   (runSensitivity)
├── engine.ts       입력 검증 + 전체 흐름 조립   (runValuation)
└── index.ts        공개 API
```

```text
runValuation:   ValuationInput → validateInput → runForecast → calculateWacc → runDcf → Equity → ValuationResult
runSensitivity: ValuationInput → validateInput → runForecast(FCFF 1회) → (WACC × g) 칸마다 runDcf → Equity → SensitivityResult
```

Sensitivity 의 Scenario WACC 는 FCFF 할인, Terminal Value, PV(TV) 에 모두 적용되며 base WACC 는 섞이지 않습니다.

## 테스트

```bash
npm test
```

`valuation.integration.test.ts` 가 STEP 04 종합실습 기준값(WACC 8.1375%, FCFF 135.10 / 144.31 / 150.52, EV 2345.56,
Equity Value 2145.56, 주당 214,556원, Bear 1829.01 / Bull 3144.95)과 `runValuation` ↔ `runSensitivity` Base Case 일치를 공개 API 로 검증합니다.
