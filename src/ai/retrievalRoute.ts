// 문서 질문의 검색 대상 라우팅 (결정적 규칙). 질문 표현이 어느 검색 Tool 을 써야 하는지 정한다 — 회사가 선택되어 있다는 이유만으로 공시 검색으로 보내지 않는다.
//
//   uploaded   : "이 문서" · "업로드한 PDF" · "방금 올린 문서" 처럼 사용자가 올린 문서를 가리킨다  → searchUploadedDocuments 만
//   disclosure : "사업보고서에서" · "공시에서" · "삼성전자 공시에서" 처럼 공시를 명시한다           → searchDisclosures 만
//   both       : 둘 다 명시한다 ("공시와 업로드한 문서를 비교")                                    → 모든 검색 Tool
//   default    : 문서 지시가 없다 (기존 규칙/모델 판단)
//
// 공시 명시가 업로드 명시보다 우선하는 것이 아니라, "공시만 명시"일 때만 공시가 우선이다. 업로드된 문서가 하나도 없는데 "이 문서"를 말하면 LLM 을 부르지 않고 한계를 알린다.
import type { ToolName } from './tools/definitions.ts';

export type RetrievalRoute = 'uploaded' | 'disclosure' | 'both' | 'default';

export interface RouteDecision {
  route: RetrievalRoute;
  /** 사용자가 문서 종류를 말로 지정했는가 (지정하지 않은 "문서" 일반 표현이면 false) */
  explicit: boolean;
  /** route 가 uploaded 인데 범위 안에 업로드 문서가 없을 때의 사용자 안내. LLM 을 호출하지 않는다. */
  limitation: string | null;
  reason: string;
}

/** 업로드한 문서를 가리키는 표현 */
const UPLOADED = /(이|해당|그|위|방금\s*(올린|업로드\s*한)|최근\s*(올린|업로드\s*한))\s*(문서|PDF|파일|자료|리포트|보고서)|업로드\s*(한|된|해\s*둔|했던)|업로드한|올린|올려\s*둔|올렸던|첨부\s*(한|된)?\s*(문서|파일|PDF|자료)?|\bPDF\b|knowledge\s*documents?|uploaded\s*(pdf|document)/i;
/** 공시(OpenDART)를 명시하는 표현 */
const DISCLOSURE = /공시|사업보고서|반기보고서|분기보고서|annual\s*report|disclos|\bDART\b/i;
/** "문서" 일반 표현: 공시를 말하지 않았고 업로드한 문서가 있을 때만 업로드 문서로 본다 */
const GENERIC_DOCUMENT = /문서|자료|리포트/;

export const NO_UPLOADED_DOCUMENTS = '업로드한 문서가 없습니다. 왼쪽 Knowledge Documents 에서 PDF 를 올린 뒤 다시 질문하세요. (현재 기업에 연결된 문서와 기업에 연결되지 않은 일반 문서만 검색합니다.)';

/**
 * 질문 → 검색 라우팅. `uploadedCount` 는 현재 범위(현재 기업 문서 + 기업에 연결되지 않은 일반 문서)에서 검색 가능한 업로드 문서 수이고, 모르면 null 이다.
 * (다른 기업에 연결된 문서는 센 적도 검색한 적도 없다: 범위는 backend 가 corpCode 로 고정한다.)
 */
export function routeRetrieval(question: string, knowledge: { uploadedCount: number | null } = { uploadedCount: null }): RouteDecision {
  const up = UPLOADED.test(question);
  const disc = DISCLOSURE.test(question);
  const generic = !up && !disc && GENERIC_DOCUMENT.test(question) && (knowledge.uploadedCount ?? 0) > 0;
  let route: RetrievalRoute = 'default';
  let explicit = true;
  let reason = '문서 종류를 지정하지 않았습니다.';
  if (up && disc) { route = 'both'; reason = '공시와 업로드한 문서를 모두 언급했습니다.'; }
  else if (up) { route = 'uploaded'; reason = '업로드한 문서를 가리키는 표현이 있습니다.'; }
  else if (disc) { route = 'disclosure'; reason = '공시를 명시했습니다.'; }
  else if (generic) { route = 'uploaded'; explicit = false; reason = '문서를 언급했고 업로드한 문서가 있어 업로드 문서로 봅니다.'; }
  else explicit = false;
  const limitation = route === 'uploaded' && knowledge.uploadedCount === 0 ? NO_UPLOADED_DOCUMENTS : null;
  return { route, explicit, limitation, reason };
}

const RETRIEVAL: readonly ToolName[] = ['searchDisclosures', 'searchUploadedDocuments', 'searchKnowledge'];

/** route 가 허용하는 검색 Tool. 숫자 Tool 등 검색이 아닌 Tool 은 그대로 둔다. */
export function allowedRetrievalTools(route: RetrievalRoute): ToolName[] {
  switch (route) {
    case 'uploaded': return ['searchUploadedDocuments'];
    case 'disclosure': return ['searchDisclosures'];
    default: return [...RETRIEVAL];
  }
}

export function toolNamesFor(all: readonly ToolName[], route: RetrievalRoute): ToolName[] {
  const keep = new Set<string>(allowedRetrievalTools(route));
  return all.filter((t) => !RETRIEVAL.includes(t) || keep.has(t));
}

/** LLM 에 전달하는 최소 context 에 붙이는 라우팅 지시 (default 면 없음). */
export function routeContext(d: RouteDecision): Record<string, unknown> {
  if (d.route === 'default') return {};
  const text = d.route === 'uploaded'
    ? 'The user is asking about documents they uploaded (Knowledge Documents). Answer from searchUploadedDocuments only. Do NOT use searchDisclosures: do not turn this into a question about the company\'s filings, even though a company is selected.'
    : d.route === 'disclosure'
      ? 'The user explicitly asked about the company\'s filings (사업보고서 / 공시). Answer from searchDisclosures only; do not search uploaded documents.'
      : 'The user mentioned both the filings and uploaded documents. Use searchKnowledge (or both searches) and attribute each excerpt to its source.';
  return { retrievalRoute: { route: d.route, instruction: text } };
}
