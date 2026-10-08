# ValuFlow — Development Guide

> 프로젝트 소개는 [`../README.md`](../README.md)입니다. 이 문서는 실행 · 환경 설정 · 모듈별 상세(STEP 단위) · 구현 상태를 담습니다.

*From Financial Statements to AI-powered Valuation.*

OpenDART 재무제표에서 DCF 가치평가, 근거 있는 AI 분석, PDF 보고서까지 이어지는 **기업가치평가 업무지원 Workspace** 입니다.

> **Live Demo:** https://valu-flow.vercel.app (배포 절차: [`docs/STEP10_production.md`](STEP10_production.md)). 데모 데이터는 학습용 가정을 포함하며 **실제 투자 · 가치평가 보고서가 아닙니다.**

## Live Demo

ValuFlow is publicly available as a portfolio demo. **No access key is required.**

Available:
- OpenDART financial analysis
- DCF / WACC valuation
- Sensitivity / scenario
- AI Analyst
- Disclosure / PDF RAG
- Report preview / PDF export

Usage-heavy features (AI, PDF upload, PDF export) are rate-limited per IP. Saved analyses and report snapshots are maintained as admin/testing capabilities and are not exposed as public multi-user features — in the public UI, analyses and reports live in the session only and disappear on refresh. Endpoint-level policy: [`docs/PUBLIC_PORTFOLIO_MODE.md`](PUBLIC_PORTFOLIO_MODE.md).

## Problem

기업가치평가는 반복적이고 근거 추적이 어렵습니다: 재무 수집 → 분석 → DCF/WACC → 근거 조사 → 보고서. 가정 하나가 결과를 크게 바꾸므로 계산은 재현 가능해야 하고, AI 가 개입할 때는 "어디서 나온 숫자인가"가 반드시 확인되어야 합니다.

## Solution

```text
OpenDART → Financial Pipeline → PostgreSQL → Historical Analysis
        → Valuation Engine (deterministic) → Validation (Sensitivity / Scenario / Relative)
        → AI Tool Layer ─┬ RAG (공시 + 사용자 PDF, pgvector)
                         ├ Market / Peer / News (provider 등급 표시)
                         └ Engine 결과
        → Agent Workflow → Grounded Analysis (Claim ↔ Evidence) → AI Analyst
        → Report Automation → HTML / PDF
```

## Architecture

```text
Browser ── Vercel (React/Vite, 정적) ── HTTPS ──▶ FastAPI (컨테이너 호스트)
                                                   ├─ OpenDART          (재무 · 공시, source of truth)
                                                   ├─ OpenAI            (AI Analyst · embedding)
                                                   ├─ RAG / pgvector    (Hybrid 검색)
                                                   ├─ Report PDF        (reportlab + 한글 폰트)
                                                   ├─ External providers (production 에서는 공식 provider 만)
                                                   └─ PostgreSQL + pgvector (재무 · 공시 chunk · AI 분석 · Report snapshot)
```
Frontend 는 정적 번들이고 모든 secret 은 FastAPI 쪽 환경변수에만 있습니다. 왜 Vercel 단독이 아닌지는 [`docs/STEP10_production.md`](STEP10_production.md) §2 에 있습니다.

## Key Features

- OpenDART 재무제표 정규화 (연결/별도, 단위, 미지원 구조 명시) 와 DB 영속화
- **deterministic 가치평가 엔진**: Forecast · FCFF · WACC · DCF · Equity Bridge, Sensitivity / Scenario / Relative
- 공시 + 사용자 PDF **RAG** (Hybrid: Vector + BM25 + 공시 동의어/표 가중치)
- **Tool Calling · Agent Workflow** (업무별 계획, 예산, 사람 확인 지점)
- **Claim-Evidence grounding**: 숫자 · 단위 · 출처 · 시점 검증, 실패 시 교정 재생성 1회 후 safe fallback
- **Report 자동화**: Preview(HTML) / PDF(A4, 한글) / JSON snapshot — 같은 RenderModel, 숫자 재계산 없음
- 검증된 AI 분석 · Report snapshot 의 서버 저장 (새로고침 · 재시작 후에도 열기)

## Reliability

- **Tool / Engine 책임 분리**: 계산은 엔진, 해석은 LLM. 단위 환산도 Tool 이 표시값을 제공 (모델은 100~1000배 단위 착오를 냈다)
- **Provider 신뢰 등급**: 비공식(Yahoo · Google News)은 development 로 표시하고 `APP_ENV=production` 에서 차단. 기업 재무 Actual 은 항상 OpenDART/ValuFlow
- **Human checkpoint**: 변경 제안은 사람이 판단, AI 가 Project 를 바꾸지 않음
- **Grounding · Guardrail · Evaluation**: 고정 질문 40개 · Guardrail 17종 · Report QA(718개 검사) 를 `npm test` / 스크립트로 반복 실행
- **공개 배포 보호**: 방문자 기능은 key 없이 쓰고, 비용이 드는 기능은 IP rate limit · 요청 크기 제한 · PDF 검증 · 문서 수 상한으로 보호, 저장/삭제/수집은 관리자 key 전용 · CORS 제한 · 오류/로그 정제

## Evaluation (STEP 08, 이 환경 · 이 데이터셋에서의 관찰)

질문 40개 · 실행 84회에서 required Tool Hit 100%, unsupported 숫자 claim · hallucinated source · 단위 오류 · WACC 의미 오류 · injection 성공 0, Guardrail 17/17, fallback 9.5%. RAG(OpenDART nDCG@5): Vector 0.38 → Hybrid 0.82 → +Reranker 0.79 (지연 225 → 263 → 1996ms). **질의 수가 적고 라벨이 충분히 검수되지 않은 소규모 평가이므로 일반 성능으로 해석하면 안 됩니다.** 자세히: [`docs/STEP08_summary.md`](STEP08_summary.md), [`docs/STEP08-8_evaluation.md`](STEP08-8_evaluation.md).

## Limitations (숨기지 않는 한계)

