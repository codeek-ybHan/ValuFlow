# STEP 09-1 Report Architecture & Data Contract

원칙: **LLM 이 Report 에서 숫자를 새로 계산하지 않는다.** Report 는 이미 있는 결과(Historical · 가정 · Valuation · Sensitivity · Scenario · 상대가치 · Grounded Claim · Evidence)를 조립한다.

## 1. 구조

```
Project State ──buildReportInput──▶ ReportInput (snapshot) ──buildReport──▶ ReportModel ──▶ Renderer / Export (STEP 09-2)
 (UI state)      (유일하게 읽는 곳)     deep copy · 불변           검증 · 조립만                  schemaVersion 1.0
```

```
src/report/
  types.ts        Cell · SourceRef · DataKind · CellState · Narrative (기본 계약)
  input.ts        ReportInput · buildReportInput(Project 를 읽는 유일한 곳) · aiAnalysisFromWorkflow
  model.ts        ReportModel 과 section 별 독립 타입
  buildReport.ts  ReportInput → ReportModel (엔진 계산 함수를 호출하지 않는다)
  units.ts        전역 단위 정책 + Cell 생성 (STEP 08-6 display helper 재사용)
  sources.ts      Source 정책 · SourceRegistry
  hash.ts         snapshot 식별용 해시
  sections/       historical · dcfModel(forecast · wacc · dcf) · analysis(sensitivity · scenario · relative · range) · narrative
  validation/     validateReportInput
  export/         snapshot 직렬화 · 복원 (schemaVersion 확인). Renderer 는 STEP 09-2
```

Report 코드는 UI state(`useProject` 등)를 읽지 않는다. `buildReport` · `sections/` 는 `runValuation` · `calculateWacc` · `analyzeHistorical` 같은 계산 함수를 호출하지 않으며 정적 검사 테스트가 이를 지킨다.

## 2. ReportInput

`company · support · historical · historicalAnalysis · dataQuality · provenance · assumptions · valuationResult · sensitivity · scenario · relativeValuation · valuationRange · reviewMetrics · reviewWarnings · aiAnalysis? · snapshot`.

- Historical 지표 · WACC · DCF 결과는 **Project State 에 이미 있는 값**을 옮긴다. 결과가 없으면 비워 두고 만들지 않는다(`runValuation` 을 호출하지 않는다).
- Sensitivity · Scenario · 상대가치 view 는 Validation 화면 · AI Tool 과 같은 `buildValidationView` 결과를 수집한다. Project State 에 저장되지 않는 엔진 산출물을 모으는 일이며 `buildReportInput` 에서 한 번만 일어난다.
- `aiAnalysis` 는 STEP 08 Deep Analysis 의 **검증된 결과**(claims · evidence · sources · limitations · `contextSnapshotId`)다. `aiAnalysisFromWorkflow(answer, meta)` 로 `WorkflowAnswer` 에서 만든다.

## 3. ReportModel

`metadata · executiveSummary · companyOverview · historicalPerformance · forecast · wacc · dcf · sensitivity · scenario · relativeValuation · keyRisks · conclusion · sources · appendix` (+ `schemaVersion`). section 마다 독립 타입이고, 선택 section(Sensitivity · Scenario · 상대가치)은 `SectionState`(`ok | unavailable | missing | not-applicable` + 이유)다. Valuation Range 는 low / base / high 와 방법별 범위만 담고 평균 · 중앙값을 만들지 않는다.

## 4. Actual / Estimate / Calculated

모든 숫자는 `Cell.kind` 를 가진다.

| kind | 의미 | 예 |
|---|---|---|
| actual | 공시 확정값 | 2025A Revenue · CFO · Cash |
| estimate | 가정 · 예측 (Actual 이 아니다) | 2026E 가정, 투영 Revenue · EBIT, Risk-free · Beta 입력 |
| calculated | 엔진이 계산한 결과 | EV · WACC · Equity Value · FCFF · 영업이익률 등 파생 지표 |

기간 라벨은 `2023A, 2024A, 2025A` / `2026E …` 로 구분하고, Forecast · WACC · DCF section 에는 actual Cell 이 없다(테스트). Forecast 에는 "Forecast(E)는 Actual(A)이 아닙니다" 고지가 붙는다.

## 5. Unit Policy (`REPORT_UNIT_POLICY`)

| 항목 | 단위 |
|---|---|
| 재무제표 · 가치 금액 | 억원 (Historical 원본 KRW million → 억원, display helper) |
| 대형 금액 | 1조원 이상은 조원을 보조 표기(`largeText`) |
| 주당 | 원 |
| 비율 | % 로 표시(원본은 소수) |
| 주식 수 | 주 |
| 베타 · 할인계수 | 단위 없음(factor) |

Renderer 는 `Cell.text` 를 그대로 쓰고 단위를 추정하지 않는다. 환산은 `ai/tools/display.ts`(STEP 08-6)만 쓰며 Report 에 환산 로직을 따로 두지 않는다. 원본 `value` 는 반올림하지 않는다. Historical 의 통화 · 단위가 정책(KRW · million)과 다르면 검증 error 다.

## 6. Source Policy

모든 숫자 Cell 은 `sourceId` 로 `ReportModel.sources` 의 항목을 가리킨다. Report 는 출처를 만들지 않고 원본에서 옮긴다.

