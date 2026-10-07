# STEP 09-2 Report Sections & Templates

목표: "어떤 데이터를 어떤 순서와 구조로 보여 줄 것인가"를 확정한다. 이번 STEP 에는 PDF · HTML · 차트 · Preview UI 가 없다.

## 1. Template architecture

```
ReportModel (데이터)  ──┐
                       ├─ buildReportDocument ─▶ ReportDocument (순서 · 제목 · 번호 · 상태 · 고지 · footnote marker가 정해진 구조)
ReportTemplate (구조) ──┘                           └▶ Renderer / Export (이후 STEP)
```

```
src/report/templates/
  types.ts            ReportTemplate · SectionTemplate · LayoutHint · ReportDocument · section content 타입
  standardTemplate.ts valuation-standard-v1 (기본 template) + TEMPLATES 레지스트리
  sectionRegistry.ts  sectionId → "모델에서 이 section 의 내용을 꺼내는 함수"
  footnotes.ts        [S1] footnote marker contract
  buildDocument.ts    model + template → document, validateTemplate
```

- **Template 이 정하는 것**: section 순서 · 제목 · 필수 여부 · 가시성(`always | when-available | never`) · 번호 방식 · layout 힌트. **정하지 않는 것**: 숫자 · 문장(ReportModel 의 Cell · Grounded narrative 를 옮길 뿐).
- **ReportModel 에는 template 정보가 없다**(순서 · 제목 · 번호 · layout · template id). 같은 모델에 다른 template 을 적용하면 다른 문서가 나오고 section 내용은 같다(테스트).
- 번호는 template 이 보이는 section 에만 매긴다(표지 없음 · 본문 1, 2, … · 부록 A). 숨긴 section 때문에 번호에 구멍이 생기지 않는다.
- 확장: `valuation-summary`, `valuation-detailed`, `deal-team-internal` 은 같은 형식의 `ReportTemplate` 을 `TEMPLATES` 에 추가하면 된다(테스트에서 5개 section 짜리 summary template 으로 확인). `validateTemplate` 은 section id 중복 · 알 수 없는 id · order 중복 · 필수 section 숨김을 막는다.

## 2. Section order (valuation-standard-v1)

| 번호 | section | 필수 | 가시성 | layout |
|---|---|---|---|---|
| – | Cover | ○ | always | cover |
| 1 | Executive Summary | ○ | always | summary |
| 2 | Company Overview | ○ | always | key-value |
| 3 | Historical Financial Performance | ○ | always | table |
| 4 | Forecast Assumptions | ○ | always | table |
| 5 | WACC | ○ | always | key-value |
| 6 | DCF Valuation (Equity Bridge 포함) | ○ | always | table |
| 7 | Sensitivity Analysis | – | when-available | matrix |
| 8 | Scenario Analysis | – | when-available | columns(3) |
| 9 | Relative Valuation | – | when-available | table |
| 10 | Key Risks / Considerations | – | when-available | list |
| 11 | Conclusion | ○ | always | narrative |
| 12 | Sources | ○ | always | sources |
| A | Appendix | ○ | always | appendix |

선택 section 이 없으면 숨기고 `diagnostics.hiddenSections` 에 이유를 남긴다. template 이 `always` 로 바꾸면 빈 표 없이 `status: unavailable` + 이유만 보인다.

## 3. Section 별 내용

- **Cover**: 회사 · 제목 · `As of {valuationDate}` · 생성일 · 통화 · 금액 단위 · 주당 단위 · 버전(schema 1.0 / template 1.0).
- **Executive Summary**: headline(EV · Equity · 주당 · WACC · g · TV 기여, 모두 deterministic Cell) + Valuation Range + 고지. AI 가 있으면 Grounded Claim 을 `conclusion`(fact · calculation) · `judgment`(interpretation) · `risk` 로 나눠 보여 준다 — 새 문장 없음. AI 가 없으면 숫자 중심.
- **Company Overview**: Company · Corp Code · Stock Code · Reporting Basis · Historical Period(`2023A – 2025A`) · Data Source.
- **Historical**: 핵심 표(Revenue · Operating Profit · Operating Margin · Net Income · CFO · CAPEX) × 2023A–2025A(Actual, 출처 표시) + 추가 지표 + trend 요약(Revenue Growth · Operating Margin · NWC · Cash Generation(CFO−CAPEX) 등 방향 한글 라벨) + 데이터 노트 + grounded 해석(있을 때).
- **Forecast**: 2026E+ Estimate. Revenue Growth · Operating Margin · D&A · CAPEX · ΔNWC · Tax Rate, 가정 출처(`user-input` / `learning-fixture`).
- **WACC**: 입력(Risk-free · Beta · MRP · Pre-tax Kd · Tax Rate, Estimate)과 계산 결과(Cost of Equity · After-tax Kd · Equity/Debt Weight, Calculated)를 분리하고 WACC 는 따로 둔다 — 구성요소와 WACC 를 섞지 않는다.
- **DCF**: Revenue · EBIT · NOPAT · D&A · CAPEX · ΔNWC · FCFF · Discount Factor · PV of FCFF 표 + Terminal(g · Terminal FCFF · TV · PV(TV)) + TV 기여.
- **Equity Bridge**: 순부채면 `EV − Net Debt = Equity Value`, 순현금(Net Debt < 0)이면 `EV + Net Cash = Equity Value`, 0 이면 neutral. Net Cash 는 Net Debt 의 부호만 바꾼 표시(새 계산 아님). 주식 수 · 주당 가치 포함.
- **Sensitivity**: 5×5 matrix(행 g × 열 WACC), Base cell 은 `isBaseCase` flag 만, `valid`(WACC > g) flag 로 invalid 구분. 엔진이 WACC ≤ g 조합을 계산하지 않으므로 matrix 에는 invalid 셀이 없다. Renderer 는 숫자를 다시 계산하지 않는다.
- **Scenario**: Bear · Base · Bull 컬럼(Revenue Growth · Operating Margin · MRP · g 가정, WACC · EV · Equity · 주당). Sensitivity 범위와 Scenario 범위는 서로 다른 section 의 다른 필드다.
- **Relative**: 입력이 있을 때만. PER · PBR · EV/EBITDA, 입력 안 한 값은 `unavailable` 그대로, 평균 · 중앙값 필드 없음. 출처는 `상대가치 입력(사용자 입력)`이며 Peer 데이터가 아니라는 점을 명시.
- **Valuation Range**: ReportInput 에 이미 있는 `valuationRange`(Low / Base / High + 방법별 범위)만 쓴다. 새 평균을 만들지 않는다.
- **Key Risks**: 엔진 검토 경고 · 데이터 품질 검토(deterministic) + 검증을 통과한 AI `risk` claim(text · confidence · sourceIds 보존). 둘 다 없으면 section 숨김.
- **Conclusion**: 검증된 `recommendation` claim 이 있으면 사용, 없으면 deterministic headline · Range · 고지만. 새 valuation 의견을 만들지 않는다.
- **Sources**: `[S1]…` 번호, label · type · as-of · provider(+ 신뢰 등급) · reference(page/section/documentId) · url. 가능한 정보만.
- **Appendix**: 데이터 품질 노트 · provenance · **Missing Data**(section 별 missing / unavailable / not-applicable 과 이유) · 검증 경고 · 가정 출처 · 단위 정책 · 범례 · 기술 정보(schema · template 버전 · reportId · inputHash · snapshot id). 기술 정보는 부록에만 있다.