- **시장 · Peer · 뉴스 provider 는 production 에서 unavailable** 입니다. Current market reference provider is unavailable in production until an approved provider is configured. (개발 환경의 Yahoo/FRED/Google News 는 비공식 데모 fallback)
- 무위험수익률의 한국 공식 출처(한국은행 ECOS)는 통계표 · 항목 코드와 이용 조건을 확인하지 못해 구현하지 않았습니다.
- 사용자 인증과 사용자별 분리(multi-user isolation)가 없습니다. 그래서 공개 화면은 분석/Report 를 저장하지 않고(세션 메모리), 업로드된 PDF 는 공유 데모 저장소에 들어가며(삭제/재인덱싱은 관리자 전용) 문서 수 상한이 있습니다. rate limit 은 **서버 프로세스 메모리 기준**이라 instance 가 여러 개이거나 재시작하면 한도가 분리/초기화됩니다 (분산 limiter 없음). Render 등 proxy 뒤에서는 `TRUST_PROXY=true` 여야 IP 별로 구분됩니다.
- 학습용 fixture/가정 기반 Report 이며 실제 가치평가 의견이 아닙니다 (모든 출력에 고지).
- Reranker 는 production 기본 off (로컬 모델 ~1.1GB, 지연 · 라이선스). Hybrid 로 동작합니다.
- 큰 Report 의 비동기 생성, production observability(메트릭 · 알림), 더 큰 평가 데이터셋은 범위 밖입니다. 전체 목록: [`docs/STEP10_production.md`](STEP10_production.md) §13.

---

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

Frontend 와 backend(FastAPI)를 따로 실행합니다. OpenDART API Key 는 backend 에만 두고 브라우저 번들에는 들어가지 않습니다.

```bash
# backend  (http://127.0.0.1:8000)
cd backend && uv venv .venv && uv pip install -p .venv/bin/python -r requirements-dev.txt
cp .env.example .env            # DART_API_KEY= 에 본인 키를 입력 (.env 는 git 에 올라가지 않음)
.venv/bin/uvicorn app.main:get_app --factory --port 8000
.venv/bin/python -m pytest      # DART_API_KEY 가 있으면 실제 OpenDART smoke test 도 실행, 없으면 skip
```

### 데이터베이스 (PostgreSQL, 선택)

backend 만 DB 에 접근하며 프론트는 DB 를 모릅니다. `DATABASE_URL` 이 없으면 저장 없이 동작합니다 (조회마다 OpenDART → 정규화).

```bash
docker compose up -d db                                   # 로컬 PostgreSQL (또는 직접 설치한 PostgreSQL 사용)
# backend/.env 에 DATABASE_URL=postgresql://valuflow:valuflow@localhost:5432/valuflow
cd backend && .venv/bin/alembic upgrade head              # migration
.venv/bin/uvicorn app.main:get_app --factory --port 8000
.venv/bin/python -m pytest                                # DB 테스트: TEST_DATABASE_URL 이 없으면 pgserver(임시 PostgreSQL)를 사용
```

- 저장: 기업 · 수집 기록(`financial_fetches`) · Raw(`raw_financial_accounts`) · 정규화 값(`normalized_financials`) · 품질/매핑 추적(`data_quality`) · 미지원 결과(`unsupported_results`). HistoricalAnalysis · Forecast · Valuation 결과는 저장하지 않고 입력에서 다시 계산합니다.
- 조회 순서: Database → (없거나 `refresh=true`) OpenDART → 정규화 → Database 저장. `GET /api/companies/{corpCode}/historical?years=2023,2024,2025&basis=auto&refresh=false`
- 정규화 규칙의 source of truth 는 TS(`src/data/normalization`)이고 backend(Python)는 `npm run export:normalization` 으로 내보낸 `rules.json` 을 읽습니다. 규칙을 바꾸면 다시 내보낸 뒤 `POST /api/companies/{corpCode}/historical/renormalize` 로 저장된 Raw 를 재정규화할 수 있습니다.
- 배포(serverless): connection pool 은 기본 2개(overflow 0)로 제한되며 외부 pooler 를 쓰면 `DB_POOL=null` 로 pool 을 끕니다. DB 는 `DATABASE_URL` 만으로 지정하므로 특정 vendor 에 묶이지 않습니다. credential 은 환경변수로만 주입합니다.

### AI Analyst (STEP 08-2)

LLM 호출은 backend 에서만 합니다 (`backend/.env` 의 `OPENAI_API_KEY`, 선택 `OPENAI_MODEL` — 기본 `gpt-4.1-mini`; 브라우저 번들에는 Key 가 없습니다). Tool Runtime(`src/ai`, `executeTool`)은 frontend 에 있고, backend 는 계산을 하지 않습니다.

```text
질문 → POST /api/ai/query → 모델 → {status:'tool-call'} → frontend executeTool(같은 context snapshot)
     → POST /api/ai/tool-result → 모델 → … → {status:'final', answer: AiAnalystAnswer}  (또는 tool-limit)
```

- 대화 상태는 서버에 저장하지 않고 서명된 token 으로 주고받습니다 (serverless 호환). Tool 호출은 한 번에 하나, 최대 5회(`AI_MAX_TOOL_CALLS`).
- Tool 카탈로그 · system instruction 의 source of truth 는 TS 이고 `npm run export:ai` 로 `backend/app/ai/tool_catalog.json` 에 내보냅니다 (backend 가 허용 Tool 을 스스로 검증).
- 최종 답변은 JSON schema(structured output)를 따라야 하며, 어기면 `invalid-model-output` 입니다. frontend 는 `enforceGrounding` 으로 경고 · 출처 · 지원 불가 공개를 점검 · 보정하고 audit event 를 남깁니다.
- 주의: 모델마다 Tool 호출 습관이 다릅니다. `gpt-4o-mini` 는 불필요한 Tool 을 반복 호출해 한도(5회)에 걸리는 경우가 있었고, `gpt-4.1-mini` 는 안정적이었습니다.

### 공시 RAG (STEP 08-3)

OpenDART 공시 문서(사업보고서 → 반기 → 분기)를 backend 에서 수집해 section 구조를 보존한 chunk 로 나누고, embedding(OpenAI `text-embedding-3-small`, backend 에서만 호출)과 함께 PostgreSQL **pgvector** 에 저장합니다. 질문에는 backend Tool `searchDisclosures` 가 Vector + Keyword 검색(hybrid, RRF)으로 답하고, 결과는 외부 문서의 *인용 데이터*로만 모델에 전달됩니다 (문서 속 지시문은 따르지 않음).

