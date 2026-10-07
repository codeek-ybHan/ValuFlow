# STEP 08-3 통합 RAG 평가 — Vector only vs Hybrid vs Hybrid + Reranker

환경: 실제 OpenDART(삼성전자 사업보고서 2025.12, 829 chunk) + 실제 OpenAI `text-embedding-3-small` + 로컬 cross-encoder `jinaai/jina-reranker-v2-base-multilingual`(CPU, 후보 15개).
User PDF: 같은 보고서의 '사업의 내용' 발췌를 reportlab 으로 24쪽 PDF 로 만들어 실제 업로드 경로(`KnowledgeService.upload_pdf`)로 넣은 문서(38 chunk). 외부 PDF 를 내려받지 않았으므로 *PDF 의 내용은 DART 원문이고 PDF 파일만 새로 만든 것*이다.
재현: `PYTHONPATH=. .venv/bin/python -m scripts.eval_knowledge_retrieval --db <dir> --out <md>` (RERANKER_CACHE_DIR 로 모델 캐시 위치 지정 가능)

## 방법과 한계
- 질의 8개(설비투자 · HBM · 반도체 수요 · 재고 · 환율 리스크 · 연구개발 · AI 수요 · CAPEX). 정답 chunk 가 없는 질의는 그 corpus 평가에서 제외한다.
- 라벨은 질의마다 (weak, direct) 정규식으로 corpus 전체 chunk 에 등급을 매긴 것이다 (0 무관 · 1 주제 언급 · 2 질문에 직접 답하는 서술). 검색 결과와 독립적으로 만들었지만 **사람이 검수한 라벨이 아니고** 질의 수가 적어(8/6) 소수점 차이는 의미가 약하다. 방식 간 *상대 비교*로만 읽어야 한다.
- 지표: Hit@1/Hit@5(등급≥1), MRR@10, nDCG@5(등급 0/1/2), P@5(상위 5개 중 등급≥1 비율).
- Reranker 의 표 chunk prior(0.75)는 같은 질의 8개로 3개 값(0.5 / 0.75 / 1.0)만 비교해 고른 값이라 과적합 가능성이 있다.

ingestion(OpenDART)={'corpCode': '00126380', 'listed': ['20260310002820'], 'ingested': [], 'skipped': ['20260310002820'], 'failed': []} | upload(PDF)=already-exists doc#2 chunks=38 pages=24

## OpenDART 사업보고서 (829 chunks)

| 방식 | Hit@1 | Hit@5 | MRR@10 | nDCG@5 | P@5 | 평균 지연(ms) |
|---|---|---|---|---|---|---|
| A. Vector only | 0.62 | 0.75 | 0.669 | 0.381 | 0.35 | 164 |
| B. Hybrid | 0.88 | 1.00 | 0.917 | 0.821 | 0.82 | 230 |
| C. Hybrid + Reranker | 1.00 | 1.00 | 1.000 | 0.790 | 0.85 | 2308 |

(질의 8개. g2 = 질문에 직접 답하는 서술, rank 는 top10 안에서 g2 chunk 의 순위)

