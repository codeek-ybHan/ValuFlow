# 평가 근거와 재현 범위

## 코드로 확인할 수 있는 근거

| 검증 대상 | 구현 / 검사 |
|---|---|
| 결정적 계산·입력 검증 | `src/valuation/engine.ts`, `src/valuation/dcf.test.ts` |
| 원본에 없는 D&A·연결/별도·단위 | `backend/tests/test_da_notes.py` |
| 문서 검색 도구 제한 | `src/ai/retrievalRoute.ts`, `src/ai/retrievalRoute.test.ts` |
| 최종 답변 독립 검사 | `src/ai/eval/finalCheck.ts` |
| Guardrail | `src/ai/eval/guardrails.ts`, `scripts/eval-guardrails.ts` |

## 과거 live 평가

[상세 보고](STEP08-8_evaluation.md)의 40문항·84회 결과는 당시 실행 환경의 관찰입니다. 개발 중 분류기를 수정했고, 검색 질의 수가 적으며 라벨이 독립 검수되지 않았습니다. 최종 오류 0건과 함께 first-pass 차단·재생성·fallback도 읽어야 합니다.

기존 보고서의 모든 원시 실행 JSON을 이 문서 작성 과정에서 재검증한 것은 아닙니다. CI는 live LLM·실제 OpenDART 호출을 재현하지 않으며, CI 성공을 과거 live 성능 수치의 재측정으로 해석하지 않습니다.

## 다음 live 실행의 산출물 규칙

각 실행은 `commit SHA / 실행일 / 모델 ID / 프롬프트 버전 / 데이터와 문서 버전 / 질문 ID / 최종 답변 / Tool trace / fallback / 지연 / 토큰·비용`을 보존합니다. 키·원문 개인정보는 제거하고, 원시 JSON과 집계 표를 함께 연결합니다. 개발셋과 보류 평가셋을 분리하고 보류셋 결과는 별도로 보고합니다. 아직 확보하지 않은 결과는 PASS로 적지 않습니다.

## 오프라인 재현

```bash
nvm use
npm ci
npm test
npm run build
cd backend
python -m pip install -r requirements-dev.txt -c constraints-ci.txt
# 비어 있는 전용 PostgreSQL/pgvector 테스트 DB를 지정합니다.
# TEST_DATABASE_URL=postgresql+psycopg://... python -m pytest --ignore=tests/smoke -q
```

테스트가 테이블을 초기화하므로 운영 DB를 지정하면 안 됩니다. GitHub Actions는 별도 PostgreSQL/pgvector 서비스 컨테이너를 사용합니다. 키가 필요한 smoke 테스트는 CI 대상에서 제외합니다.