```bash
# 공시 수집 (DATABASE_URL · OPENAI_API_KEY · DART_API_KEY 필요, alembic upgrade head 로 pgvector 확장 생성)
curl -X POST "http://127.0.0.1:8000/api/companies/00126380/disclosures/ingest?types=annual&limit=1"
curl "http://127.0.0.1:8000/api/companies/00126380/disclosures"
cd backend && .venv/bin/python -m scripts.eval_disclosure_retrieval 5     # 실제 문서 retrieval 평가
```

- Tool 실행 위치: 숫자 Tool(9개)은 frontend, `searchDisclosures` 는 backend(gateway 가 직접 실행, 호출 횟수 한도에 포함). 기업(corpCode)은 AI 가 지정할 수 없고 질문 context 의 기업으로 고정됩니다.
- 같은 접수번호(receiptNo)는 다시 수집 · embedding 하지 않습니다 (`force=true` 로만 교체).
- 숫자(과거 실적 · 가치평가)는 deterministic Tool 이 근거이고, 이유 · 맥락 · 위험은 공시 검색이 근거입니다. 문서 속 숫자가 Valuation 결과를 대체하지 않습니다.

### 통합 RAG: 공시 + 사용자 PDF (STEP 08-3 확장)

```
DART Loader ─┐
             ├─> NormalizedDocument → Chunking → Embedding → pgvector → Hybrid(Vector + BM25, RRF) → Reranker → Grounded Answer
PDF Loader ──┘
```
Loader 만 source 별로 다르고(`backend/app/knowledge/loaders/`) 이후 chunking · 저장 · 검색은 공유합니다. OpenDART 의 위치는 section, PDF 의 위치는 page 로 보존됩니다.

```bash
# PDF 업로드 (backend 가 추출 · embedding; 같은 파일(SHA-256)은 already-exists)
curl -X POST localhost:8000/api/knowledge/documents -F "file=@outlook.pdf;type=application/pdf" -F "title=2026 Semiconductor Outlook" -F documentType=industry-report -F businessYear=2026 -F sourceName="PwC Insight"
curl localhost:8000/api/knowledge/documents                           # 목록 (?sourceType=user-upload&corpCode=...)
curl -X POST localhost:8000/api/knowledge/documents/3/reindex         # 저장된 chunk 를 현재 embedding model 로 다시 embedding
curl -X DELETE localhost:8000/api/knowledge/documents/3               # 문서 + chunk + embedding 삭제
```
- **검증:** PDF Content-Type + `%PDF-` 확인, 크기(`MAX_UPLOAD_MB`, 기본 20), 업로드 문서 수 상한(`MAX_USER_DOCUMENTS`, 기본 30), IP 당 업로드 2회/hour, 빈 파일 · 손상 · 암호 PDF 거부, 파일 이름은 신뢰하지 않음(표시용으로만 정리해 저장, 파일 자체는 저장하지 않음). 스캔 PDF(OCR)는 `text-unavailable`.
- **기업 연결은 선택:** `corpCode` 를 주면 그 기업 질문에서만, 주지 않으면(산업 리포트 등) 기업과 무관한 문서로 모든 기업 질문에서 검색됩니다. 다른 기업에 연결된 문서는 검색되지 않습니다.
- **검색 Tool(backend):** `searchDisclosures`(공시) · `searchUploadedDocuments`(업로드 PDF) · `searchKnowledge`(둘 다). 모두 같은 파이프라인을 쓰고, 답변 출처에는 공시는 보고서 · section · 접수번호, 업로드는 문서 제목 · page 가 들어갑니다.
- **Reranker:** 후보 15개를 (질문, chunk) cross-encoder 로 다시 정렬합니다. `pip install -r backend/requirements-rerank.txt` 후 `RERANKER=auto`(기본)면 로컬 모델(`jina-reranker-v2-base-multilingual`, 첫 호출 때 ~1.1GB 다운로드, CC-BY-NC)을 쓰고, 설치하지 않으면 Hybrid 만 씁니다. API 방식은 `RERANKER=cohere` + `COHERE_API_KEY`. 지연은 CPU 에서 후보 15개에 약 2초입니다.
- **평가:** `docs/STEP08-3_unified_rag_eval.md` (Vector only vs Hybrid vs Hybrid + Reranker).
- **보안 참고:** 업로드 · 수집 API 에는 인증이 없습니다 (embedding 비용이 발생하므로 공개 배포 전에 보호가 필요합니다).

### 외부 데이터 Tool (STEP 08-4)

backend 가 직접 실행하는 외부 데이터 Tool 4종입니다. **계산은 ValuFlow Engine, 근거는 이 Tool, 해석은 LLM** 이며 Tool 은 ValuFlow 가정 · Forecast · Relative Valuation 입력을 바꾸지 않습니다 (`applied: false`).

> ⚠ **현재 provider 는 모두 개발 · 데모용 fallback 입니다. 공식 시장 데이터가 아닙니다.** Yahoo Finance(yfinance)와 Google News RSS 는 공식 SLA / API 계약이 없는 비공식 접근이고, FRED 는 OECD 월 단위 통계의 재배포입니다. 이 데이터는 Valuation 의 재무 근거(valuation-grade)로 쓰지 않으며, **기업 재무 Actual 의 source of truth 는 OpenDART / ValuFlow Historical** 입니다.

| Tool | 내용 | 현재 provider (신뢰 등급 · tier) | 기본 TTL |
|---|---|---|---|
| `getMarketData` | 주가 · 시가총액 · 발행주식수 · 52주 범위 (asOf · 출처 포함) | Yahoo Finance — 비공식 · development | 5분 |
| `getMarketAssumptions` | 무위험수익률(한국 국채 10Y) · 베타(raw) · 부채 지표. 시장위험프리미엄은 provider 가 없어 missing | FRED(OECD 월평균) — 재배포 · development / Yahoo Finance — 비공식 · development | 1일 |
| `getComparableCompanies` | 같은 산업 분류의 실제 종목 후보 + 배수(PER · PBR · EV/EBITDA, 없으면 null) + selectionReasons. 평균은 계산하지 않음 | Yahoo Finance screener — 비공식 · development | 1일 |
| `searchCompanyNews` | 제목 · 언론사 · 발행 시각 · 링크 · 짧은 요약 (본문 아님, 외부 텍스트는 데이터로만 전달) | Google News RSS — 비공식(개인 · 비상업 이용) · development | 15분 |