- `설비투자` (정답 chunk g1=2, g2=2) → A: top1=g0 (XI. 그 밖에 투자자 보호를 위하여 필요한 사항 > 4. 작) · 직접답변 rank [4] | B: top1=g2 (II. 사업의 내용 > 3. 원재료 및 생산설비) · 직접답변 rank [1, 2] | C: top1=g2 (II. 사업의 내용 > 3. 원재료 및 생산설비) · 직접답변 rank [1, 5]
- `HBM` (정답 chunk g1=4, g2=6) → A: top1=g2 (XII. 상세표 > 4. 연구개발실적(상세)) · 직접답변 rank [1] | B: top1=g2 (XII. 상세표 > 4. 연구개발실적(상세)) · 직접답변 rank [1, 2, 3] | C: top1=g2 (IV. 이사의 경영진단 및 분석의견 > 3. 재무상태 및 영업) · 직접답변 rank [1, 2, 3]
- `반도체 수요` (정답 chunk g1=3, g2=3) → A: top1=g0 (II. 사업의 내용 > 7. 기타 참고사항) · 직접답변 rank - | B: top1=g0 (I. 회사의 개요 > 1. 회사의 개요) · 직접답변 rank [3] | C: top1=g2 (II. 사업의 내용 > 7. 기타 참고사항) · 직접답변 rank [1]
- `재고` (정답 chunk g1=11, g2=16) → A: top1=g2 (III. 재무에 관한 사항 > 8. 기타 재무에 관한 사항) · 직접답변 rank [1, 3, 4] | B: top1=g2 (III. 재무에 관한 사항 > 8. 기타 재무에 관한 사항) · 직접답변 rank [1, 2, 3] | C: top1=g2 (III. 재무에 관한 사항 > 8. 기타 재무에 관한 사항) · 직접답변 rank [1, 3, 4]
- `환율 리스크` (정답 chunk g1=24, g2=29) → A: top1=g2 (IV. 이사의 경영진단 및 분석의견 > 6. 그 밖에 투자의사) · 직접답변 rank [1, 2, 5] | B: top1=g2 (II. 사업의 내용 > 5. 위험관리 및 파생거래) · 직접답변 rank [1, 2, 3] | C: top1=g2 (IV. 이사의 경영진단 및 분석의견 > 6. 그 밖에 투자의사) · 직접답변 rank [1, 2, 3]
- `연구개발` (정답 chunk g1=4, g2=7) → A: top1=g2 (II. 사업의 내용 > 6. 주요계약 및 연구개발활동) · 직접답변 rank [1, 2] | B: top1=g2 (II. 사업의 내용 > 6. 주요계약 및 연구개발활동) · 직접답변 rank [1, 2, 8] | C: top1=g2 (II. 사업의 내용 > 6. 주요계약 및 연구개발활동) · 직접답변 rank [1, 4, 6]
- `AI 수요` (정답 chunk g1=55, g2=8) → A: top1=g2 (IV. 이사의 경영진단 및 분석의견 > 3. 재무상태 및 영업) · 직접답변 rank [1] | B: top1=g2 (IV. 이사의 경영진단 및 분석의견 > 3. 재무상태 및 영업) · 직접답변 rank [1, 2, 3] | C: top1=g1 (II. 사업의 내용 > 7. 기타 참고사항) · 직접답변 rank [2, 3, 4]
- `CAPEX` (정답 chunk g1=1, g2=3) → A: top1=g0 (III. 재무에 관한 사항 > 8. 기타 재무에 관한 사항) · 직접답변 rank - | B: top1=g2 (IV. 이사의 경영진단 및 분석의견 > 3. 재무상태 및 영업) · 직접답변 rank [1, 2, 4] | C: top1=g2 (II. 사업의 내용 > 7. 기타 참고사항) · 직접답변 rank [1, 2, 3]

## User PDF (38 chunks)

| 방식 | Hit@1 | Hit@5 | MRR@10 | nDCG@5 | P@5 | 평균 지연(ms) |
|---|---|---|---|---|---|---|
| A. Vector only | 0.67 | 0.67 | 0.667 | 0.458 | 0.20 | 182 |
| B. Hybrid | 1.00 | 1.00 | 1.000 | 0.955 | 0.60 | 213 |
| C. Hybrid + Reranker | 1.00 | 1.00 | 1.000 | 0.912 | 0.60 | 771 |

(질의 6개. g2 = 질문에 직접 답하는 서술, rank 는 top10 안에서 g2 chunk 의 순위)

