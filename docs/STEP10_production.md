# STEP 10 Production

> 범위 메모: 이 저장소에는 Vercel 설정(`vercel.json`) · `.vercel/` · 서버리스 진입점(`api/`) · 배포 이력이 **없었고**, Vercel CLI 와 계정 접근도 이 작업 환경에는 없었다. 따라서 "기존 Vercel 배포가 지금 무엇을 서비스하는가"는 코드로 확인할 수 없다 (§1). 아래의 production 검증은 **production 모드로 띄운 로컬 환경(실제 PostgreSQL + pgvector, `APP_ENV=production`)** 에서 한 것이고, 공개 URL smoke 는 §10 의 스크립트로 배포 후 실행한다.

## 1. Existing Deployment Audit (코드 · 설정 기준)

| Component | Local | Current Production (저장소에서 확인되는 것) | Gap |
|---|---|---|---|
| React/Vite | `npm run dev` (vite proxy `/api` → 127.0.0.1:8000), HashRouter | `vercel.json` · `.vercel` · 배포 URL 기록 없음. 정적 빌드(`dist`)는 어떤 정적 호스트에서도 동작 | 저장소에 배포 설정이 없었음 → `vercel.json`(보안 헤더) · `.env.example` 추가. API 주소를 빌드 때 주입하는 `VITE_API_BASE_URL` 도입 |
| FastAPI | `uvicorn app.main:get_app --factory` | 서버리스 진입점 없음. 코드 주석에 serverless 를 고려한 DB pool 설정(`DB_POOL_SIZE=2`, `DB_POOL=null`)만 있음 | backend 를 올릴 호스트가 코드에 정의되어 있지 않았음 → `backend/Dockerfile` 추가 |
| PostgreSQL | docker-compose `pgvector/pgvector:pg17`, `DATABASE_URL` | 연결은 `DATABASE_URL` 하나로 vendor 중립. 없으면 DB 없이 동작 | production 용 migration 절차 · 새 테이블 필요 → 0004 |
| pgvector | alembic 0002 가 `CREATE EXTENSION vector` | 호스트가 extension 을 허용해야 함 | managed DB 선택 조건으로 문서화 |
| OpenDART | `DART_API_KEY` (backend only) | 환경변수로만 읽음 | 변경 없음 |
| OpenAI | `OPENAI_API_KEY` (backend only) | 환경변수로만 읽음 | 변경 없음 |
| RAG | Hybrid + 선택적 cross-encoder reranker (`RERANKER=auto` → fastembed 가 있으면 로컬 모델 ~1.1GB) | reranker 는 선택 의존성이라 기본 설치에는 없음 | production 기본값을 `none` 으로 (§7) |
| PDF Upload | 20MB · MIME · `%PDF-` · SHA-256 중복 · 원본 미보관 | **인증 없음** (README 에 "공개 전 보호 필요"라고 적혀 있었음) | access key · rate limit 추가 (§6) |
| PDF Export | 없었음 (STEP 09 신규) | reportlab + 한글 폰트 필요 | 컨테이너에 `fonts-nanum` 설치 (§8) |
| External Tools | Yahoo · FRED · Google News (development 등급) | `APP_ENV=production` 이면 development provider 차단 → Tool unavailable | 정책 유지. 공식 provider 는 아직 없음 (§5) |

## 2. Architecture Decision

**선택: Option B — Vercel(정적 frontend) + 별도 컨테이너 호스트의 FastAPI + managed PostgreSQL(pgvector).**

| 기능 | Serverless(Vercel Functions) 제약 | 판단 |
|---|---|---|
| 긴 Agent Workflow (Full Review ~48초) | 요청 시간 제한 · cold start | 컨테이너가 안전 |
| reportlab + 한글 폰트 | OS 폰트 설치 불가/번들 크기 | 컨테이너에 `fonts-nanum` |
| PDF 업로드 · pypdf 추출 · embedding | 요청 본문 크기 · 시간 | 컨테이너 |
| 로컬 reranker(~1.1GB) | 번들 한도 초과 | 어느 쪽이든 production 에서는 끔 |
| in-memory rate limit · 캐시(corp code, provider) | instance 마다 따로 | 단일 컨테이너가 가장 단순 |