- 종목은 모델이 지정하지 않고 서버가 DART 기업 목록의 종목코드로 찾습니다. 외부 값은 `asOf` / `publishedAt` 을 가지며 DART 회계연도 값과 시점이 다릅니다.
- **provider 신뢰 등급:** 모든 Tool 결과에 `data.providers`(official · reliability · tier · valuationGrade)와 `provider-reliability` 경고가 붙고 `/api/health` 의 `externalProviders` 에도 노출됩니다. `APP_ENV=production` 이면 development 등급 provider 는 쓰이지 않고 그 Tool 만 `unavailable` 입니다 (운영용 provider 를 등록해야 풀립니다).
- 상태: `ok` · `unavailable`(호출 실패) · `no-data`(provider 에 데이터 없음) · `rate-limit`. 없는 값은 `{status:"missing"}` 이며 추정하지 않습니다.
- provider 는 `backend/app/external/providers.py` 의 Protocol 로 분리되어 있어 교체해도 Tool contract 는 그대로입니다 (`docs/STEP08-4_provider_review.md`: 운영 provider 후보와 조건). `EXTERNAL_DATA=false` 로 끌 수 있고 TTL 은 `MARKET_TTL_SECONDS` · `FUNDAMENTALS_TTL_SECONDS` · `RATE_TTL_SECONDS` · `NEWS_TTL_SECONDS`.
- provider 의 영업이익률 · 매출은 DART 기준과 크게 다를 수 있어 Tool 이 경고합니다. `pip install yfinance` 가 필요합니다 (requirements.txt).

### Agent Workflow (STEP 08-5)

autonomous agent 가 아니라 **분석 업무를 계획 → Tool 실행 → 관찰 → 계속 / 사람 확인 / 완료**로 진행하는 Analyst-support Agent 입니다. 기존 Tool loop(frontend `executeTool` ↔ backend LLM gateway)를 재사용하고, 가정 · Forecast · WACC · Peer 배수 · 시나리오는 절대 바꾸지 않습니다.

- **Workflow 8종** (`src/ai/agent/workflows.ts`): Historical · Forecast · WACC · DCF · Sensitivity/Scenario · Comparable · Event(Risk/News) · Full Valuation Review. 각 단계는 필수 / 선택으로 나뉘고, 모든 Tool 을 무조건 부르지 않습니다. 질문이 workflow 업무가 아니면 기존 `runAiQuery` 를 씁니다.
- **Planner**: 규칙 기반(`planWorkflow`, `classifyQuestion` 을 routing hint 로 재사용). 계획에는 Tool 이름과 목적뿐이며 값을 만들지 않습니다. 데이터가 없는 단계는 `skipped`(사유 포함), 필수 데이터가 없으면 `failed`, unsupported 기업은 LLM 을 부르지 않고 지원 불가만 알립니다.
- **실행** (`runWorkflow`): 시작 시 immutable context snapshot 을 만들어 끝까지 씁니다. Tool 결과는 구조화된 **Observation**(요약 · 누락 · 경고 · 출처 종류 · 다음 Tool 힌트; 문서 · 기사 본문 없음)이 되고 다음 판단용으로 gateway 에 전달됩니다(예: 품질 경고 → `getMappingTrace`, 뉴스의 CAPEX 발표 → `searchDisclosures`).
- **한도**: 일반 질문 5회, workflow 10회(`AI_AGENT_MAX_TOOL_CALLS` 상한, 요청 값은 이 상한으로 제한), 단계 수 14개, **같은 Tool + 같은 입력의 반복 호출 차단**(gateway, 일반 질문에도 적용; 예산에는 포함).
- **사람 확인 지점**: 모델은 변경을 직접 하지 못하고 `proposedActions`(대상 · 현재 값 · 제안 값 · 근거가 모두 있을 때만)로 제안합니다. 제안이 있으면 workflow 는 `waiting-for-user` 로 멈추고, `resolveCheckpoint` 로 승인 / 거절을 기록해도 값은 적용되지 않습니다 (실제 write Tool 은 아직 없음).
- **Tool 분류**: `get*` read · `search*` search · `update*` / `apply*` / `save*` write. write Tool 은 gateway 가 모델의 직접 실행을 거부합니다(`approval-required`).
- **부분 실패**: 한 Tool 이 실패해도 계속하고, 최종 답변의 `limitations` 에 "뉴스 데이터는 현재 확인하지 못했습니다." 같은 한계가 남습니다 (모델이 빠뜨려도 복원). 필수 단계가 실행되지 않은 경우도 한계로 남습니다.
- **설명 가능성**: 최종 답변에는 내부 추론 대신 `reviewedAreas`(검토한 영역), `limitations`, `judgmentItems`(분석가가 판단할 가정), `claims`(주요 주장 → 성공 실행된 Tool 증거)가 들어갑니다. 실행되지 않은 Tool 을 근거로 든 claim 은 걸러집니다.
- **Audit** (`WorkflowAuditEvent`): workflowId · 종류 · 계획 / 실행 단계 · Tool 상태 · 출처 종류 · 경고 · 체크포인트 · 상태 · 소요 시간 · 위반. Tool 결과 본문 · 문서 · 기사 · Raw 재무 · Key 는 저장하지 않습니다.
- 실제 LLM 확인: backend 를 띄운 뒤 `node scripts/agent-live.ts` (WACC · Full · Event 3종).

### Grounded Analysis (STEP 08-6)

Agent 가 만든 분석 문장의 핵심 claim 을 **Claim → Evidence → Source** 로 추적하고, 근거 없는 숫자 · 출처 · 해석을 탐지 · 보정합니다 (`src/ai/grounding/`). workflow 최종 답변에 적용됩니다.