- `설비투자` (정답 chunk g1=1, g2=1) → A: top1=g2 (p.8) · 직접답변 rank [1] | B: top1=g2 (p.8) · 직접답변 rank [1] | C: top1=g2 (p.8) · 직접답변 rank [1]
- `HBM`: 이 corpus 에 정답 chunk 가 없어 제외
- `반도체 수요` (정답 chunk g1=1, g2=1) → A: top1=g2 (p.24) · 직접답변 rank [1] | B: top1=g2 (p.24) · 직접답변 rank [1] | C: top1=g2 (p.24) · 직접답변 rank [1]
- `재고`: 이 corpus 에 정답 chunk 가 없어 제외
- `환율 리스크` (정답 chunk g1=2, g2=4) → A: top1=g2 (p.11) · 직접답변 rank [1] | B: top1=g2 (p.11) · 직접답변 rank [1, 2, 3] | C: top1=g2 (p.11) · 직접답변 rank [1, 2, 3]
- `연구개발` (정답 chunk g1=0, g2=8) → A: top1=g2 (p.15) · 직접답변 rank [1, 2, 3] | B: top1=g2 (p.15) · 직접답변 rank [1, 2, 3] | C: top1=g2 (p.15) · 직접답변 rank [1, 2, 3]
- `AI 수요` (정답 chunk g1=5, g2=2) → A: top1=- (-) · 직접답변 rank - | B: top1=g2 (p.20) · 직접답변 rank [1, 2] | C: top1=g1 (p.21) · 직접답변 rank [2, 4]
- `CAPEX` (정답 chunk g1=0, g2=2) → A: top1=- (-) · 직접답변 rank - | B: top1=g2 (p.8) · 직접답변 rank [1, 2] | C: top1=g2 (p.24) · 직접답변 rank [1, 2]

## 해석
1. **Vector → Hybrid 가 가장 큰 개선이다.** OpenDART nDCG@5 0.38→0.82, Hit@5 0.75→1.00. Vector 단독은 짧은 한국어 질의("설비투자", "CAPEX")에서 관련 없는 chunk 를 1위로 올리거나(top1=g0) 아예 놓친다. BM25 keyword 와 공시 동의어(설비투자↔시설투자)가 정확한 용어를 잡고, 표 chunk 가중치가 노이즈를 낮춘다. PDF 에서도 Vector 단독은 "AI 수요" · "CAPEX" 에서 결과가 없었다(min_score 미달).
2. **Reranker 는 1위를 바로잡는다 (Hit@1 0.88→1.00, MRR 0.92→1.00).** 대표 사례는 "반도체 수요": Hybrid 1위는 관련 없는 회사 개요(g0)였고 Reranker 가 '사업의 내용 > 기타 참고사항'(g2)을 1위로 올렸다.
3. **그러나 Reranker 가 항상 낫지는 않다.** nDCG@5 는 0.82→0.79 로 오히려 낮고, "AI 수요" 에서는 1위가 직접 답변(g2)에서 단순 언급(g1)으로 내려갔다. 이 cross-encoder 는 한국어 공시 문장에 대한 점수가 전반적으로 낮고(최고 ~0.35) 표(타법인출자 · 종속회사 현황)를 올리는 경향이 있어, 표 prior 를 정렬 점수에 반영해야 했다(0.5/1.0 에서는 nDCG 0.78/0.72, 0.75 에서 0.79).
4. **지연이 크다.** Reranker 는 후보 15개에 평균 ~2.3초(CPU)로 Hybrid(~0.2초)의 10배 이상이다. 에이전트 루프에서 검색이 2번이면 수 초가 추가된다. 지연이 중요하면 후보 수(`RERANK_CANDIDATES`)를 줄이거나 Cohere Rerank 같은 API reranker 를 쓴다.

## 실패 · 남은 한계
- 실패 사례: "AI 수요"(Reranker 가 1위를 g1 로 교체), 한 질의 "설비투자"는 표 prior 를 1.0 으로 두면 II.3 외의 chunk 가 2~5위를 차지했다.
- 정답 라벨이 정규식이라 의미상 정답이지만 패턴에 걸리지 않는 chunk 는 오답으로 센다.
- 도메인 밖 질의는 점수로 걸러지지 않는다(이전 단계의 한계 그대로). `RERANK_MIN_SCORE` 는 지원하지만 이 corpus 에서 임계값을 검증하지 않아 기본은 끈 상태다.
- 이 평가는 검색 품질이다. 최종 답변 품질은 별도 live smoke(E2E)로 확인했고 LLM 비결정성이 있다.