| 값 | 출처 |
|---|---|
| Historical | `src-historical`: provenance 의 source (OpenDART · Database · **fixture 는 fixture 로 표시**) |
| 가정 | `src-assumptions`: user-input / **learning-fixture(학습용 가정)** |
| Valuation · 파생 지표 · Sensitivity · Scenario | `src-engine`: ValuFlow Valuation Engine |
| 상대가치 입력 | `src-relative-inputs`: user-input |
| 시장 · 뉴스 · 공시 · 문서 | AI 근거(Evidence)가 가진 출처를 그대로 (provider 등급 · 기준 시점 · 문서 id/page 유지) |

학습용 가정 · fixture 는 `metadata.dataBasis` 와 Executive Summary 고지, 검증 warning 으로 보고서 전체에 표시된다.

## 7. Report Snapshot

`ReportInput.snapshot`: `contextSnapshotId`(AI Analyst 와 같은 기준 `ctx-…`) · `createdAt` · `historicalAsOf` · `historicalPeriods` · `marketAsOf`(AI 근거의 market-data 가 있을 때) · `valuationSnapshotId`(`val-…`) · `inputHash`. 입력은 deep copy 라서 Project 가 이후 바뀌어도 이미 만든 입력 · Report 의 숫자는 바뀌지 않는다(테스트: 원본을 직접 변조해도 불변, 바뀐 Project 는 다른 snapshot).

## 8. AI vs Deterministic

| 영역 | 담당 |
|---|---|
| 숫자 · 표 · 차트 데이터 · Valuation 결과 · Sensitivity · 출처 메타데이터 · 위험(엔진 검토 경고 · 데이터 품질) | **Deterministic** (엔진 / 분석 결과를 옮김) |
| Executive Summary 서술 · 해석 · Key Risks 서술 · Commentary(결론의 권고) | **AI**: STEP 08 Grounded Analysis 가 검증한 claim 문장만 |

AI 서술 규칙: `supported` 이고 근거 id 가 입력에 실제 존재하는 claim 만 사용(추적할 수 없거나 partial · unsupported 는 제외하고 개수를 남김), claim 의 문장을 **그대로** 쓰며 새 문장 · 새 숫자를 만들지 않는다, Fact(objective) / Judgment 구분과 confidence · evidence · 출처 id 를 보존, AI 분석이 Report 와 **다른 Project snapshot** 기준이면(stale) 사용하지 않고 이유를 남긴다. AI 분석이 없어도 deterministic Report 는 만들어진다.

## 9. Missing Data

`Cell.state`: `missing`(있어야 하는데 없음) · `unavailable`(출처가 제공하지 않음: 예 Historical D&A) · `not-applicable`(정의상 해당 없음: 예 첫 기간 성장률, 입력하지 않은 상대가치). 값이 없으면 `value=null` · `text=null` + `reason` 이며 0 이나 "N/A" 로 대체하지 않는다.

## 10. Validation (`validateReportInput`)

Error(Report 를 만들지 않고 `blocked` 로 돌려준다): `no-company` · `unsupported-company` · `no-historical` · `unit-missing` · `no-assumptions` · `assumptions-incomplete` · `no-valuation-result` · `invalid-wacc-g`(WACC ≤ g) · `missing-critical-result` · `schema-mismatch`.
Warning(Report 에 고지): `learning-assumptions` · `fixture-historical` · `data-quality-notes` · `sensitivity-unavailable` · `scenario-incomplete` · `relative-unavailable` · `no-ai-analysis` · `ai-analysis-stale`. 선택 section 이 없는 것은 error 가 아니다.

## 11. Versioning

`schemaVersion: "1.0"` 이 입력 · 모델 · metadata 에 있다. `parseReport` 는 알 수 없는 버전(`unsupported-schema`)이나 깨진 JSON(`invalid-json`)을 현재 형식으로 해석하지 않는다. 형식이 바뀌면 버전을 올리고 기존 snapshot 과 구분한다.

## 12. 실제 모델 예 (삼성전자 FY2023~2025 + STEP 04 학습용 가정)

Cell 271개: state ok 267 · unavailable 3(Historical D&A) · not-applicable 1(첫 기간 성장률) / kind calculated 156 · estimate 91 · actual 24. Sensitivity · Scenario · 상대가치 section 모두 ok. Headline: EV 2,346억원, Equity 2,146억원, 주당 214,556원, WACC 8.14%, g 2.00%, TV 기여 84.34%. 출처 4개(Database · 학습용 가정 · Engine · 상대가치 입력). 검증 warning: 학습용 가정 · 데이터 품질 노트 · AI 분석 없음.

## 13. 한계 · STEP 09-2 연결

- 이번 STEP 은 **데이터 계약**이다. HTML / PDF Renderer · 차트 · 화면은 만들지 않았다.
- 차트용 데이터는 Cell 표(historical rows · dcf rows · sensitivity matrix · scenario columns)로 이미 있고, Renderer 는 `Cell.text` · `kind` · `sourceId` 만 쓰면 된다.
- AI 분석을 Report 에 넣는 UI(어느 Deep Analysis 결과를 쓸지 선택)는 09-2 이후다. 지금은 `aiAnalysisFromWorkflow` 로 입력을 만든다.
- 시장 데이터는 Project State 에 저장되지 않아 AI 근거를 통해서만 Report 에 들어온다.
- `valuationDate` 는 가정이 아니라 Report 생성 snapshot 날짜다.