- **Evidence** (`extractEvidence`): Tool 결과에서 grounding 에 필요한 것만 뽑습니다 — 숫자 하나 = Evidence 하나(`getHistoricalAnalysis:metrics.operatingMargin.values[2]`: 값 · 단위 · 기간 · 출처 종류 · DataQuality), 검색 문단 / 뉴스 한 건(문서 id · page · section · url · 짧은 발췌 · 검색 순위), 값 없음 표시(missing). LLM 이 계산한 값은 Evidence 가 아닙니다.
- **Claim** (`claims: [{claimId, text, type, evidenceRefs:[{tool, fieldPath}]}]`): `fact` · `calculation` · `interpretation` · `risk` · `recommendation`. fact / calculation 은 수치 · 문서 근거가 있어야 하고(`objective`), 나머지는 근거가 있어도 **judgment** 로 구분되며 신뢰도가 high 가 될 수 없습니다. 모델이 인용하지 않아도 숫자 · 용어("영업이익률", "무위험수익률" …)로 근거를 연결합니다.
- **검증**: 인용한 Tool 이 실행됐는가 · fieldPath 가 존재하는가 · 값이 일치하는가(비율↔퍼센트, 원 · KRW million · 억원 · 조원 환산, 적힌 소수 자릿수 기준 반올림, 같은 문장의 두 퍼센트로 계산되는 `%p` 파생 수치 — 모두 deterministic) · 숫자가 문장이 말하는 **지표**의 근거인가(다른 지표에 우연히 같은 값이 있어도 불인정) · calculation 은 deterministic Tool 값 · valuation 숫자는 엔진 결과 · 문서 claim 은 검색된 발췌에 핵심 단어 · 값이 없는(missing) 항목을 채우지 않았는가(한국어 라벨 포함).
- **WACC 의미 모델**: WACC 는 구성요소(무위험수익률 · 베타 · 시장위험프리미엄 · 타인자본비용 · 세율 · 자본구조)의 결과입니다. 변경 제안 type 은 `change-risk-free-rate` · `change-beta` · … · `change-wacc-directly`. 모델이 Rf(3.0%) 변경을 `change-wacc-directly` 로 분류하면 의미 오류로 기록하고, 현재 값으로 구성요소가 분명하면 type 을 바로잡습니다.
- **우선순위 · 충돌**: ValuFlow 엔진 > OpenDART 정규화 실적 > 공시 > 업로드 문서 > 공식 provider > 개발용 provider > 뉴스. 같은 지표를 provider 가 크게 다르게 말하면(예: 영업이익률 13% vs 52%) 충돌을 `limitations` 에 밝히고 provider 값은 재무 Actual 로 쓰지 않습니다.
- **신뢰도**: high = deterministic 직접 값 · medium = 공시 / 업로드 문서 / 공식 provider · low = 개발용 provider · 뉴스. DataQuality(partial · ambiguous · …)와 검색 품질(낮은 순위 · 같은 검색 안에서 낮은 점수 · 근거 문단 하나뿐)이 한 단계씩 낮춥니다. 서로 다른 시점(FY · 시장 asOf · 뉴스 발행일)을 섞고 시점을 밝히지 않으면 표시하고 시점 요약(`timeBasis`)을 만듭니다.
- **보정**: 막아야 할 위반(근거 없는 claim · 숫자, 값 없음 채우기, 충돌 값, 의미 오류 제안)이 있으면 위반 목록 + 허용 Evidence 목록만 backend(`/api/ai/regenerate`, Tool 없음)에 보내 **1회 교정 재생성**합니다 (Tool 결과 원문은 보내지 않음). 그래도 위반이면 근거 없는 claim · 숫자를 제거하고 검증된 사실로 **fallback** 답변을 만듭니다. 모델이 지어낸 출처는 제거하고 위반으로 기록합니다.
- **Coverage / Audit**: `coverage = supported claims / 핵심 claims` (모든 문장을 claim 으로 세지 않음). `GroundingAuditEvent`: totalClaims · groundedClaims · violations · unsupportedNumbers · hallucinatedSources · contradictions · corrections · fallbackUsed · regenerated — 개수 · 코드만 저장하고 문서 · Tool 결과 본문은 저장하지 않습니다.
- **표시용 값(단일 출처, `src/ai/tools/display.ts`)**: LLM 은 금액 단위 환산을 하지 않습니다. Historical · Valuation · 시장 Tool 은 원본 값(full precision)과 함께 표시용 값을 줍니다 — 금액 `display.valuesEok` · `valuesTrillion`(원본 KRW million 의 환산), 비율 `valuesPercent`, 그대로 옮겨 쓰는 문자열 `valuesEokText` · `valuesPercentText` · `enterpriseValueText` · `perShareWonText` · `waccPercentText` · `valueText`. 환산 규칙(`financialDisplayValue` · `formatFinancialValue` · `normalizeDisplayUnit`)은 Tool · Evidence · 검증 · 재생성 요청이 모두 같은 파일을 씁니다 (Python 시장 Tool 의 `valueText` 만 언어가 달라 별도 구현). 검증은 근거의 단위를 알면 같은 종류끼리만 비교하고(금액 ↔ 금액, 비율 ↔ 퍼센트), 근거가 없는데 어떤 금액 근거의 10ⁿ 배인 숫자는 **단위 환산 착오(unitSlip)** 로 따로 셉니다. `26만 8,500원` 같은 만 단위 표기도 한 금액으로 읽습니다.
- **claim 정책**: 핵심 claim 은 6개 이내를 권하고 8개까지만 검증합니다. 분석 구조는 검증된 사실 · 해석 · valuation 위험 · 권고(`report.sections`) + 한계(`limitations`)이며, 근거가 없는 위험 · 해석은 제거됩니다. 요약에는 claim 에 있는 숫자만 반복하도록 합니다.
- **source authority**: 같은 숫자가 여러 source 에 있으면 claim 범주별로 가장 권위 있는 source 를 근거로 씁니다 — 과거 실적 → OpenDART 정규화 실적 · valuation → ValuFlow 엔진 · 현재 주가 → 시장 provider · 경영진 설명 → 공시 · 산업 전망 → 업로드 산업 리포트 · 뉴스 → 뉴스. 범주를 알 수 없으면 기본 단일 우선순위를 씁니다.
- **Acceptance (live)**: backend 를 띄우고 `node scripts/agent-acceptance.ts [baseUrl] [repeat]` — 대표 4개 질문(영업이익률 · WACC · 설비투자 이유 · 실적+시장 risk)에서 first-pass / 재생성 후 / fallback 지표와 최종 답변 기준 {unsupported 숫자 claim · hallucinated source · 단위 환산 오류 · WACC 구성요소 의미 오류 · 이전 맥락 누출}을 기록합니다. 결과와 해석은 `docs/STEP08-6_acceptance.md`.
- **기술부채**: grounding 계층은 workflow 분석(`runWorkflow`, `groundingLevel: 'claim-evidence'`)에만 적용됩니다. 일반 질문(`runAiQuery`, `groundingLevel: 'tool-guardrails'`)은 출처 · 경고 · 실패한 Tool 근거 · 근거 항목 숫자 검사만 합니다. 통합 지점: `groundWithRepair` 는 claim 이 없어도 summary 숫자를 검증하므로 일반 질문 답변 schema 에 claims 를 추가하거나 summary 검증만 적용하면 됩니다. 08-7 UI 는 `groundingLevel` 로 Workflow Analysis 와 Quick Question 의 수준 차이를 구분해서 보여야 합니다.
- 한계: claim ↔ 문서 연결은 핵심 단어 겹침(형태소 분석 없음), 한국어 용어 사전은 주요 valuation 용어만, `runAiQuery`(비 workflow 질문)에는 아직 적용하지 않습니다.

