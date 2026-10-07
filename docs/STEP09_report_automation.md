# STEP 09 Report Automation (09-3 ~ 09-8)

## 1. Architecture
```
Project State ─ buildReportInput (deep-copy snapshot, ctx-… id) ─▶ ReportInput
  ─ buildReport (validation · narrative · sources · pruning) ─▶ ReportModel
  ─ ReportTemplate(valuation-standard-v1, 15 sections) ─▶ ReportDocument
  ─ buildPresentation ─▶ TableModel / ChartModel / KPI           (표시 문자열만, 계산 없음)
  ─ buildRenderModel ─▶ RenderModel (flat blocks, 이미 서식화된 text)
        ├─ HTML renderer (TS, inline SVG)  → Preview(UI) / HTML export
        ├─ PDF renderer (backend reportlab) → POST /api/report/pdf
        └─ JSON bundle (model · document · presentation · renderHash)
```
Preview · HTML · PDF · JSON 은 모두 같은 RenderModel/ReportModel 에서 나온다. Report 쪽에서 valuation 을 다시 계산하지 않는다 (Sensitivity/Scenario view 수집은 `buildReportInput` 한 곳).

## 2. Snapshot
생성 시점의 Project 를 deep copy 한다. `contextSnapshotId`(AI 분석과 같은 기준)·`valuationSnapshotId`·`inputHash` 를 Report/번들에 기록. 이후 Project 가 바뀌면 UI 가 "Report preview is based on an older project snapshot." 배너와 Regenerate 를 보여 준다. Report 생성은 Project 를 바꾸지 않는다.

## 3. Tables & Charts (09-3)
Table(Cell: state/value/unit/kind/text/largeText/sourceId), Chart(line/bar/grouped-bar/stacked-bar/waterfall/heatmap/range). 단위: 억원(조원 보조)·%·원/주·주·beta 무차원. Equity Bridge 는 명시적 −/+/= 연산자, Sensitivity 5×5 는 `valid`·`isBaseCase`(색이 아닌 "Base" 문구+굵은 테두리), Scenario 는 Bear→Base→Bull 고정, Range 는 Low/Base/High (midpoint 없음), Relative 는 입력 누락을 그대로 표시.

## 4. AI Narrative (09-4)
`buildNarrative` 는 supported · 같은 snapshot · source 추적 가능한 GroundedClaim 만 쓴다. claim→section 1:1, Fact/Judgment 구분, 새 숫자 없음. 제외된 claim 은 사유(stale-snapshot, unsupported, no-evidence …)와 함께 Appendix 에 남는다. AI 없이도 deterministic Report 가 생성된다.

## 5. Sources / Footnotes (09-5)
출처 종류: ValuFlow Engine · OpenDART · Disclosure · Uploaded PDF · Assumption · Market Data · Peer Data · News · Learning Fixture. `[S#]` 는 Registry 순서로 안정 부여, 표·서술·차트에 footnote, 문서 위치(접수번호·공시일·page·section)와 provider(official/valuationGrade/asOf)를 기록한다. 개발용 provider 는 "Development Source" 로 표시. Peer/Market 값은 선택한 AI 분석 Evidence snapshot 에서만 가져온다(외부 API 호출 없음). 숨겨진 section 에서만 쓰인 출처는 Sources 에서도 제외하고 번호를 다시 매긴다.

## 6. HTML / PDF (09-6)
- HTML: cover·banner·section·KPI·표·SVG 차트·Sources·Appendix, `@page A4`, page-break hint.
- PDF: reportlab, A4, 여백, `Page n / N`, header/footer, 표 머리글 반복, 북마크, 메타데이터(title/company/createdAt/schema/template version). 파일명 `ValuFlow_{Company}_Valuation_{YYYY-MM-DD}.pdf`.
- 폰트 전략(`backend/app/report/fonts.py`): `REPORT_FONT_REGULAR/BOLD` → OS 후보(Nanum, Noto Sans KR TTF, Malgun, AppleGothic, Arial Unicode) 임베드(subset) → 없으면 CID 폴백(`X-Report-Font: cid-fallback`, 한글 품질 보장 안 함). 폰트 파일은 저장소에 포함하지 않는다. 폰트에 없는 기호(예: −)는 대체한다.
- 오류: 내부 예외 내용은 노출하지 않고 `pdf-render-failed` 등 코드만 반환. RenderModel 버전/크기/block 종류 검증.

## 7. Report UI (09-7)
`/report`: 좌(설정·AI 분석 선택·선택 section 토글) / 중(Preview) / 우(Validation·Export·Snapshot). Generate → buildReportInput → validation → Preview. 빈 Project 는 Blocked(fixture 로 채우지 않음). 기본 AI 선택은 같은 snapshot 의 최근 Deep Analysis, stale 분석은 표시하되 자동 선택하지 않음. 필수 section 은 숨길 수 없음. `[S#]` 클릭 → Sources 강조. PDF 상태(생성 중/완료/오류+재시도), HTML·JSON 내보내기.

## 8. Validation (09-8)
`runReportQa`(src/report/qa/validate.ts): numerical(EV·Equity·주당·WACC·g·FCFF·PV·TV·Sensitivity·Scenario vs Engine, diff=0)·completeness·unit·label(Actual/Estimate)·source(orphan·unknown·unused)·narrative·snapshot·parity(RenderModel↔HTML↔JSON)·disclosure. mutation 테스트로 검사기가 오류를 실제로 잡는지 확인. PDF: `node scripts/report-qa.ts <dir>` → `backend/.venv/bin/python backend/scripts/verify_report_pdf.py <dir>`(key text 232/232, 한글·임베드·페이지번호·메타데이터).

### 측정 (참고용, SLA 아님; 로컬 개발 머신)
Report 생성(buildModel~html) ≈ 4–18ms, HTML 71KB, PDF 11쪽 108KB ≈ 110ms.

## 9. Failure cases
backend 미실행 → "ValuFlow 서버에 연결할 수 없습니다" + 재시도 · 한글 폰트 없음 → CID 폴백 고지 · 필수 데이터 없음 → Blocked · stale 분석 → 서술 제외(사유 기록) · 지원하지 않는 RenderModel 버전 → 422.

## 10. Remaining limitations
- 학습용 fixture/가정 기반 Report 이며 실제 가치평가 보고서가 아니다 (모든 출력에 고지).
- PDF 차트는 값 라벨만 있고 숫자 축 눈금은 없다(새 숫자 금지 정책).
- AI 분석은 AnalystTurn 메모리(세션)에만 있어 새로고침하면 선택할 수 없다.
- stale 배너는 단위·렌더 테스트로 검증했고, 브라우저에서 실제 편집→배너 흐름은 수동 검증하지 않았다.
- Peer/Market 값은 AI 분석 Evidence 가 있을 때만 포함된다. 서버 한글 폰트는 배포 환경에서 설치/지정해야 한다.

## 11. STEP 10 Production connection points
폰트 설치(`REPORT_FONT_*`) · PDF 엔드포인트 인증/rate limit · Report/AI 분석 영속화(DB) · 실제 Peer/Market provider(valuation-grade) 연결 · 템플릿 다중화(`getTemplate`) · 대용량 PDF 비동기 생성.
