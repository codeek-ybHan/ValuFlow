# STEP 08-3 공시 Retrieval 평가 (삼성전자 사업보고서 2025.12, 실제 OpenDART + text-embedding-3-small)

문서: 접수번호 20260310002820 → 829 chunk (평균 ~960자, 최대 1,469자). 평가 질의 7개, Top-5 안에 관련 section/문장이 들어오는지 (엄격한 정규식 기준).

| 질의 | vector 만 | hybrid(vector + keyword) | hybrid Top-1 section |
|---|---|---|---|
| 설비투자 | rank 4 | **rank 1** | II. 사업의 내용 > 3. 원재료 및 생산설비 |
| 반도체 수요 | MISS | rank 3 | I. 회사의 개요 > 1. 회사의 개요 |
| 재고 | rank 1 | rank 1 | III. 재무에 관한 사항 > 8. 기타 재무에 관한 사항 |
| 주요 위험 | rank 1 | rank 1 | II. 사업의 내용 > 5. 위험관리 및 파생거래 |
| 연구개발 | rank 1 | rank 1 | II. 사업의 내용 > 6. 주요계약 및 연구개발활동 |
| 메모리 사업 | rank 1 | rank 1 | II. 사업의 내용 > 7. 기타 참고사항 |
| 환율 리스크 | rank 1 | rank 1 | IV. 이사의 경영진단 및 분석의견 > 6. … |

- vector 5/7 → (표 chunk 가중치 · 동의어 · min_score 0.3 적용 후) 6/7, **hybrid 7/7**. 개선 요인: 표 위주 chunk 의 가중치 0.5, 공시 용어 동의어(설비투자 ↔ 시설투자 등), 질의어 2개 이하는 모두 포함해야 keyword 후보.
- 한계: 관련 없는 질의("우주 정거장 건설 일정")도 cosine 0.37 로 임계값(0.3)을 넘는다. 임계값만으로는 도메인 밖 질의를 걸러낼 수 없어, 모델이 발췌가 질문에 답하는지 판단하도록 지시하고 score · matchedBy 를 함께 전달한다 (실제 LLM 확인: "공시 내역에서 확인되지 않았습니다"로 답함).
- 재현: `cd backend && .venv/bin/python -m scripts.eval_disclosure_retrieval 5`