- Frontend 는 정적 번들이라 Vercel 에 그대로 올릴 수 있다 (기존 배포를 갈아엎지 않는다). 다른 origin 의 API 를 부르므로 `VITE_API_BASE_URL` + backend `CORS_ORIGINS`.
- 호스트 후보(코드는 특정 vendor 에 묶이지 않는다): Render / Fly.io / Cloud Run / Railway. DB: pgvector 를 허용하는 managed PostgreSQL(Neon · Supabase 등). **실제 선택과 배포는 운영자가 한다** (이 환경에는 계정 · 자격 증명이 없다).
- 비용: 컨테이너 1개 + 소형 DB + OpenAI 호출. 비용이 드는 API 는 §6 의 보호 대상.

## 3. Environment / Secrets

`backend/.env.example` (backend), `.env.example` (frontend) 참고. 값은 저장소에 없다.

| 변수 | 위치 | 역할 |
|---|---|---|
| `APP_ENV` | backend | `production` 이면 development provider 차단 · `/docs` 닫힘 · reranker 기본 none · ACCESS_TOKEN 없으면 보호 API 잠김 |
| `DART_API_KEY` | backend secret | OpenDART |
| `OPENAI_API_KEY` | backend secret | AI Analyst · embedding |
| `AI_STATE_SECRET` | backend secret | Agent 상태 HMAC (없으면 OPENAI_API_KEY 에서 파생) |
| `DATABASE_URL` | backend secret | PostgreSQL(+pgvector). `sslmode=require` 권장 |
| `ACCESS_TOKEN` | backend secret | demo access key (비용 · 쓰기 API 보호) |
| `CORS_ORIGINS` | backend | frontend origin 목록 |
| `TRUST_PROXY` · `RATE_LIMIT_DISABLED` · `MAX_UPLOAD_MB` | backend | 보호 · 한도 |
| `DB_POOL_SIZE` · `DB_MAX_OVERFLOW` · `DB_POOL` | backend | 연결 pool (pooler 사용 시 `null`) |
| `RERANKER` · `RERANKER_API_KEY` · `RERANKER_MODEL` · `RERANK_*` | backend | reranker (기본: production none) |
| `OPENAI_MODEL` · `OPENAI_EMBEDDING_MODEL` · `RETRIEVAL_MIN_SCORE` | backend | 모델 · 검색 |
| `EXTERNAL_DATA` · `MARKET_DATA_PROVIDER/API_KEY` · `NEWS_PROVIDER/API_KEY` · `*_TTL_SECONDS` | backend | 외부 provider |
| `REPORT_FONT_REGULAR` · `REPORT_FONT_BOLD` | backend | PDF 한글 폰트 경로 |
| `VITE_API_BASE_URL` | frontend (공개) | backend 공개 주소. **secret 아님** |

정책(테스트로 고정): `VITE_*` 에 KEY/SECRET/TOKEN/PASSWORD 금지 · 소스/빌드 결과에 credential 이름 없음 · 모든 secret 은 로그 redaction 대상(`ACCESS_TOKEN` 포함) · `/api/health` 는 설정 여부(bool)만 · 키가 없으면 그 기능만 unavailable. 주의: `load_settings` 는 환경변수가 비어 있으면 `backend/.env` 로 대체하므로, 로컬에서 "키 없음"을 재현하려면 `.env` 를 옮겨야 한다.

## 4. Database / Persistence

