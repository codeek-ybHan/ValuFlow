// AI 답변 계약. 향후 LLM 답변은 이 구조를 따르고, auditAnswer 로 근거 · 경고 · 출처 누락을 점검한다.
import type { AnswerMode } from './capabilities.ts';
import type { SourceInfo, SourceType, ToolResult } from './tools/result.ts';
import { UNSUPPORTED_DISCLOSURE } from './policy.ts';

export interface AnswerEvidence {
  label: string;
  /** 문자열로 표기한 값 (Tool 결과의 값을 그대로 인용) */
  value: string;
  period?: string;
  unit?: string;
  /** 이 근거를 준 Tool */
  tool: string;
}

/** 답변의 출처. 숫자 Tool 출처(financial-data) · 공시 문서(disclosure-document) · 사용자 업로드 문서(uploaded-document)를 구분한다. */
export interface AnswerSource {
  kind: SourceInfo['kind'];
  type?: SourceType;
  origin: string;
  basis: string | null;
  fetchedAt: string | null;
  corpName?: string | null;
  reportName?: string | null;
  filingDate?: string | null;
  section?: string | null;
  receiptNo?: string | null;
  title?: string | null;
  page?: number | null;
  sourceName?: string | null;
  uploadedAt?: string | null;
  documentId?: string | null;
  asOf?: string | null;
  publishedAt?: string | null;
  publisher?: string | null;
  url?: string | null;
}

export interface AiAnalystAnswer {
  mode: AnswerMode;
  summary: string;
  evidence: AnswerEvidence[];
  /** 답변에 영향을 주는 DataQuality · 가정 · 지원 범위 경고 */
  warnings: string[];
  sources: AnswerSource[];
  suggestedNextActions: string[];
}

export interface AnswerViolation {
  code: 'unknown-tool' | 'missing-warning' | 'missing-sources' | 'unsupported-not-disclosed' | 'empty-summary' | 'missing-value-fabricated' | 'unsupported-figures' | 'ungrounded-number' | 'evidence-from-failed-tool'
    | 'claim-without-evidence' | 'applied-change-claimed' | 'proposal-incomplete';
  detail: string;
}

/** Tool 결과에서 값이 없다고 표시된 항목(`{status:'missing', value:null}`)의 이름들. */
export function missingKeys(o: unknown, key = '', out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(o)) o.forEach((v) => missingKeys(v, key, out));
  else if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    if (r.status === 'missing' && r.value === null && key) out.add(key);
    for (const [k, v] of Object.entries(r)) missingKeys(v, k, out);
    if (typeof r.field === 'string' && r.missing && typeof r.missing === 'object') out.add(r.field);
  }
  return out;
}

/** Tool 결과 안의 모든 숫자. */
function collectNumbers(o: unknown, out: number[] = [], key = ''): number[] {
  if (typeof o === 'number' && Number.isFinite(o)) out.push(o);
  // 공시 문서 발췌(text)에 적힌 숫자도 문서 근거로 인정한다 (문서 숫자가 Valuation 결과를 대체하는 것은 아니다)
  else if (typeof o === 'string' && (key === 'text' || key === 'snippet' || key === 'title')) for (const m of o.matchAll(/\d[\d,]*(?:\.\d+)?/g)) { const n = Number(m[0].replace(/,/g, '')); if (Number.isFinite(n)) out.push(n); }
  else if (Array.isArray(o)) o.forEach((v) => collectNumbers(v, out, key));
  else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => collectNumbers(v, out, k));
  return out;
}

const PURE_NUMBER = /^\s*([+-]?\d[\d,]*(?:\.\d+)?)\s*(%p|%|억\s*원|백만\s*원|조\s*원|원|배|x)?\s*$/;

/** 표시용 변환만 허용한다: 비율 ↔ 퍼센트(×100), KRW million ↔ 억원(÷100), 표시 반올림(절대 0.06 또는 상대 0.6% 이내). */
function groundedIn(x: number, tool: number[]): boolean {
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.06, Math.abs(b) * 0.006);
  return tool.some((n) => [n, n * 100, n / 100, Math.abs(n), Math.abs(n) * 100].some((c) => close(Math.abs(x), Math.abs(c))));
}

