# STEP 08 요약 — ValuFlow AI Valuation Analyst

## Architecture

```
ValuFlow Engine (deterministic: Historical · Forecast · WACC · DCF · Sensitivity · Scenario · Relative)
        │  결과 · 단위 · 출처 · 품질 · 경고
Tool Layer (frontend: 9 deterministic Tool · backend: 7 retrieval / external Tool, 같은 계약 · Tool catalog)
        │
 ┌──────┴──────────┬──────────────────┐
 RAG (OpenDART + User PDF   External Data (Market · Rates   Agent Workflow (9 종 · 계획 · 관찰 ·
 · Hybrid + Reranker)       · Peer · News, provider 등급)    예산 · 사람 확인 지점 · partial failure)
 └──────┬──────────┴──────────────────┘
Grounded Analysis (Claim ↔ Evidence · source authority · 시점 · confidence · 교정 재생성 1회 · safe fallback)
        │
AI Analyst UI (Quick Answer / Deep Analysis · progress · claim · evidence · source · warning · checkpoint · PDF 관리)
        │
Evaluation / Guardrails (고정 질문 40개 · 지표 · Guardrail 스위트 17 · 라이브 반복 · 실패 사례 로그)
```

| STEP | 내용 | 평가 · 근거 문서 |
|---|---|---|
| 08-1 | AI architecture · Tool catalog · policy | `ai.test.ts` |
| 08-2 | Backend AI Gateway(Tool Calling, 서명된 state, Key 는 backend 에만) | `test_ai_gateway.py` |
| 08-3 | 공시 + 사용자 PDF RAG, Hybrid, Reranker | `docs/STEP08-3_unified_rag_eval.md` |
| 08-4 | 외부 Market / Peer / News Tool, provider 등급 | `docs/STEP08-4_provider_review.md` |
| 08-5 | Agent Workflow · Human checkpoint | `agent.test.ts` |
| 08-6 | Grounded Analysis · acceptance | `docs/STEP08-6_acceptance.md` |
| 08-7 | AI Analyst UI | README · 브라우저 QA |
| 08-8 | Evaluation & Guardrails | `docs/STEP08-8_evaluation.md` |

## Portfolio — 설명할 수 있어야 하는 10가지

1. **왜 LLM 에게 계산을 맡기지 않았는가** — 가치평가는 가정 하나가 결과를 크게 바꾸고 재현 가능해야 한다. 계산은 deterministic 엔진이 하고 LLM 은 Tool 결과를 해석한다. 실제로 모델은 KRW million → 억원 환산을 100~1000배 틀렸고(08-6), 그래서 환산 자체를 Tool 이 `display` 값/문자열로 준다. 단위 오류 0 은 프롬프트가 아니라 계약으로 얻었다.
2. **Tool Calling 구조** — frontend 는 Project 상태가 필요한 deterministic Tool, backend 는 검색 · 외부 Tool 을 실행한다. 모델은 Tool 이름과 입력만 고르고(기업 · 종목은 지정할 수 없다) 결과는 서명된 state 로 이어진다. write Tool 은 없고 요청돼도 실행하지 않는다.
3. **RAG 개선 과정** — Vector 단독 → Hybrid(BM25 + 공시 동의어 + 표 가중치) → Reranker. Hybrid 가 가장 큰 개선이었고 Reranker 는 1위를 바로잡지만 지연이 크고 항상 낫지는 않았다.
4. **Hybrid + Reranker 평가** — OpenDART nDCG@5 0.38 → 0.82 → 0.79, Hit@1 0.62 → 0.88 → 1.00, 지연 225 → 263 → 1996ms. 질의가 적고 라벨이 검수되지 않았다는 한계를 같이 적었다.
5. **Agent Workflow** — 업무별 계획(필수 · 선택 단계) · 관찰에 따른 추가 호출 · 예산 · 반복 호출 차단 · partial failure 시 가능한 범위로 계속. 자율 agent 가 아니라 분석가 보조다.
6. **Human checkpoint** — 변경 제안은 사람이 판단하고 이 단계에서는 어떤 결정도 Project 를 바꾸지 않는다. WACC 구성요소(Rf · Beta)와 WACC 직접 변경을 구분한다.
7. **Claim-Evidence grounding** — 핵심 claim 마다 Tool 결과의 구체적 값 · 문단에 연결하고, 숫자 · 단위 · 출처 · 시점 · Valuation 지표(엔진 값만)를 검증한다. 위반 시 1회 재생성 후 safe fallback. UI 는 Fact(객관 근거)와 Judgment(해석)를 다르게 표시한다.
8. **External provider reliability** — 비공식(Yahoo · Google News)과 공식을 구분해 표시하고, production 에서는 비공식 provider 를 차단한다. provider 값이 OpenDART 와 충돌하면 OpenDART 가 우선이다.
9. **실패 사례와 개선** — 평가가 드러낸 실제 빈틈: 문서 안의 EV 숫자 채택, system prompt 유출 미검출, Quick 요약의 근거 없는 숫자, 거짓 한계 안내, 라우팅 오분류 (`STEP08-8_evaluation.md` §12). 고치지 못한 것(fallback 9.5%, 부재 진술)도 같이 남겼다.
10. **Evaluation 결과** — 질문 40개 · 실행 84회: required Tool Hit 100%, unsupported 숫자 claim · hallucinated source · 단위 오류 · WACC 의미 오류 · injection 성공 · 유출 0, Guardrail 17/17, 교정 재생성은 12건 중 8건 해소, fallback 9.5%. 수치는 이 환경에서의 관찰이며 SLA 가 아니다.

## 이후 STEP 로 넘기는 것

실제 write Tool · 자동 Forecast / WACC 변경 · Report PDF · Slack/Notion · 배포는 STEP 09~10. 평가 데이터셋 · 지표 · Guardrail 스위트는 그때도 회귀 테스트로 쓴다(`npm test` 는 오프라인 부분을, `scripts/eval-live.ts` 는 라이브 부분을 실행한다).