## 4. Footnote marker contract

`ReportDocument.footnoteIndex` 가 `sourceId → S#`(출처 등록 순서)를 정한다. `markersOf(index, sourceId | sourceIds)` 는 번호 순서 · 중복 제거 · 알 수 없는 id 는 건너뜀(marker 를 만들어 내지 않음)이고 `markerText` 가 `[S1][S4]` 형태를 만든다. Renderer 는 sourceId 를 가진 Cell · NarrativeItem · RiskItem 에 이 marker 를 붙인다 — `Revenue 333조원 [S1]` · `회사는 설비투자 확대를 언급했다. [S4]`. 각 section 은 인용하는 출처의 `sourceMarkers` 를 가진다. 실제 footnote 렌더링은 이후 STEP.

## 5. 학습용 · fixture 고지

학습용 가정 또는 fixture Historical 이면 문서 `banners` 에 **Learning / Demonstration Data** 가 있고, 해당 데이터를 쓰는 section(Executive · Forecast · WACC · DCF · Sensitivity · Scenario · Relative · Conclusion, fixture 는 Historical)의 `notices` 에 같은 제목으로 고지하며 상태는 `warning` 이다. 학습용이 아니면 고지가 없고 상태는 `ok`.

## 6. Section status

`ok | warning | unavailable | not-applicable`. warning = 고지가 있거나 값이 없는 항목(missing · unavailable)이 있음(이유 포함, 상세는 부록). `unavailable / not-applicable` section 은 `content: null` 이라 Renderer 가 빈 section 을 만들 수 없다.

## 7. 실제 문서 (삼성전자 + STEP 04 학습용 가정)

```
-  Cover                            ok       [ ]
1  Executive Summary                warning  [S2,S3]
2  Company Overview                 ok       [S1]
3  Historical Financial Performance warning  [S1]   (D&A 값 없음 3개)
4  Forecast Assumptions             warning  [S2,S3]
5  WACC                             warning  [S2,S3]
6  DCF Valuation                    warning  [S2,S3]
7  Sensitivity Analysis             warning  [S3]
8  Scenario Analysis                warning  [S3]
9  Relative Valuation               warning  [S3,S4]
10 Key Risks / Considerations       ok       [S3]
11 Conclusion                       warning  [S2,S3]
12 Sources                          ok
A  Appendix                         ok       [S1,S2]
```
출처: S1 OpenDART 재무제표(Database) · S2 STEP 04 학습용 가정 · S3 ValuFlow Valuation Engine · S4 상대가치 입력.

## 8. ReportModel 보강 (09-1 → 09-2)

WACC 에 Tax Rate · DCF 표에 Revenue/EBIT/D&A/CAPEX/ΔNWC · `dcf.equityBridge` · sensitivity `valid` flag · scenario 가정 Cell · Executive `highlights` 를 추가했다. 모두 이미 있는 입력 값을 옮긴 것이며 새 계산은 없다(Net Cash 부호 표시 제외).

## 9. 한계 · STEP 09-3 연결

- 이 STEP 은 구조 · 계약이다. Table / Chart 표현(열 정렬 · 숫자 서식 배치 · 차트 데이터 변환), footnote 렌더링, HTML · PDF, Preview UI 는 이후 STEP.
- 차트용 데이터는 이미 Cell 표(historical · dcf rows · sensitivity matrix · scenario columns)이며 `layout.kind`(table · matrix · columns)가 표현 방식을 힌트한다.
- AI 분석을 Report 에 넣는 UI(어느 Deep Analysis 를 쓸지 선택)는 아직 없다. 시장 데이터는 AI 근거를 통해서만 들어온다.
- Peer 비교(Peer source · 기준 시점)는 Peer Tool 결과를 Report 입력에 넣는 경로가 없어 이번에는 사용자 입력 멀티플만 지원한다.