const D_A_LABEL = /D&A|depreciation|amortization|감가상각|상각/i;
const labelMatches = (key: string, label: string): boolean => {
  if (/depreciation/i.test(key)) return D_A_LABEL.test(label);
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return label.toLowerCase().includes(words);
};

/** 답변이 Tool 결과에 근거하는지 점검한다 (가드레일). 위반이 없으면 빈 배열. */
export function auditAnswer(answer: AiAnalystAnswer, results: ToolResult<unknown>[], options: { unsupported?: boolean } = {}): AnswerViolation[] {
  const v: AnswerViolation[] = [];
  if (answer.summary.trim() === '') v.push({ code: 'empty-summary', detail: 'summary is empty' });
  const executed = new Set(results.map((r) => r.tool));
  for (const e of answer.evidence) if (!executed.has(e.tool)) v.push({ code: 'unknown-tool', detail: `evidence "${e.label}" cites ${e.tool}, which was not called` });
  // review 수준 경고는 답변에 반드시 포함
  const material = [...new Set(results.flatMap((r) => r.warnings).filter((w) => w.level === 'review').map((w) => w.text))];
  for (const text of material) if (!answer.warnings.includes(text)) v.push({ code: 'missing-warning', detail: text });
  if (answer.evidence.length > 0 && answer.sources.length === 0) v.push({ code: 'missing-sources', detail: 'evidence without sources' });
  // Tool 이 unsupported 를 돌려줬거나, context 가 이미 unsupported 라서 Tool 을 부르지 않은 경우 모두 지원 불가를 밝혀야 한다
  const unsupported = options.unsupported === true || results.some((r) => r.status === 'unsupported');
  if (unsupported && !answer.summary.includes(UNSUPPORTED_DISCLOSURE)) {
    v.push({ code: 'unsupported-not-disclosed', detail: 'unsupported company must be disclosed in the summary' });
  }
  if (unsupported && answer.evidence.length > 0) v.push({ code: 'unsupported-figures', detail: 'figures were given for an unsupported company' });
  // 값이 없는 항목에 숫자를 붙인 근거 (예: D&A 가 missing 인데 숫자를 제시)
  const missing = new Set<string>();
  for (const r of results) if (r.status === 'ok') missingKeys(r.data, '', missing);
  // 결과가 없거나 실패한 Tool 을 근거로 인용하면 안 된다 (예: 공시 검색 결과가 없는데 "회사는 ~라고 설명했다")
  for (const e of answer.evidence) {
    const r = results.find((x) => x.tool === e.tool);
    if (r && r.status !== 'ok') v.push({ code: 'evidence-from-failed-tool', detail: `evidence "${e.label}" cites ${e.tool}, which returned ${r.status}` });
  }
  // 근거의 숫자는 Tool 결과의 숫자에서 와야 한다 (표시용 변환 · 반올림만 허용). 순수 숫자 값만 검사한다.
  const toolNumbers = results.filter((r) => r.status === 'ok').flatMap((r) => collectNumbers(r.status === 'ok' ? r.data : null));
  for (const e of answer.evidence) {
    const m = PURE_NUMBER.exec(e.value);
    if (m && toolNumbers.length > 0 && !groundedIn(Number(m[1].replace(/,/g, '')), toolNumbers)) {
      v.push({ code: 'ungrounded-number', detail: `evidence "${e.label}" (${e.value}) does not match any number returned by the tools` });
    }
  }
  for (const e of answer.evidence) {
    if (/\d/.test(e.value) && [...missing].some((k) => labelMatches(k, e.label))) v.push({ code: 'missing-value-fabricated', detail: `evidence "${e.label}" shows a number for a value the tools report as missing` });
  }
  return v;
}

export interface GroundingOutcome {
  answer: AiAnalystAnswer;
  /** 모델 답변에서 감지한 위반 */
  violations: AnswerViolation[];
  /** 결정적으로 보정한 항목 */
  corrections: string[];
}

/** Tool 출처를 답변 출처 형태로 옮긴다 (문서 출처의 필드는 그대로 보존). */
export function toAnswerSource(s: SourceInfo): AnswerSource {
  const out: AnswerSource = { kind: s.kind, origin: s.origin, basis: s.basis, fetchedAt: s.fetchedAt };
  if (s.type) out.type = s.type;
  for (const k of ['corpName', 'reportName', 'filingDate', 'section', 'receiptNo', 'title', 'sourceName', 'uploadedAt', 'documentId', 'asOf', 'publishedAt', 'publisher', 'url'] as const) if (s[k] !== undefined && s[k] !== null) out[k] = s[k];
  if (s.page !== undefined && s.page !== null) out.page = s.page;
  return out;
}

