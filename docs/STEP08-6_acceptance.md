# STEP 08-6 Grounding Acceptance

대표 live 질문 4개 × 3회(실제 LLM `gpt-4.1-mini` + 실제 OpenDART · Yahoo · Google News provider, 삼성전자 golden Historical + 학습용 가정). 재현: backend 를 띄운 뒤 `node scripts/agent-acceptance.ts http://127.0.0.1:8000 3`.
커버리지는 모든 문장이 아니라 **핵심 claim 중 supported 비율**이다 (1.0 을 강제하지 않는다: partially-supported 는 근거가 다른 Tool 에서 왔거나 시점을 밝히지 않은 경우).

## 완료 기준 (최종 답변 기준, 12 runs)
| 기준 | 결과 |
|---|---|
| unsupported 숫자 claim | 0 |
| hallucinated source | 0 (first-pass 에서 모델이 지어낸 출처가 나온 run 이 있었고 제거되었다) |
| 잘못된 단위 환산 | 0 |
| unsupported company 이전 맥락 누출 | 0 |
| WACC 구성요소 의미 오류 | 0 |

## 결과 표
| 질문 | run | first-pass 커버리지 (claim 수) | first-pass 차단 위반 | 재생성 | 재생성 후 커버리지 | fallback | 최종 커버리지 (claim 수) |
|---|---|---|---|---|---|---|---|
| Historical | 1 | 1.00 (2) | - | 아니오 | - | 아니오 | 1 (2) |
| Historical | 2 | 0.50 (2) | ungrounded-number,ungrounded-text-number,ungrounded-text-number | 예 | 1.00 | 아니오 | 1 (1) |
| Historical | 3 | 1.00 (2) | - | 아니오 | - | 아니오 | 1 (2) |
| WACC | 1 | 0.80 (5) | - | 아니오 | - | 아니오 | 0.8 (5) |
| WACC | 2 | 1.00 (6) | - | 아니오 | - | 아니오 | 1 (6) |
| WACC | 3 | 0.60 (5) | - | 아니오 | - | 아니오 | 0.6 (5) |
| Disclosure | 1 | 1.00 (1) | - | 아니오 | - | 아니오 | 1 (1) |
| Disclosure | 2 | 1.00 (2) | - | 아니오 | - | 아니오 | 1 (2) |
| Disclosure | 3 | 1.00 (3) | - | 아니오 | - | 아니오 | 1 (3) |
| Mixed | 1 | 0.83 (6) | ungrounded-number | 예 | 1.00 | 아니오 | 1 (6) |
| Mixed | 2 | 0.67 (6) | ungrounded-claim,ungrounded-claim | 예 | 1.00 | 아니오 | 1 (4) |
| Mixed | 3 | 1.00 (5) | - | 아니오 | - | 아니오 | 1 (5) |

## 원인 분석 (Mixed 질문이 fallback / coverage 0.50 이었던 이유)
| 원인 | 종류 | 조치 |
|---|---|---|
| 모델이 KRW million → 억원 환산을 100~1000배 틀림 (요약 · claim 모두) | **Tool 계약**: 표시용 값이 없었다 | Tool 이 `display`(억원 · 조원 · 퍼센트 숫자 + 그대로 옮겨 쓰는 `*Text` 문자열)를 제공. first-pass 단위 착오 (6회 중 2회 → 이후 12회 전부 0). 프롬프트는 "환산하지 말고 인용"만 추가 |
| `26만 8,500원` 을 8,500원으로 읽음 | 검증기 파서 버그 | 만 단위 복합 금액 파싱 |
| `52주` 를 주식수(주)로 읽음 | 검증기 파서 버그 | 기간 표현 제외 |
| "Terminal Value 기여도 84.34%" 가 지표 불일치로 거절 | 용어 사전 · 절 경계 버그 | 용어 보강, 문장 경계(소수점 제외)에서 절 분리, 관련 지표 묶음 |
| 위험 claim 이 `validationWarnings` 를 인용했는데 근거 없음으로 처리 | **Evidence 계약**: 문장형 근거가 Evidence 가 아니었다 | Tool 경고 · 엔진 검토 경고 · 추세 방향을 정성 근거로 추출 (위험 · 해석은 내용이 관련 있을 때만 인정) |
| 인용한 문단 번호가 틀림 (results[4] 를 인용, 내용은 results[0]) | claim 계약 | 같은 Tool 의 다른 문단이 받치면 인정, 인용 오류는 `invalidRefs` 정보로 |
| 모델이 claim 을 9개까지 생성 | claim 정책 | 6개 권장 · 8개까지만 검증, 근거 없는 위험은 제거 |
| 서술형 변경 제안("재검토 권고") | 제안 계약 | 변경 제안은 현재 값 · 제안 값이 숫자여야 함 (live 에서 filtered=True 확인) |

재생성이 실패했던 경우(Disclosure 1회: 3개 claim 모두 `text-not-in-evidence`)는 모델이 다른 문단을 인용한 것이 원인이었고 위 "문단 번호" 보완 후 6회 연속 통과했다.

## 남은 한계
- 모델 출력은 비결정적이다: run 마다 claim 수와 first-pass 통과 여부가 달라지며(예: 첫 시도에서 재생성이 필요한 run 이 12회 중 3회), 재생성은 매번 위반을 해소했지만 보장은 아니다 (fallback 이 최후 방어선).
- 일시적인 OpenAI 5xx · timeout 은 1회 재시도한다. 그 이상은 `provider-error` 로 workflow 가 `failed` 가 된다 (한 번 관찰).
- 일반 질문(`runAiQuery`)에는 grounding 계층이 없다 (기술부채, README 참고).