- 모델: SQLAlchemy, migration: Alembic 0001~**0004**. **빈 DB 에서 처음부터 적용됨을 테스트로 확인** (`test_migrations_apply_from_empty_database`: pgvector extension, 새 테이블, head=0004). 실제 PostgreSQL(pgserver)에서 `alembic upgrade head` 후 서버를 재시작해도 저장된 분석이 남음을 production 모드 smoke 로 확인.
- 연결: `DB_POOL_SIZE=2` · `DB_MAX_OVERFLOW=0`(기본), pooler 면 `DB_POOL=null`, `pool_pre_ping`, `pool_recycle=300`. SSL 은 `DATABASE_URL` 의 `sslmode`.
- 시작 동작: Dockerfile 이 `alembic upgrade head` 후 uvicorn 실행 (단일 instance 기준; 여러 instance 로 늘리면 migration 을 배포 단계로 분리).
- **신규 영속화** (`0004`):
  - `ai_analysis_runs`: 검증된 AI 분석(claim · evidence 요약 · limitations, `contextSnapshotId`, 회사). **저장하지 않음**: Tool 원문(`rawResult` 등), 문서 발췌(`excerpt`), credential(저장 전 값 검사로 거부).
  - `report_snapshots`: ReportModel snapshot + template version. 같은 model 로 Preview/PDF 를 다시 만든다 (`reopenReport`, QA 통과 테스트).
  - API: `POST/GET /api/analyses`, `GET /api/analyses/{id}`, `POST/GET /api/report-snapshots`, `GET /api/report-snapshots/{id}` (access key 필요, DB 없으면 `503 persistence-unavailable` → 화면은 세션 메모리로 계속).
  - UI: Report 화면에서 저장된 분석(저장됨 · current/stale 표시, stale 은 자동 선택 안 함)을 선택하고, 저장된 Report 를 "열기"로 재현한다. 새로고침 뒤에도 유지.
- 범위 밖: conversation product(대화 이력 전체) 저장.

## 5. Production Providers

- Financial Actual: OpenDART / ValuFlow (변경 없음).
- `APP_ENV=production` → Yahoo · FRED · Google News 는 차단되어 해당 Tool 이 `unavailable` (production 모드 smoke 에서 4개 provider 모두 "not allowed when APP_ENV=production" 확인). **몰래 fallback 하지 않는다.** Tool 계약(`getMarketData` · `getMarketAssumptions` · `getComparableCompanies` · `searchCompanyNews`) 불변.
- 표시 문구: "Current market reference provider is unavailable in production until an approved provider is configured." (README · 문서). Report 의 Market & Peer Reference section 은 evidence 가 없으면 자동 제외.
- **한국은행 ECOS 는 구현하지 않았다**: 통계표/항목 코드와 이용 조건을 공식 문서로 확인하지 못했다 (STEP 08-4 의 판단 유지; 이번에도 검색으로 코드를 확인하지 못함). 추측 구현 금지 원칙.
- 공식 provider 연결 지점: `app/external/providers.py` 의 Provider Protocol 에 `tier=production` provider 를 등록하면 게이트가 풀린다.

## 6. Security

- **Access key (demo access)**: 비용 · 쓰기 API(`/api/ai/*`, 업로드/삭제/재인덱싱, 공시 수집, `/api/companies/refresh`, Report PDF, 분석/Report 저장 · 조회)는 `X-ValuFlow-Access` 헤더가 `ACCESS_TOKEN` 과 같아야 한다 (`hmac.compare_digest`). **production 에서 `ACCESS_TOKEN` 이 없으면 이 API 들은 403 으로 잠긴다.** development 에서 토큰이 없으면 열려 있다. 읽기 조회(기업 검색 · Historical · health)는 공개. 프론트: 상단 "Access key" 입력(탭 `sessionStorage` 에만 저장, `/api/*` 요청에만 첨부, 번들에 값 없음).
- 잘못된 키를 반복하면 그 client 는 올바른 키도 잠시 429 (추측 시도 차단).
- **Rate limit** (process 메모리, 창별): ai 30/분 · upload 8/10분 · ingest 6/10분 · report 20/분 · persist 60/분 · OpenDART 조회 90/분 · 잘못된 키 20/10분. 한계: instance 가 여러 개이거나 재시작하면 한도가 분리/초기화된다 (단일 컨테이너 기준 설계).
- **요청 크기**: 기본 1MB · 업로드 `MAX_UPLOAD_MB`+1MB · Report 8MB · 저장 2MB (Content-Length 로 선검사, 본문 없는 보호 API POST 는 411). 질문 2000자(기존). 저장 payload 는 분석 600KB · Report 1.5MB.
- **PDF 업로드**: 크기 · 빈 파일 · MIME · `%PDF-` 서명 · 손상 파일 · SHA-256 중복 · 파일명은 표시용(저장 경로에 쓰지 않음) · 원본 미보관 (기존, 테스트 유지) + 위 access key/rate limit. 문서 소유권/접근 정책: **사용자별 분리 없음**(공유 데모) — 한계로 명시.
- **CORS**: production 은 `CORS_ORIGINS` 의 origin 만 (비면 CORS 미개방), development 는 localhost 만. 허용 메서드 GET/POST/DELETE.
- **오류 노출**: 예기치 못한 예외는 `unknown` 정제 응답 + 로그에는 예외 *종류*와 request id 만. 테스트가 traceback · SQL · 키 · 내부 경로 비노출을 확인. production 에서 `/docs` · `/openapi.json` 닫힘.
- **로그**: 구조화 access log(JSON: requestId · method · route 템플릿 · status · durationMs · bucket)에 본문 · query · 토큰 · 문서 내용 없음. 기존 redaction 이 모든 credential 값을 가림.
- Frontend 헤더(`vercel.json`): nosniff · X-Frame-Options · Referrer-Policy · Permissions-Policy. CSP 는 API origin 이 배포마다 달라 설정하지 않았다 (한계).