### AI Analyst UI (STEP 08-7)

`/ai` 는 "왜 이런 답을 했는지 확인할 수 있는" 분석 화면이다. 좌측 History · Knowledge Documents(PDF 업로드 · 목록 · Re-index · 삭제), 중앙 질문 · 진행 단계 · 답변, 우측 Evidence · Sources · Data Basis · Warnings (좁은 화면에서는 drawer).

- **Quick Answer / Deep Analysis**: 자동은 workflow 질문일 때만 Deep Analysis. Quick 은 Tool Guardrails 수준(문장별 근거 연결 없음), Deep 은 Claim-Evidence 수준임을 화면에서 구분한다 (`groundingLevel`).
- **Fact / Judgment**: Claim 카드는 FACT(실선 · 진한 막대)와 JUDGMENT(점선 · 이탤릭)로 모양이 다르다. 상태(Supported …)와 Confidence(High/Medium/Low)는 색뿐 아니라 글자 · 기호로도 표시한다.
- **Human checkpoint**: Keep Current / Review Later / Apply·Continue 는 검토 상태만 기록한다. 어떤 버튼도 Project 가정 · 결과를 바꾸지 않는다 (write Tool 은 이후 STEP). WACC 구성요소(Rf · Beta …) 제안과 WACC 직접 변경은 구분해서 표시한다.
- **상태 분리**: 대화 state(`store/analyst.tsx`)는 Project state 와 분리되어 있고 읽기 전용이다. 질문마다 새 context snapshot 으로 실행하며, 과거 답변은 그 당시 Evidence snapshot 을 보여 주고 "Based on previous project state" 를 표시한다.
- **구조**: view-model 은 `src/ai/analyst/view.ts`(순수 함수 · 테스트 대상), 실행은 `ask.ts`, history 는 `session.ts`, PDF 관리 client 는 `src/data/repository/knowledgeRepository.ts`, 화면은 `src/pages/AiAnalyst.tsx` · `src/components/analyst/`.
- **테스트**: `src/ai/analyst.test.ts`(view-model · 실행 · 오류 · PDF client) · `src/ai/analystRender.test.ts`(esbuild 로 번들해 서버 렌더링한 HTML 검증).
- **알려진 한계**: 질문 시 source filter(OpenDART / Uploaded) 는 제공하지 않는다(AI 가 선택). 진행 표시는 frontend 가 실행하는 Tool 의 완료 시점에만 갱신된다(backend 검색 Tool 은 gateway 안에서 실행되므로 그 동안은 다음 대기 단계가 표시된다). Cancel 은 진행 중인 요청 자체를 끊지 않고 결과를 버리며, 다음 왕복 전에 workflow 를 멈춘다.

### Evaluation & Guardrails (STEP 08-8)

고정 질문 40개(Historical · Valuation · RAG · External · Mixed · Failure)와 지표, 오프라인 Guardrail 스위트 17개, 라이브 평가 러너로 AI Analyst 의 품질과 실패 조건을 측정한다. 결과 · 실패 사례 로그 · Guardrail Matrix 는 `docs/STEP08-8_evaluation.md`, STEP 08 전체 요약과 포트폴리오 설명은 `docs/STEP08_summary.md`.

- **오프라인(항상 실행)**: `npm test` 가 데이터셋 불변식 · 라우팅 · Tool selection 지표 · Guardrail 스위트(악의적 모델: 단위 오류 · 출처 환각 · provider 충돌 · 시점 혼합 · missing 값 · 이전 맥락 · prompt injection · system prompt 유출 · write 요청 · 장애 · 재생성 · fallback)를 검증한다. `node scripts/eval-guardrails.ts` 는 Guardrail Matrix 를 출력한다.
- **라이브(실제 LLM · backend 필요)**: `DOCS=1 node scripts/eval-live.ts <baseUrl> out.json [repeat]` → `node scripts/eval-report.ts out.json …`. 합성 PDF 는 `PYTHONPATH=. python -m scripts.make_eval_pdfs <dir>`, provider 장애는 `APP_ENV=production` backend 로, provider 지연은 `python -m scripts.probe_latency` 로 본다.
- **출력 가드레일**: system instruction 조각이 답변에 들어가면 제거(`src/ai/guard.ts`), Quick Answer 의 요약 · 근거 항목 숫자는 Tool 결과에서 찾을 수 없으면 제거(`src/ai/quickGuard.ts`).

### Report Architecture (STEP 09-1)

`src/report/` 는 Valuation Report 의 **데이터 계약**이다: `Project State → ReportInput(snapshot) → ReportModel → Renderer / Export`. Report 는 UI state 를 읽지 않고, 숫자를 새로 계산하지 않으며(엔진 · 분석 결과를 옮김), AI 서술은 STEP 08 의 검증된 Grounded Claim 만 재사용한다. 모든 숫자는 Actual / Estimate / Calculated, 정책 단위(억원 · 원 · % · 주), 출처 id 를 가진 `Cell` 이고 값이 없으면 missing / unavailable / not-applicable 로 구분한다. `schemaVersion: "1.0"`. 자세한 내용은 `docs/STEP09-1_report_architecture.md`. Renderer(HTML · PDF)는 STEP 09-3 이후.

