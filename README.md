# ValuFlow

*From Financial Statements to AI-powered Valuation.*

재무제표에서 출발해 DCF 가치평가까지의 업무 흐름을 직접 학습하고, 그 로직을 계산 엔진·데이터 파이프라인·AI 분석으로 구현해 가는 **가치평가 업무지원 Workspace** 프로젝트입니다.

```text
기업 선택 → 재무데이터 → Historical Analysis → Forecast → FCFF → WACC
→ DCF → Enterprise Value → Equity Value → Relative Valuation
→ Sensitivity / Scenario → AI 분석 → Valuation Report
```

사이트는 두 영역으로 나뉩니다.

| 영역 | 역할 |
|---|---|
| **PROJECT** | 실제 가치평가 업무 화면: Dashboard · Workspace · Valuation · Analysis · AI Analyst · Report |
| **LEARN** | 가치평가 원리 학습: STEP 01~04 (Lesson · Quiz · Practice · Project Build · Reflection) |

## 실행

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # 타입 검사 + 프로덕션 빌드
npm run test:engine   # 계산 엔진 단위 테스트
```

Node 22.6 이상이 필요합니다. 엔진 테스트가 TypeScript 파일을 직접 실행합니다.

## 라우트

```text
/dashboard                 제품 Dashboard (기본 화면)
/workspace                 기업·재무데이터 (삼성전자 FY2023~2025 불러오기)
/valuation/:stage          historical | forecast | wacc | dcf | result | validation  ← Workflow Stepper
/analysis                  → /valuation/validation 으로 이동 (민감도 · 시나리오 · 상대가치는 Validation 단계)
/ai                        AI Analyst (이후 STEP, placeholder)
/report                    Valuation Report (이후 STEP, placeholder)
/learn                     학습 홈
/learn/roadmap             학습 로드맵
/learn/report              학습 기록 리포트
/learn/step-01 … step-04   overview 및 /lesson/:id · /quiz · /practice · /build · /reflection
```

기존 `/step/N/...`, `/learn/step/N/...`, `/roadmap` 주소는 새 주소로 자동 이동합니다.

## 구현 상태

### PROJECT

| 화면 | 상태 |
|---|---|
| App Layout / Sidebar | 완료. Analysis 메뉴는 Valuation 의 Validation 단계로 연결 |
| Dashboard | 완료. Workflow Progress 와 KPI 는 실제 PROJECT 상태에서 계산 (결과가 없으면 `—`, stale 결과를 보여주지 않음) |
| Workspace | 삼성전자 Historical Data 불러오기, 재무제표 탭, 파생지표 |
| Valuation | 6단계 Workflow: Historical → Forecast → WACC → DCF/Equity → Result → Validation |
| AI Analyst / Report | 이후 STEP 용 placeholder |

**Valuation Workspace** (`/valuation/:stage`)

| 단계 | 내용 |
|---|---|
| Historical | 공시 기반 Key Financials · 파생지표 · 추세 요약 · 차트 (Actual) |
| Forecast | Actual 참고값 옆에서 Estimate 입력 (성장률 · 마진 · D&A · CAPEX · ΔNWC · 세율) |
| WACC | CAPM · 세후 Kd · 자본구조 입력과 Live Preview (valuation 공개 API 재사용) |
| DCF / Equity | Terminal Growth · 이자부부채 · 현금 · 주식 수 입력, DCF 표, Equity Bridge (순현금은 `+ Net Cash`) |
| Result | EV · Equity Value · 주당가치 · WACC 요약 |
| Validation | Sensitivity(WACC × g) · Scenario(Bear/Base/Bull) · 상대가치(PER/PBR/EV·EBITDA) · Valuation Range · 검토 지표 |

- 모든 가정이 준비(Forecast · WACC · DCF/Equity READY)되어야 `Run Valuation` 이 활성화됩니다. 비어 있는 값은 어떤 기본값으로도 채우지 않습니다.
- 학습용 값은 `[학습용 DCF 가정 적용]` 을 눌렀을 때만 들어옵니다. 직접 입력한 값이 있으면 덮어쓰기 전에 확인합니다.
- `[Valuation 초기화]` 는 가정 · 결과 · 상대가치 입력을 모두 지우고 새 Valuation 을 시작합니다. Historical Data 는 유지됩니다.
- 입력만 `localStorage` 에 저장하고, 결과는 로드할 때 다시 계산합니다.

### LEARN

| STEP | Lesson 해설 | Quiz | Practice | Project Build |
|---|---|---|---|---|
| 01 Financial Statements | 7개 전체 | 9문항 | 9개 항목 입력 + 점검 | 재무데이터 입력 Form + 저장 |
| 02 Financial Analysis | 8개 전체 | 3문항 | 3개년 비교표 | 지표 자동 계산 + 차트 |
| 03 DCF | 11개 전체 | 3문항 | 가상기업 손계산 vs 엔진 | FCFF / DCF 계산기 |
| 04 WACC & Valuation | 10개 전체 | 3문항 | 서술형 미션 | Valuation Dashboard (WACC, EV, Equity Value, 민감도) |

LEARN 은 STEP 01~04 만 포함합니다. STEP 05 이후는 아래 PROJECT 로드맵(`src/content/roadmap.ts`)입니다.

## PROJECT 로드맵

```text
STEP 05 Valuation Engine v1       Forecast · FCFF · CAPM · WACC · DCF · EV · Equity · 주당가치 · Sensitivity · Scenario · 상대가치   ✅
STEP 06 Financial Data Pipeline   OpenDART → 파서 → 정규화 → PostgreSQL → Historical 테이블   (06-1 구조 완료 · 06-2 OpenDART 연결 다음)
STEP 07 Valuation Workspace       Historical → Forecast → WACC → DCF/Equity → Result → Validation   ✅
STEP 08 AI Valuation Analyst      Agent + Tool Calling + RAG (계산은 엔진, LLM 은 해석)
STEP 09 Report Automation         보고서 생성 · 미리보기 · PDF 내보내기
STEP 10 Final Product             배포 · 테스트 · UX 정리 · 샘플 기업 · 소개 페이지
```

MVP 순서: ① Dashboard + Valuation + Learn → ② Sensitivity · Comparable · Scenario → ③ DART · Historical Data · Company Search → ④ AI Analyst · RAG → ⑤ Report · Export · Deployment

## 구조

```text
src/
├── content/      STEP / Lesson / Quiz / Practice / Build 데이터 (bodiesNN.ts = Lesson 해설)
├── data/         fixture: 삼성전자 Historical(공시 기반), STEP 04 학습용 가정(가상값)
│   ├── dart/           External API 경계 + Raw Model (DartRawAccount …). HTTP 구현은 STEP 06-2
│   ├── normalization/  계정 매핑 · 단위(→KRW million) · 기간(2023A) · 연결/별도 · 품질(warnings) → HistoricalData
│   └── repository/     FinancialRepository interface + Fixture 구현(삼성전자 adapter)
├── valuation/    Valuation Engine v1 (결정적 계산, 공개 API: valuation/index.ts) — 자세한 사용법은 valuation/README.md
├── store/        LEARN 상태(state.tsx) / PROJECT 상태(project.tsx + projectModel.ts: historicalData · valuationAssumptions · valuationResult · sensitivityResult · relativeInputs), 가정 완성도(assumptions.ts), 워크플로 상태(workflowStatus.ts)
├── engine/       LEARN 학습용 계산기 + Workspace 화면의 순수 로직(입력 폼 검증, 표시 모델: forecastForm · waccForm · dcfForm · relativeForm · validationView …)
├── styles/       디자인 토큰(tokens.css) · 기반 · 레이아웃 · 컴포넌트 · 페이지 CSS
├── routes.ts     LEARN 라우트 헬퍼 (step-01 ↔ stepId)
├── build/        STEP별 Project Build 위젯
├── pages/        라우트 페이지 (Dashboard, Valuation, Learn 계열)
└── components/   레이아웃, 차트, 공통 UI, valuation/ (Stepper, 단계 슬롯, workflow.ts 단계 정의 — 계산식 없음)
```

설계 원칙:

- **UI 와 계산 로직 분리.** 계산은 `engine/` 에만 두고 화면은 결과 객체를 렌더링만 합니다. 같은 엔진을 Web UI, AI Agent, Report Generator, API 가 공유하는 것이 목표입니다.
- 공시 기반 Historical Data 와 학습용 Valuation Assumption 은 타입·fixture·상태를 분리합니다. STEP 04 가상값으로 계산한 결과를 삼성전자의 가치평가처럼 표시하지 않습니다.
- LLM 은 핵심 숫자를 직접 계산하지 않고 엔진을 Tool 로 호출만 합니다.
- `engine/dcf.ts` 등은 LEARN 의 학습용 계산기이고, PROJECT 의 Valuation Engine 은 `src/valuation/` 입니다. 화면과 store 는 `valuation/index.ts` 공개 API 만 사용하며 내부 파일을 직접 import 하지 않습니다.
- 계산 불가 입력(0으로 나누기, 비어 있는 값, WACC ≤ g)은 임의의 값을 만들지 않고 `null` 또는 오류 메시지로 처리합니다.
- 학습 콘텐츠, Quiz, Practice, Progress 상태를 분리합니다. 새 STEP 이나 Lesson 을 추가해도 UI 코드는 바꾸지 않습니다.
- 데스크톱 업무 화면을 우선하며, 금융 도구답게 정보 밀도는 허용하되 계층을 분명히 합니다.
- 계산기의 기본 입력값은 동작을 보여 주기 위한 예시 가정이며 특정 기업의 데이터가 아닙니다.

## 데이터 저장

학습 기록(Lesson 완료, 메모, Quiz 답안, Practice, 재무 데이터셋)과 계산기 입력값은 브라우저 `localStorage` 에만 저장됩니다. 서버로 전송되지 않으며, 브라우저를 바꾸거나 사이트 데이터를 지우면 사라집니다. 초기화는 Learn의 Project Report 페이지 "학습 기록 초기화"에서 할 수 있습니다.

초기 상태에서는 STEP 01 이 IN PROGRESS 이고 Lesson 01~06 과 Quiz 가 완료로 표시됩니다. Quiz 는 완료 표시만 있고 답안 기록은 없습니다.
