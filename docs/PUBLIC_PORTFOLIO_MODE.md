# Public Portfolio Mode

ValuFlow 는 공개 포트폴리오 프로젝트이므로 방문자가 **access key 없이** 핵심 기능을 체험한다. 새 인증 시스템은 만들지 않았고, 비용이 드는 기능은 IP 기반 rate limit · payload 제한으로, 쓰기/운영 기능만 관리자 key 로 보호한다. (정책 코드: `backend/app/security.py` 의 `policy()`)

## 1. Endpoint Access Policy

| Endpoint | Policy | bucket · 한도 (IP 당) |
|---|---|---|
| `GET /api/health` | PUBLIC | – |
| `GET /api/companies` (기업 검색) · `GET /api/companies/{corp}` | PUBLIC | – |
| `GET /api/companies/{corp}/historical` · `/financials` · `/disclosures` | PUBLIC | dart · 90/min |
| `GET /api/knowledge/documents` (문서 목록) | PUBLIC | – |
| `POST /api/ai/query` (AI Analyst 질문, 공시/PDF RAG 포함) | PUBLIC_RATE_LIMITED | ai · **10/hour** |
| `POST /api/ai/tool-result` · `/api/ai/regenerate` (한 질문 안의 후속 왕복) | PUBLIC_RATE_LIMITED | ai-step · 80/hour |
| `POST /api/knowledge/documents` (PDF 업로드 · indexing) | PUBLIC_RATE_LIMITED | upload · **2/hour** |
| `POST /api/report/pdf` (Report PDF Export) | PUBLIC_RATE_LIMITED | report-pdf · **4/hour** |
| `DELETE /api/knowledge/documents/{id}` · `POST …/{id}/reindex` | ADMIN_ONLY | admin · 60/min |
| `POST /api/companies/{corp}/disclosures/ingest` · `POST /api/companies/refresh` | ADMIN_ONLY | ingest · 6/10min |
| `POST /api/companies/{corp}/historical/renormalize` · `GET /api/companies/{corp}/fetches` | ADMIN_ONLY | admin |
| `POST/GET /api/analyses…` (AI 분석 persistence) | ADMIN_ONLY | persist · 60/min |
| `POST/GET /api/report-snapshots…` (Report snapshot persistence) | ADMIN_ONLY | persist · 60/min |

Report Preview 는 브라우저에서 만들어지므로 backend endpoint 가 없다 (항상 공개). Market/News 데이터는 production 에서 Provider 게이트가 막는다 (아래 §5).

- AI 질문 한도(10/hour)는 **질문 단위**다: `query` 만 질문 한도를 쓰고, 한 질문 안의 Tool 왕복(`tool-result`, `regenerate`)은 별도 bucket 이다. Tool call 상한(`AI_MAX_TOOL_CALLS`, Agent `AI_AGENT_MAX_TOOL_CALLS`)은 그대로 유지된다.
- 공시 RAG 는 별도 endpoint 없이 AI 질문 안의 backend Tool 로 동작하므로 AI 한도를 공유한다. **질문이 새 공시 ingestion 을 일으키지 않는다** (`ingest` 는 ADMIN_ONLY). 수집된 공시에 없으면 "현재 수집된 공시에서 확인할 수 없습니다" 계열로 답한다 (기존 no-result 문구).
- 429 응답: `{"error":{"code":"rate-limited","message":…}}` + `Retry-After`. AI: "Demo AI 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
- 관리자 endpoint 를 key 없이 호출하면 401 (`access-required`), production 에서 `ACCESS_TOKEN` 이 비어 있으면 403 (`access-not-configured`). 잘못된 key 를 반복하면 429 (추측 시도 차단).

## 2. 방문자 UI

- Access key 입력창 · "Key required" 문구 제거 (`AccessKeyControl`, `data/access.ts` 삭제). 모든 `/api` 요청에 access 헤더가 붙지 않는다.
- 작은 안내만 표시: "Public portfolio demo — AI and upload usage is rate-limited."
- Frontend bundle 에 `ACCESS_TOKEN` 이 없다 (가드 테스트 + `dist` 스캔).

## 3. User PDF Upload (공개 + 강한 제한)

- PDF 만 (Content-Type + `%PDF-` 서명), 빈 파일/손상/암호 PDF 거부, 파일명은 표시용으로만 정리하고 저장 경로에 쓰지 않음, SHA-256 중복은 기존 문서를 돌려줌 (재 embedding 없음).
- 크기 `MAX_UPLOAD_MB` 기본 **20MB** (multipart 여유 포함 선검사 → 413), IP 당 **2회/hour**, 업로드 문서 총 **30개** 상한(`MAX_USER_DOCUMENTS`, 초과 시 409 `document-limit`; 이미 있는 파일은 상한과 무관하게 기존 문서를 돌려줌).
- 공개 사용자는 **upload 와 질문까지만** 가능하다. 삭제/재인덱싱은 사용자별 소유권이 없어 ADMIN_ONLY.

## 4. Persistence

- 공개 화면: AI 분석 · Report 는 **세션 메모리**에만 있다 (새로고침하면 사라짐). Saved reports UI 와 저장 호출을 숨겼다 (`defaultPersistence()` = null).
- 관리자: `ai_analysis_runs` · `report_snapshots` 코드와 API 는 삭제하지 않았다. `X-ValuFlow-Access` 헤더로 운영자가 직접 호출한다 (`scripts.prod_smoke --token`). 이유: 현재 multi-user auth / ownership 이 없어 공개 persistence 는 다른 방문자의 데이터 노출 위험이 있다.

## 5. Production Provider (변경 없음)

`APP_ENV=production` 에서 Yahoo · FRED(secondary) · Google News development provider 는 계속 차단된다. 공개로 전환해도 다시 켜지 않는다. Market/News 가 없으면 limitation 으로 표시된다.

## 6. Health

`/api/health` 의 `accessProtection` 은 제거했다 (전체 잠금처럼 읽혔다). 대신: `publicDemo: true` · `adminProtection: "token" | "locked" | "open"` (관리자 API 만 해당) · `rateLimit: "enabled" | "disabled"`. secret 값은 노출하지 않는다.

## 7. 유지하는 보안

요청 크기 제한 · CORS(production 은 `CORS_ORIGINS` 만) · 정제된 오류 · secret 필터링 · 구조화 로그(본문/query/token 없음, `policy` 필드 추가) · PDF 검증 · Tool budget · production provider 차단. Access key 를 없앤 것은 보안을 없앤 것이 아니라 **보호 방식을 key 에서 rate limit 으로 바꾼 것**이다.

## 8. 한계

- rate limit 은 process 메모리다: instance 가 여러 개이거나 재시작하면 한도가 분리/초기화된다 (분산 limiter 없음). proxy 뒤에서는 `TRUST_PROXY=true` 여야 방문자별로 구분된다 (아니면 한 IP 로 보여 한도를 함께 쓴다).
- 업로드된 PDF 는 모든 방문자가 검색하는 공유 저장소에 들어간다 (사용자별 분리 없음). 데모 한도(30개)와 관리자 삭제로 관리한다.
- IP 를 바꾸는 방문자는 한도를 우회할 수 있다 (비용 상한은 OpenAI 계정 쪽 예산 설정으로 별도 보호 권장).