**Template (STEP 09-2)**: `src/report/templates/` 가 ReportModel 을 보고서 구조로 연결한다 — section 순서 · 제목 · 필수/선택 · 가시성 · 번호 · layout 힌트 · footnote marker(`[S1]`) contract · 학습용 데이터 고지. 기본 template `valuation-standard-v1`(Cover → … → Sources → Appendix), 모델에는 template 정보가 없고 숫자는 다시 계산하지 않는다. `docs/STEP09-2_report_templates.md`.

### Credential 정책

| 환경변수 | 쓰이는 곳 | 없을 때 |
|---|---|---|
| `DART_API_KEY` | OpenDART (기업 · 재무 · 공시, 종목코드 조회) | 해당 기능 오류. 외부 Tool 은 종목을 못 찾아 `unavailable` |
| `OPENAI_API_KEY` | LLM · embedding | AI Analyst / 공시 검색 비활성 (`ai-not-configured`) |
| `MARKET_DATA_API_KEY` · `NEWS_API_KEY` | Key 가 필요한 시세 · 뉴스 provider 를 고른 경우 (현재 기본 provider yahoo · google 은 Key 불필요, 단 개발 · 데모용) | **해당 Tool 만** `unavailable` |
| `RERANKER_API_KEY` | `RERANKER=cohere` (예전 이름 `COHERE_API_KEY`) | reranking 만 꺼지고 Hybrid 로 동작 |

- 모든 credential 은 backend 환경변수(또는 `backend/.env`)에만 둡니다. frontend 에는 어떤 Key 도 없고 `VITE_` 접두사 변수에 Key 를 두면 안 됩니다 (테스트가 소스 · 빌드 결과를 검사합니다).
- 응답 · Audit · 오류 메시지에는 Key 가 없고, 로그에서는 설정된 모든 credential 값이 `***` 로 가려지며 예외 본문 · traceback 은 남기지 않습니다. 사유 문구는 Key 값이 아니라 필요한 환경변수 이름만 알려 줍니다.
- provider 를 바꿔도 Tool contract 는 같습니다 (`backend/app/external/registry.py` 에 provider 와 `requires_key` 를 등록).
- 단위 테스트는 mock provider 만 쓰고 네트워크를 막습니다. live smoke 만 Key 가 있을 때 실행됩니다.

기업 검색과 재무제표 수집(`GET /api/companies/{corpCode}/financials?years=2023,2024,2025&basis=auto`)은 backend 가 켜져 있어야 동작합니다. 실제 응답의 계정명 조사는 `.venv/bin/python -m scripts.inspect_raw_accounts` 로 다시 실행할 수 있습니다 (dev 서버가 `/api` 를 8000 포트로 전달).

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # 타입 검사 + 프로덕션 빌드
npm run test:engine   # 계산 엔진 단위 테스트
```

Node 22.6 이상이 필요합니다. 엔진 테스트가 TypeScript 파일을 직접 실행합니다.

## 라우트

```text
/dashboard                 Dashboard — 기업 선택 후 핵심 KPI 4개 · Workflow 상태 (기업 선택 전에는 빈 상태)
/workspace                 기업 검색 · 선택 → 재무제표 기준(자동·연결·개별) → OpenDART 재무데이터 불러오기 · 재무제표/분석 표
/valuation/:stage          historical | forecast | wacc | dcf | result | validation  ← Workflow Stepper
/analysis                  → /valuation/validation (민감도 · 시나리오 · 상대가치는 Validation 단계)
/ai                        AI Analyst (질문 · Workflow 진행 · Claim/Evidence · Knowledge Documents(PDF 업로드/삭제))
/report                    Valuation Report 생성 · Preview · Sources · PDF/HTML/JSON Export
/learn                     학습 홈 (보조 메뉴)
/learn/roadmap             학습 로드맵
/learn/report              학습 기록 리포트
/learn/step-01 … step-04   overview 및 /lesson/:id · /quiz · /practice · /build · /reflection
```

기업을 선택하기 전에는 Dashboard · Valuation · AI · Report 모두 "기업을 선택해 기업가치평가를 시작하세요." 빈 상태만 보입니다.

기존 `/step/N/...`, `/learn/step/N/...`, `/roadmap` 주소는 새 주소로 자동 이동합니다.

## 구현 상태

### PROJECT

| 화면 | 상태 |
|---|---|
| App Layout (상단 내비) | 완료. Analysis 메뉴는 Valuation 의 Validation 단계로 연결, Learn 은 보조 링크 |
| Dashboard | 완료. Workflow Progress 와 KPI 는 실제 PROJECT 상태에서 계산 (결과가 없으면 `—`, stale 결과를 보여주지 않음) |
| Workspace | 삼성전자 Historical Data 불러오기, 재무제표 탭, 파생지표 |
| Valuation | 6단계 Workflow: Historical → Forecast → WACC → DCF/Equity → Result → Validation |
| Report | 완료. 생성 · Preview · Sources · PDF/HTML/JSON Export (STEP 09) |
| AI Analyst | 실제 페이지 (STEP 08-7) |

**Valuation Workspace** (`/valuation/:stage`)

| 단계 | 내용 |
|---|---|
| Historical | 공시 기반 Key Financials · 파생지표 · 추세 요약 · 차트 (Actual) |
| Forecast | Actual 참고값 옆에서 Estimate 입력 (성장률 · 마진 · D&A · CAPEX · ΔNWC · 세율) |
| WACC | CAPM · 세후 Kd · 자본구조 입력과 Live Preview (valuation 공개 API 재사용) |
| DCF / Equity | Terminal Growth · 이자부부채 · 현금 · 주식 수 입력, DCF 표, Equity Bridge (순현금은 `+ Net Cash`) |
| Result | EV · Equity Value · 주당가치 · WACC 요약 |
| Validation | Sensitivity(WACC × g) · Scenario(Bear/Base/Bull) · 상대가치(PER/PBR/EV·EBITDA) · Valuation Range · 검토 지표 |

- Historical D&A 는 출처(OpenDART 재무제표 본문)에 없으면 `—`(missing)로 두며 0 · 학습용 값 · CAPEX/PPE 추정으로 채우지 않습니다. 필요하면 Forecast 에서 직접 입력합니다.
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
STEP 06 Financial Data Pipeline   OpenDART → 파서 → 정규화 → PostgreSQL → Historical 테이블   (06-1 구조 · 06-2 기업 검색 · 06-3 재무제표 Raw 수집 · 06-4 계정 매핑 검증 · 06-5 Historical Analysis 엔진 · 06-6 PostgreSQL 저장 완료 · 06-7 Workspace 연결 다음)
STEP 07 Valuation Workspace       Historical → Forecast → WACC → DCF/Equity → Result → Validation   ✅
STEP 08 AI Valuation Analyst      Agent + Tool Calling + RAG (계산은 엔진, LLM 은 해석)
STEP 09 Report Automation         보고서 생성 · 미리보기 · PDF 내보내기
STEP 10 Final Product             배포 · 테스트 · UX 정리 · 샘플 기업 · 소개 페이지
```

