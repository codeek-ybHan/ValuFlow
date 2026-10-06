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
/workspace                 기업·재무데이터 (예정)
/valuation/:stage          forecast | wacc | dcf | equity  ← Workflow Stepper
/analysis                  비교기업 · 민감도 · 시나리오 (예정)
/ai                        AI Analyst (예정)
/report                    Valuation Report (예정)
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
| App Layout / Sidebar | 완료 |
| Dashboard | 뼈대 완료. 수치는 Engine 연결 전이라 `—` 로 표시 |
| Valuation | Workflow Stepper(Forecast → WACC → DCF → Equity Value)와 계산 컴포넌트 슬롯 완료. 계산 UI 연결 예정 |
| Workspace / Analysis / AI Analyst / Report | 예정 화면만 표시 |

`/valuation` 의 각 단계는 입력 영역과 Engine 결과 영역, 연결할 Engine 함수 이름을 보여 줍니다. 가짜 결과는 만들지 않습니다.

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
STEP 05 Valuation Engine v1       Forecast · FCFF · CAPM · WACC · DCF · EV · Equity · 주당가치
STEP 06 Financial Data Pipeline   OpenDART → 파서 → 정규화 → PostgreSQL → Historical 테이블
STEP 07 Valuation Workspace       가정 입력 · 실시간 계산 · 차트 · 시나리오 저장
STEP 08 AI Valuation Analyst      Agent + Tool Calling + RAG (계산은 엔진, LLM 은 해석)
STEP 09 Report Automation         보고서 생성 · 미리보기 · PDF 내보내기
STEP 10 Final Product             배포 · 테스트 · UX 정리 · 샘플 기업 · 소개 페이지
```

MVP 순서: ① Dashboard + Valuation + Learn → ② Sensitivity · Comparable · Scenario → ③ DART · Historical Data · Company Search → ④ AI Analyst · RAG → ⑤ Report · Export · Deployment

## 구조

```text
src/
├── content/      STEP / Lesson / Quiz / Practice / Build 데이터 (bodiesNN.ts = Lesson 해설)
├── store/        사용자 상태(진행·메모·Practice·데이터셋)와 진행률 계산
├── engine/       재무분석·FCFF·WACC·DCF·민감도 순수 함수 + 단위 테스트
├── routes.ts     LEARN 라우트 헬퍼 (step-01 ↔ stepId)
├── valuation/    Valuation Workflow 단계 정의 (화면이 읽는 설정, 계산식 없음)
├── build/        STEP별 Project Build 위젯
├── pages/        라우트 페이지 (Dashboard, Valuation, Learn 계열)
└── components/   레이아웃, 차트, 공통 UI, valuation/ (Stepper, 단계 슬롯)
```

설계 원칙:

- **UI 와 계산 로직 분리.** 계산은 `engine/` 에만 두고 화면은 결과 객체를 렌더링만 합니다. 같은 엔진을 Web UI, AI Agent, Report Generator, API 가 공유하는 것이 목표입니다.
- LLM 은 핵심 숫자를 직접 계산하지 않고 엔진을 Tool 로 호출만 합니다.
- `engine/` 은 LEARN 의 학습용 계산기입니다. PROJECT 의 Valuation Engine 은 `src/valuation/` 에 TypeScript 로 새로 구현할 예정입니다(STEP 05).
- 계산 불가 입력(0으로 나누기, 비어 있는 값, WACC ≤ g)은 임의의 값을 만들지 않고 `null` 또는 오류 메시지로 처리합니다.
- 학습 콘텐츠, Quiz, Practice, Progress 상태를 분리합니다. 새 STEP 이나 Lesson 을 추가해도 UI 코드는 바꾸지 않습니다.
- 데스크톱 업무 화면을 우선하며, 금융 도구답게 정보 밀도는 허용하되 계층을 분명히 합니다.
- 계산기의 기본 입력값은 동작을 보여 주기 위한 예시 가정이며 특정 기업의 데이터가 아닙니다.

## 데이터 저장

학습 기록(Lesson 완료, 메모, Quiz 답안, Practice, 재무 데이터셋)과 계산기 입력값은 브라우저 `localStorage` 에만 저장됩니다. 서버로 전송되지 않으며, 브라우저를 바꾸거나 사이트 데이터를 지우면 사라집니다. 초기화는 Learn의 Project Report 페이지 "학습 기록 초기화"에서 할 수 있습니다.

초기 상태에서는 STEP 01 이 IN PROGRESS 이고 Lesson 01~06 과 Quiz 가 완료로 표시됩니다. Quiz 는 완료 표시만 있고 답안 기록은 없습니다.

## 문서

`docs/ValuFlow v2 기획서.md` 가 현행 기준 문서이고, `docs/archive/` 는 이전 기획 문서입니다.