const sourceKey = (s: AnswerSource) => `${s.kind}|${s.origin}|${s.basis ?? ''}|${s.fetchedAt ?? ''}|${s.receiptNo ?? ''}|${s.documentId ?? ''}|${s.page ?? ''}|${s.section ?? ''}|${s.asOf ?? ''}|${s.url ?? ''}|${s.title ?? ''}`;

/**
 * 모델 답변을 Tool 결과에 맞춰 보정한다 (위반은 그대로 기록한다).
 *  - 빠진 review 경고를 복원, Tool 의 출처를 답변 sources 에 합친다 (Source 는 Tool provenance 기반).
 *  - unsupported 기업이면 숫자 근거를 제거하고 지원 불가를 밝힌다 (다른 기업의 숫자를 쓰지 않는다).
 *  - missing 값에 붙은 숫자 근거는 제거하고 값이 없음을 경고로 남긴다.
 * 모델의 해석(summary)은 바꾸지 않는다. 숫자나 문장을 새로 만들어 넣지 않는다.
 */
export function enforceGrounding(answer: AiAnalystAnswer, results: ToolResult<unknown>[], options: { unsupported?: boolean } = {}): GroundingOutcome {
  const violations = auditAnswer(answer, results, options);
  const fixed: AiAnalystAnswer = { ...answer, evidence: [...answer.evidence], warnings: [...answer.warnings], sources: [...answer.sources] };
  const corrections: string[] = [];

  const missingWarnings = violations.filter((v) => v.code === 'missing-warning').map((v) => v.detail);
  if (missingWarnings.length > 0) { fixed.warnings.push(...missingWarnings); corrections.push('warnings-restored'); }

  // 출처는 Tool provenance 기반이다: Tool 결과에 없는 출처(모델이 지어낸 라벨)는 제거한다
  const toolSources = new Map(results.flatMap((r) => r.sources).map((s) => { const a = toAnswerSource(s); return [sourceKey(a), a] as const; }));
  // 모델이 인용한 출처는 Tool 의 완전한 출처 정보(type · 문서 metadata 포함)로 바꿔 둔다
  const kept = fixed.sources.filter((s) => toolSources.has(sourceKey(s))).map((s) => toolSources.get(sourceKey(s))!);
  if (kept.length !== fixed.sources.length) corrections.push('sources-filtered');
  fixed.sources = kept;
  const have = new Set(fixed.sources.map(sourceKey));
  const added = results.flatMap((r) => r.sources).map(toAnswerSource).filter((s) => !have.has(sourceKey(s)) && have.add(sourceKey(s)));
  if (added.length > 0) { fixed.sources.push(...added); corrections.push('sources-merged'); }

  if (violations.some((v) => v.code === 'unsupported-not-disclosed' || v.code === 'unsupported-figures')) {
    fixed.sources = [];
    fixed.evidence = [];
    if (!fixed.summary.includes(UNSUPPORTED_DISCLOSURE)) fixed.summary = `${UNSUPPORTED_DISCLOSURE} ${fixed.summary}`.trim();
    corrections.push('unsupported-disclosed');
  }
  const failedTool = violations.filter((v) => v.code === 'evidence-from-failed-tool');
  if (failedTool.length > 0) {
    const labels = new Set(failedTool.map((v) => /evidence "(.*)" cites/.exec(v.detail)?.[1]));
    fixed.evidence = fixed.evidence.filter((e) => !labels.has(e.label));
    corrections.push('failed-tool-evidence-removed');
  }
  const fab = violations.filter((v) => v.code === 'missing-value-fabricated');
  if (fab.length > 0) {
    const labels = new Set(fab.map((v) => /evidence "(.*)" shows/.exec(v.detail)?.[1]));
    fixed.evidence = fixed.evidence.filter((e) => !labels.has(e.label));
    const text = 'Some requested values are unavailable from the current data source and were not estimated.';
    if (!fixed.warnings.includes(text)) fixed.warnings.push(text);
    corrections.push('fabricated-values-removed');
  }
  return { answer: fixed, violations, corrections };
}