## 7. RAG Production Policy

- **Hybrid 가 production 기본, Reranker 는 optional(기본 off).** 근거: 로컬 cross-encoder 는 모델 ~1.1GB · CPU 지연(평균 ~2.0초 vs Hybrid 0.26초) · 서버리스/소형 인스턴스 부적합 · 라이선스 제약. STEP 08 평가에서 nDCG@5 는 Hybrid 0.82 vs +Reranker 0.79 로 Hybrid 가 낮지 않았다 (Hit@1 은 Reranker 가 1.00 vs 0.88 — 표본이 작아 일반화 금지). `APP_ENV=production` 이고 `RERANKER` 를 지정하지 않으면 `none`; 명시하면 따른다 (Cohere 등 API reranker 는 선택).
- Embedding: OpenAI(backend 에서만 호출), pgvector 정확 검색(회사 단위 필터 후 비교). reindex 엔드포인트 유지(보호 대상). 중복 업로드는 SHA-256 으로 차단. 원본 PDF 는 저장하지 않고 chunk 만 저장.

## 8. PDF Production

- `backend/Dockerfile` 이 OS 패키지 `fonts-nanum` 을 설치 → `app/report/fonts.py` 후보 경로(`/usr/share/fonts/truetype/nanum/NanumGothic.ttf`)에서 임베드(subset). 없으면 CID 폴백(`X-Report-Font: cid-fallback`, health 의 `reportService.font`). **폰트 파일은 저장소에 없다.** `REPORT_FONT_REGULAR/BOLD` 로 경로 지정 가능.
- 검증(production 모드 로컬): 한글 임베드, 표 · 차트 · Sources · Appendix 포함, 11쪽 / ~110ms / 108KB (`scripts/report-qa.ts` + `backend/scripts/verify_report_pdf.py`: key text 232/232). Docker 이미지 안에서의 폰트 경로는 이 환경에 Docker 가 없어 **이미지로는 검증하지 못했다** (경로는 Debian 패키지 기준).
- 메모리/타임아웃: 11쪽 보고서 기준 동기 처리로 충분, 큰 Report 의 비동기 생성은 범위 밖. Report 8MB 상한 · 3000 block 상한.

## 9. Health / Observability

`GET /api/health`: `status`(ok | degraded) · `version` · `appEnv` · `database`(ok | unavailable | not-configured) · `dartConfigured` · `aiConfigured` · `ragAvailable` · `persistenceAvailable` · `reportService{available,font}` · `accessProtection`(open | token | locked) · `externalProviders`(등급 · note). 값/연결 문자열/계정은 없음(테스트). DB 장애 시 `degraded` 이고 오류 내용은 노출하지 않는다. 구조화 로그와 request id(`X-Request-ID`, 응답 헤더)로 요청을 추적한다. workflow id · tool failure 는 기존 audit(metadata only, Tool 원문 미저장)를 따른다. 메트릭 · 알림은 없다.

## 10. Deployment Runbook (운영자가 실행)

