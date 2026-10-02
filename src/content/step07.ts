import type { Step } from '../types';

export const step07: Step = {
  id: 7,
  code: 'STEP 07',
  title: 'AI Valuation Agent',
  short: 'AI Valuation Agent',
  subtitle: 'Tool Calling + RAG Agent',
  overview: ['정확한 계산은 Python Engine, 기업 문서는 RAG, 해석은 LLM 이 맡도록 Agent 를 구성하는 단계입니다.', { formula: 'Calculation → Python\nDocument Fact → RAG / Source\nInterpretation → LLM' }],
  goals: ['LLM 이 잘하는 일과 위험한 일을 구분한다.', 'Tool Calling 으로 계산을 Python 엔진에 위임한다.', '공시 문서 RAG 와 검색 품질 평가를 구현한다.', '답변의 근거(데이터·계산·공시)를 드러내고, 근거가 없으면 모른다고 답하는 정책을 만든다.'],
  lessons: [
    { id: 'l01', title: 'LLM을 어디에 써야 하는가?', summary: '잘하는 것 vs 맡기면 위험한 것.', outline: [{ list: ['잘하는 것: 자연어 이해, 설명, 요약, 정보 연결, Tool 선택, 보고서 작성', '위험한 것: 근거 없는 재무계산, 출처 없는 수치 생성, 공시에 없는 사실 추정'] }] },
    { id: 'l02', title: 'Tool Calling', summary: 'Agent 가 기능을 직접 호출.', outline: [{ list: ['get_financial_statement()', 'calculate_financial_ratios()', 'calculate_fcff()', 'calculate_wacc()', 'calculate_dcf()', 'run_sensitivity_analysis()'] }] },
    { id: 'l03', title: 'Agent', summary: '질문 이해 → 데이터 판단 → Tool 선택 → 계산 → 확인 → 설명.', outline: [{ formula: '질문 이해 → 필요한 데이터 판단 → Tool 선택 → 계산 → 결과 확인 → 설명' }] },
    { id: 'l04', title: 'RAG 기초', summary: 'Document → Chunk → Embedding → Vector DB → Retrieval.', outline: [{ formula: 'Document → Chunk → Embedding → Vector DB → Retrieval → Context → LLM' }, 'RAG 와 일반 API 호출의 차이.'] },
    { id: 'l05', title: '사업보고서 RAG', summary: '사업의 내용, 위험요인, 계약, 투자, R&D, 산업.', outline: [{ list: ['사업의 내용', '위험요인', '주요 계약', '투자', '연구개발', '산업 관련 설명'] }] },
    { id: 'l06', title: 'Chunking / Retrieval', summary: 'Chunk size, Overlap, Metadata, Top-k, 품질.', outline: [{ list: ['Chunk Size', 'Overlap', 'Metadata', 'Semantic Search', 'Top-k', 'Retrieval Quality'] }, 'Vector DB 를 붙이는 것보다 검색 품질을 평가하는 것이 중요하다.'] },
    { id: 'l07', title: 'Grounded Answer', summary: '사용한 데이터·계산·공시 근거 표시.', outline: [{ list: ['사용한 재무 데이터', '사용한 계산 결과', '검색한 공시 근거'] }] },
    { id: 'l08', title: 'Hallucination과 계산 오류 방지', summary: '책임 분리와 “모른다” 정책.', outline: [{ formula: 'Calculation → Python\nDocument Fact → RAG / Source\nInterpretation → LLM' }, '근거가 없으면 모른다고 처리하는 정책을 설계한다.'] },
    { id: 'l09', title: 'Agent Evaluation', summary: 'Tool 선택·계산 전달·검색 관련도·근거성·일관성.', outline: [{ list: ['Tool 선택 정확도', '계산 결과 전달 정확도', 'Retrieval relevance', 'Groundedness', '답변 일관성'] }] },
    { id: 'l10', title: 'MCP', summary: '필요할 때만 확장하는 외부 연결 계층.', outline: ['MCP 의 역할을 학습하고 실제 필요가 있을 때 확장한다. MCP 자체를 사용하기 위해 억지로 도입하지 않는다.'] },
  ],
  practice: {
    title: 'Agent 정확성·근거 검증',
    brief: ['다음 질문을 Agent 에게 수행시키고, 각 답변에서 Tool Call 여부 · 계산 정확성 · 근거 문서 · 출처 없는 주장 여부를 검증합니다.', { list: ['"최근 3년간 이 기업의 수익성 변화를 분석해줘."', '"DCF 결과가 WACC 변화에 얼마나 민감한지 설명해줘."', '"사업보고서에서 향후 현금흐름에 영향을 줄 수 있는 위험요인을 찾아줘."', '"해당 위험요인이 어떤 DCF 가정과 연결될 수 있는지 설명해줘."'] }],
    questions: [
      { id: 'q1', prompt: '질문 1: Tool Call 여부 / 계산 정확성 / 근거 / 출처 없는 주장' },
      { id: 'q2', prompt: '질문 2: Tool Call 여부 / 계산 정확성 / 근거 / 출처 없는 주장' },
      { id: 'q3', prompt: '질문 3: Tool Call 여부 / 계산 정확성 / 근거 / 출처 없는 주장' },
      { id: 'q4', prompt: '질문 4: Tool Call 여부 / 계산 정확성 / 근거 / 출처 없는 주장' },
    ],
    deliverables: ['Agent Evaluation'],
  },
  build: {
    title: 'Valuation Agent', kind: 'planned',
    description: ['LLM Agent + Tool + Disclosure RAG. 현재 개발 예정이며 AI 응답을 가짜로 생성하지 않습니다.'],
    planned: { comingIn: 'Coming in STEP 07', modules: ['Financial Data Tool', 'Financial Analysis Tool', 'WACC Tool', 'DCF Tool', 'Sensitivity Tool', 'Disclosure RAG'], architecture: 'User\n ↓\nValuation Agent\n ├── Financial Data Tool\n ├── Financial Analysis Tool\n ├── WACC Tool\n ├── DCF Tool\n ├── Sensitivity Tool\n └── Disclosure RAG' },
  },
  reflectionPrompts: ['Agent 가 계산을 직접 하려 한 사례가 있었는가? 어떻게 막았는가?', '검색 품질이 답변 품질에 미친 영향은?'],
  evolution: { manual: '재무지표를 해석하고 공시 위험요인을 직접 읽어 DCF 가정에 연결했다.', problem: '문서 탐색과 요약, 가정 연결이 반복적이고 오래 걸린다.', automated: 'Tool Calling Agent + 공시 RAG (계산은 Python, 사실은 RAG, 해석은 LLM).' },
};
