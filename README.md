# ValuFlow

*From Financial Statements to AI-powered Valuation.*

가치평가 도메인을 직접 학습하고, 각 단계의 수작업을 점진적으로 자동화해 AI 기반 기업가치평가 업무지원 플랫폼으로 발전시키는 프로젝트입니다. 기획 원문은 `ValuFlow 기획서.md`를 참고하세요.

> 업무를 이해한 뒤 자동화한다.

```text
STEP 01 Financial Statements   → 재무제표를 읽는다
STEP 02 Financial Analysis     → 재무상태와 성과를 분석한다
STEP 03 DCF                    → 미래 FCFF를 추정하고 DCF를 이해한다
STEP 04 WACC & Valuation       → WACC를 산정하고 기업가치를 계산한다
STEP 05 Python Automation      → 계산 과정을 Python으로 자동화한다
STEP 06 Data Automation        → OpenDART로 데이터 수집까지 자동화한다
STEP 07 AI Valuation Agent     → Agent + Tool Calling + RAG
STEP 08 Final Product          → End-to-End 서비스로 통합한다
```

## 실행

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # 타입 검사 + 프로덕션 빌드
npm run test:engine   # 계산 엔진 단위 테스트
```

Node 22.6 이상이 필요합니다. 엔진 테스트가 TypeScript 파일을 직접 실행합니다.

## 구현 상태

| STEP | Lesson 해설 | Quiz | Practice | Project Build |
|---|---|---|---|---|
| 01 Financial Statements | 7개 전체 | 9문항 | 9개 항목 입력 + 점검 | 재무데이터 입력 Form + 저장 |
| 02 Financial Analysis | 8개 전체 | 3문항 | 3개년 비교표 | 지표 자동 계산 + 차트 |
| 03 DCF | 11개 전체 | 3문항 | 가상기업 손계산 vs 엔진 | FCFF / DCF 계산기 |
| 04 WACC & Valuation | 10개 전체 | 3문항 | 서술형 미션 | Valuation Dashboard (WACC, EV, Equity Value, 민감도) |
| 05 Python Automation | 개요 | 없음 | 미션 표시 | Coming in STEP 05 |
| 06 Data Automation | 개요 | 없음 | 미션 표시 | Coming in STEP 06 |
| 07 AI Valuation Agent | 개요 | 없음 | 미션 표시 | Coming in STEP 07 |
| 08 Final Product | 개요 | 없음 | 미션 표시 | Coming in STEP 08 |

- STEP 05~08의 Project Build는 직접 구현하는 과제입니다. 구현 전에는 `Coming in STEP XX`와 설계만 표시하며, 가짜 결과는 만들지 않습니다.
- 개요만 있는 Lesson은 화면에 "해설 작성 예정"이라고 표시합니다.
- 계산기의 기본 입력값은 동작을 보여 주기 위한 예시 가정이며 특정 기업의 데이터가 아닙니다.

## 구조

```text
src/
├── content/   STEP / Lesson / Quiz / Practice / Build 데이터 (bodiesNN.ts = Lesson 해설)
├── store/     사용자 상태(진행·메모·Practice·데이터셋)와 진행률 계산
├── engine/    재무분석·FCFF·WACC·DCF·민감도 순수 함수 + 단위 테스트
├── build/     STEP별 Project Build 위젯
├── pages/     라우트 페이지
└── components/ 레이아웃, 차트, 공통 UI
```

설계 원칙:

- 학습 콘텐츠, Quiz, Practice, Progress 상태를 분리합니다. 새 STEP이나 Lesson을 추가해도 UI 코드는 바꾸지 않습니다.
- 계산 로직(`engine/`)은 UI와 LLM에서 분리되어 있습니다. 핵심 숫자는 이 모듈이 계산하며, 이후 Agent는 Tool로 호출만 합니다.
- `engine/`의 TypeScript 구현은 STEP 05에서 Python으로 옮길 때 대조할 기준값입니다.
- 계산 불가 입력(0으로 나누기, 비어 있는 값, WACC ≤ g)은 임의의 값을 만들지 않고 `null` 또는 오류 메시지로 처리합니다.

## 데이터 저장

학습 기록(Lesson 완료, 메모, Quiz 답안, Practice, 재무 데이터셋)은 브라우저 `localStorage`에만 저장됩니다. 서버로 전송되지 않으며, 브라우저를 바꾸거나 사이트 데이터를 지우면 사라집니다. 초기화는 Project Report 페이지의 "학습 기록 초기화"에서 할 수 있습니다.

초기 상태는 기획서 12절에 맞춰 STEP 01이 IN PROGRESS이고, Lesson 01~06과 Quiz가 완료로 표시되어 있습니다. Quiz는 완료 표시만 있고 답안 기록은 없습니다.

## 로드맵

1. Phase 1~2: 학습 사이트와 STEP 01~04 학습·수동 Practice ← 현재
2. Phase 3: Python Valuation Engine (`valuation/`)
3. Phase 4: OpenDART + PostgreSQL
4. Phase 5: Agent + RAG
5. Phase 6: Final Dashboard / Report / Deployment