MVP 순서: ① Dashboard + Valuation + Learn → ② Sensitivity · Comparable · Scenario → ③ DART · Historical Data · Company Search → ④ AI Analyst · RAG → ⑤ Report · Export · Deployment

## 구조

```text
.
├── src/                       Frontend (React 18 + Vite + TypeScript) — 정적 번들, secret 없음
│   ├── pages/                 라우트 페이지 (Dashboard · Workspace · Valuation · AiAnalyst · ReportPage · Learn 계열)
│   ├── components/            Layout(상단 내비) · 공통 UI · 차트 · valuation/(Stepper · 단계) · analyst/ · report/
│   ├── store/                 PROJECT 상태(project.tsx + projectModel.ts) · AI 대화(analyst.tsx) · Report(report.tsx) · LEARN 상태
│   ├── valuation/             Valuation Engine v1 (결정적 계산, 공개 API: valuation/index.ts)
│   ├── engine/                순수 로직(입력 폼 검증 · 표시 모델 · Historical 분석 · 열 순서) + LEARN 학습용 계산기
│   ├── data/                  데이터 계층
│   │   ├── dart/ · normalization/ · repository/   OpenDART 경계 · 계정 정규화 · Repository(Database/DART/Fixture)
│   │   ├── persist/           관리자 전용 분석/Report 저장 client (공개 화면은 사용하지 않음)
│   │   └── fixtures/          학습용(삼성전자 fixture · STEP 04 가정) — 기업 선택 없이 화면에 나오지 않는다
│   ├── ai/                    AI Analyst: 질문 분류 · 검색 라우팅(retrievalRoute) · Tool(tools/) · Agent Workflow(agent/) · Grounding(grounding/) · UI 모델(analyst/) · 평가(eval/)
│   ├── report/                Report Automation: sections · templates · narrative · presentation · render · qa · export(PDF client) · ui
│   ├── content/ · build/      LEARN 콘텐츠(STEP/Lesson/Quiz) · STEP별 Project Build 위젯
│   └── styles/                tokens · base · layout(상단 내비) · components · pages · analyst · report · minimal
├── backend/                   Backend (FastAPI + SQLAlchemy/Alembic + PostgreSQL/pgvector) — 모든 secret 은 여기 환경변수에만
│   ├── app/
│   │   ├── main.py            라우트 · 앱 조립      security.py  endpoint 정책(PUBLIC / PUBLIC_RATE_LIMITED / ADMIN_ONLY) · rate limit · CORS
│   │   ├── dart/              OpenDART client · 기업/재무/공시 · 사업보고서 문서 파싱 · D&A 주석 fallback(da_notes.py)
│   │   ├── normalization/     Raw 계정 → HistoricalData + DataQuality (규칙: rules.json — 프론트 TS 와 golden 테스트로 동치 검증)
│   │   ├── services/          Historical 조회(DB 우선 → OpenDART) · 재무 저장 · 분석/Report snapshot 저장
│   │   ├── rag/ · knowledge/  공시/PDF chunking · embedding · Hybrid 검색 · rerank · 사용자 PDF 업로드/삭제(삭제 토큰)
│   │   ├── ai/                LLM Gateway · Tool catalog(프론트 정책에서 export) · backend 검색 Tool · 상태 서명
│   │   ├── external/          시장·금리·뉴스 provider (production 에서는 development 등급 차단)
│   │   ├── report/            Report PDF (reportlab · 한글 폰트 · 차트)
│   │   └── db/                ORM 모델 · 세션
│   ├── alembic/               DB 마이그레이션 (컨테이너 시작 시 `alembic upgrade head`)
│   ├── scripts/               운영/검증 스크립트 (prod_smoke · 원본 계정 조사 · 평가 · PDF 검증)
│   └── tests/                 pytest (smoke/ 는 실제 API 를 쓰는 라이브 테스트 — 키가 없으면 skip)
├── scripts/                   프론트 도구 (TS): export-ai · export-normalization(규칙 내보내기) · 평가/QA 스크립트
├── docs/                      설계 · 단계별 보고 · 운영 문서 (아래 목차)
├── vercel.json · docker-compose.yml · .env.example   배포 / 로컬 실행 설정
└── README.md
```

### 문서 목차 (`docs/`)

| 문서 | 내용 |
|---|---|
| [`PUBLIC_PORTFOLIO_MODE.md`](PUBLIC_PORTFOLIO_MODE.md) | 공개 접근 정책(endpoint 별 PUBLIC / RATE_LIMITED / ADMIN) · rate limit · 업로드/삭제 정책 |
| [`STEP10_production.md`](STEP10_production.md) | 배포 구조 · 보안 · Health · 운영 절차 · 한계 |
| `STEP09*.md` | Report 아키텍처 · 템플릿 · 자동화 |
| `STEP08*.md` | AI Analyst · RAG · 외부 데이터 · Agent · Grounding · 평가 |
| `STEP06-*.md` | OpenDART 원본 계정 조사 · 다기업 검증 |

기능을 바꾸면 해당 문서와 위 구조/라우트를 함께 갱신합니다 (정책 변경은 `PUBLIC_PORTFOLIO_MODE.md`).

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

## Report Automation (STEP 09)
`/report` 에서 현재 Project snapshot 으로 Valuation Report 를 생성·Preview 하고 PDF/HTML/JSON 으로 내보낸다. PDF 는 backend(`POST /api/report/pdf`, reportlab)가 만들며 한글 폰트 전략은 `backend/app/report/fonts.py` 참고. 자세한 내용: `docs/STEP09_report_automation.md`. QA: `node scripts/report-qa.ts <dir>` 후 `backend/.venv/bin/python backend/scripts/verify_report_pdf.py <dir>`.