```bash
# 1) DB: pgvector 를 허용하는 managed PostgreSQL 생성 → DATABASE_URL 확보
# 2) backend 컨테이너 호스트에 배포
docker build -t valuflow-api backend      # 이 환경에는 Docker 가 없어 빌드하지 못했다
#    환경변수: APP_ENV=production DART_API_KEY OPENAI_API_KEY AI_STATE_SECRET DATABASE_URL ACCESS_TOKEN CORS_ORIGINS=https://<frontend> TRUST_PROXY=true
# 3) frontend: Vercel 에 연결, 환경변수 VITE_API_BASE_URL=https://<backend>  → 빌드/배포
# 4) 공개 URL smoke
cd backend && .venv/bin/python -m scripts.prod_smoke https://<backend> --token "$ACCESS_TOKEN" --origin https://<frontend>
```
브라우저 smoke(Dashboard → Workspace → Historical → Valuation → AI(Historical · WACC · 공시 RAG · Mixed) → PDF 업로드/검색/page citation → Report 생성 · Preview · Sources · PDF)는 실제 키가 있는 배포본에서 수동으로 한다.

## 11. Production-like 검증 결과 (이 환경)

실제 PostgreSQL(pgserver) + `APP_ENV=production` + ACCESS_TOKEN + CORS 로 uvicorn 을 띄우고 `prod_smoke` 실행: **12/12 PASS** (health 비밀 미노출 · `/docs` 닫힘 · token 없는 보호 API 401 · Report PDF · 정제된 오류 · 분석 저장→조회 · CORS 허용/거부), migration 빈 DB 적용, 서버 재시작 후에도 저장 유지, production 에서 4개 external provider 차단, token 이 있으면 AI 가 응답(로컬 `.env` 의 실제 키 사용).
실패 시나리오: missing provider(위) · invalid PDF · 손상 파일 · unavailable retrieval · unsupported company · stale AI 분석 · no valuation(Blocked) · report warning 은 기존 단위/통합 테스트(STEP 06~09)로 회귀 확인. 키를 일부러 제거한 staging 은 로컬 `.env` 가 대체하므로 별도로 하지 않았다.

## 12. Acceptance

| 기준 | 결과 | 근거 |
|---|---|---|
| core valuation mismatch = 0 | PASS | Report QA numerical 108/108 (Engine↔Report), Engine golden 테스트 |
| hidden fixture fallback = 0 | PASS | 빈/불완전 Project 는 Blocked (e2e · UI 테스트) |
| unsupported numerical claim = 0 · hallucinated source = 0 · unit error = 0 · prior company leak = 0 | PASS (오프라인) | Guardrail 17/17, STEP 08 live acceptance(기록) — 이번 STEP 에서 live LLM 은 다시 돌리지 않음 |
| report numerical mismatch = 0 · orphan source = 0 · preview/PDF key value mismatch = 0 | PASS | QA 718 · PDF key text 232/232 |
| frontend secret exposure = 0 | PASS | credential 가드 테스트 · dist 검사 · `.env.example` 검사 |
| unauthorized expensive action 정책 | PASS | access key · rate limit · 크기 제한 (test_security) |
| raw internal error exposure = 0 | PASS | test_security · prod_smoke |
| DB persistence · migration · refresh 후 persisted | PASS (로컬 production 모드) | test_snapshots · prod 재시작 smoke · 프론트 병합/재현 테스트 |
| **deployed URL smoke passes** | **미실행** | 배포 접근 권한이 없음 — §10 의 절차로 운영자가 실행 |

## 13. Remaining Limitations

고쳐야 하는 것: 실제 공개 배포 + 공개 URL smoke · 브라우저 end-to-end(실제 키) QA · Docker 이미지 빌드/폰트 경로 확인 · 공식 market/peer/news provider · ECOS(또는 다른 공식 Rf 출처) 확인 후 연결.
포트폴리오 범위 밖: 실제 인증/사용자별 격리 · 분산 rate limit(Redis 등) · 대용량 Report 비동기 생성 · 메트릭/알림 · CSP · 더 큰 평가 데이터셋 · 대화 이력 영속화.
