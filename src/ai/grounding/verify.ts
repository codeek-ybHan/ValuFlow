// Grounding Validator: claim 마다 근거 존재 · Tool 실행 · field 존재 · 값 일치 · source 를 검사하고, 숫자 · 단위 · field · source 까지 확인한다.
//   Claim → Evidence(fieldPath, value, source) 연결, 허용 변환(비율↔퍼센트 · KRW 단위 · 반올림 · 파생 %p), 값 없음(missing) 채우기 감지, 계산 claim 의 deterministic 근거,
//   valuation 숫자의 엔진 근거, provider 충돌, 시점 표기, WACC 구성요소 의미, 신뢰도(source · DataQuality · 검색 품질), coverage.
import { extractEvidence, normalizePath, resolveRef, type EvidenceIndex } from './evidence.ts';
import { claimConfidence, isDeterministic, sourcePriority } from './confidence.ts';
import { detectContradictions } from './contradiction.ts';
import { isDerivedPointChange, matchesDocNumber, matchesValue, parseNumbers, type ParsedNumber } from './numbers.ts';
import { termsForPath, termsIn, type Term } from './terms.ts';
import { validateProposal, type Proposal, type ProposalCheck } from './wacc.ts';
import type { ClaimType, Contradiction, Evidence, EvidenceGraphEdge, GroundedClaim, GroundingIssue, GroundingIssueCode, GroundingReport, NumberCheck, RawClaim } from './types.ts';

export { extractEvidence };
export type { EvidenceIndex };

const CLAIM_TYPES: ClaimType[] = ['fact', 'calculation', 'interpretation', 'risk', 'recommendation'];
const DOC_TOOLS = new Set(['searchDisclosures', 'searchUploadedDocuments', 'searchKnowledge', 'searchCompanyNews']);
const NEGATION = /확인되지|확인할 수 없|없(어|다|습니다|음|으며|고|는)|미존재|미확인|누락|부재|제공되지|알 수 없|unavailable|missing|not available|no data/i;
const TIME_MARK = /기준|현재|asOf|as of|\d{4}[-./]\d{1,2}|\d{4}\s*년|FY\s*\d|\d{4}A\b|분기/i;
const WACC_CHANGE = /WACC.{0,12}(변경|조정|상향|하향|인상|인하|낮추|높이|낮춰|높여)/i;
/** 문서 · 뉴스 claim 의 핵심 단어 중 발췌에 들어 있어야 하는 비율 (형태소 분석 없이 어간만 비교하므로 너무 높게 잡지 않는다). */
const TEXT_SUPPORT = 0.4;
const STOP = new Set(['최근', '뉴스', '소식', '이슈', '포함', '내용', '언급', '보도', '있는', '있음', '회사', '회사는', '있다', '있습니다', '했다', '했습니다', '대한', '대해', '관련', '통해', '위해', '따라', '등의', '이다', '입니다', '있으며', '하고', '및']);

export interface GroundInput {
  summary: string;
  claims: unknown[];
  proposedActions: Proposal[];
  index: EvidenceIndex;
}

export interface GroundOutput {
  claims: GroundedClaim[];
  report: GroundingReport;
  proposals: ProposalCheck[];
  /** 위반(violation)으로 기록할 항목. blocking 이면 교정 재생성 / fallback 대상이다. */
  issues: GroundingIssue[];
}

// ---- claim 정규화 ----
export function normalizeClaims(raw: unknown[]): RawClaim[] {
  return raw.flatMap((c, i): RawClaim[] => {
    const o = (c && typeof c === 'object' ? c : null) as Record<string, unknown> | null;
    if (!o) return [];
    const text = typeof o.text === 'string' ? o.text : typeof o.claim === 'string' ? o.claim : '';
    if (!text.trim()) return [];
    const refs = Array.isArray(o.evidenceRefs)
      ? (o.evidenceRefs as Record<string, unknown>[]).filter((r) => typeof r?.tool === 'string').map((r) => ({ tool: String(r.tool), fieldPath: typeof r.fieldPath === 'string' ? r.fieldPath : null }))
      : Array.isArray(o.tools) ? (o.tools as unknown[]).filter((t): t is string => typeof t === 'string').map((tool) => ({ tool, fieldPath: null })) : [];
    const type = CLAIM_TYPES.includes(o.type as ClaimType) ? (o.type as ClaimType) : 'fact';
    return [{ claimId: typeof o.claimId === 'string' && o.claimId ? o.claimId : `c${i + 1}`, text, type, evidenceRefs: refs }];
  });
}

// 서로 관련 있는 지표 묶음: 문장에 "CFO 에서 CAPEX 를 뺀 현금흐름" 처럼 구성 지표로 풀어 쓴 경우 파생 지표(CFO−CAPEX)도 같은 지표로 본다.
const RELATED: string[][] = [['cfo', 'capex', 'cfoMinusCapex'], ['nwc', 'deltaNwc', 'nwcToRevenue'], ['totalDebt', 'netDebt', 'cash', 'leaseLiabilities'], ['marketCap', 'price', 'sharesOutstanding']];
const related = (a: string, b: string) => a === b || RELATED.some((g) => g.includes(a) && g.includes(b));

// 숫자가 속한 절(clause)의 용어: 쉼표 · 접속 표현으로 문장을 나눠 숫자와 가까운 용어만 그 숫자의 지표로 본다.
const CLAUSE_BREAK = /[,，;!?。\n]|\.(?=\s|$)|이고|이며|이나|하고|으나|지만|인데|및/g;   // 소수점(2.5%)은 문장 경계가 아니다
function clauseTerms(text: string, pos: number): Term[] {
  let start = 0, end = text.length;
  for (const m of text.matchAll(CLAUSE_BREAK)) {
    if (m.index! + m[0].length <= pos) start = m.index! + m[0].length;
    else if (m.index! >= pos) { end = m.index!; break; }
  }
  return termsIn(text.slice(start, end));
}

// ---- 문서 · 뉴스 텍스트 근거 ----
const josa = /(으로|에서|에게|께서|까지|부터|이다|입니다|했다|했으며|하고|하는|되는|하며|으며|합니다|한다|된다|은|는|이|가|을|를|의|에|도|와|과|로)$/;
function tokensOf(text: string, numbers: ParsedNumber[]): string[] {
  let t = text;
  for (const n of numbers) t = t.replace(n.text, ' ');
  return [...new Set(t.split(/[^0-9A-Za-z가-힣]+/).map((w) => (w.length > 2 && /[가-힣]/.test(w) ? w.replace(josa, '') : w)).filter((w) => w.length >= 2 && !STOP.has(w)).map((w) => w.toLowerCase()))];
}
const supportRatio = (tokens: string[], excerpt: string): number => (tokens.length === 0 ? 0 : tokens.filter((w) => excerpt.toLowerCase().includes(w)).length / tokens.length);

// ---- 핵심 ----
export function groundAnalysis(input: GroundInput): GroundOutput {
  const { index } = input;
  const contradictions = detectContradictions(index);
  const contradictedOther = new Set(contradictions.map((c) => c.other.evidenceId));
  const docNums = new Map<string, ParsedNumber[]>();
  const numsOf = (e: Evidence) => docNums.get(e.evidenceId) ?? (docNums.set(e.evidenceId, e.excerpt ? parseNumbers(index.texts.get(e.evidenceId) ?? e.excerpt) : []), docNums.get(e.evidenceId)!);
  const all = index.list.filter((e) => !e.missing);
  const issues: GroundingIssue[] = [];

  /** 문장의 숫자 하나를 근거에서 찾는다: 인용한 근거 → 인용한 Tool → 전체 순서. 같은 값이 여럿이면 우선순위가 높은 source 를 쓴다. */
  const checkNumber = (n: ParsedNumber, group: ParsedNumber[], refPool: Evidence[], toolPool: Evidence[], valuationClaim: boolean, flags: Set<GroundingIssueCode>, fieldTerms: Term[] = []): NumberCheck => {
    // 숫자는 문장이 말하는 지표(field)의 근거와 일치해야 한다: 같은 값이 다른 지표(예: 순이익률)에 우연히 있어도 영업이익률 숫자의 근거가 아니다
    const present = fieldTerms.filter((t) => all.some((e) => termsForPath(e.fieldPath ?? '').some((x) => x.key === t.key)));
    const fieldOk = (e: Evidence) => present.length === 0 || e.excerpt !== undefined || termsForPath(e.fieldPath ?? '').some((x) => present.some((t) => related(t.key, x.key)));
    let mismatched = false;
    const find = (pool: Evidence[]) => {
      const raw = pool.filter((e) => (typeof e.value === 'number' && matchesValue(n, e.value)) || (e.excerpt !== undefined && numsOf(e).some((d) => matchesDocNumber(n, d))));
      const keep = raw.filter(fieldOk);
      if (raw.length > 0 && keep.length === 0) mismatched = true;
      return keep;
    };
    const pick = (hits: Evidence[]) => [...hits].sort((a, b) => sourcePriority(a) - sourcePriority(b));
    let status: NumberCheck['status'] = 'ungrounded';
    let hits: Evidence[] = [];
    for (const [pool, st] of [[refPool, 'grounded'], [toolPool, 'grounded'], [all, 'grounded-other-tool']] as const) {
      const h = find(pool);
      if (h.length > 0) { hits = h; status = st; break; }
    }
    if (hits.length > 0) {
      const usable = hits.filter((e) => !contradictedOther.has(e.evidenceId));
      if (usable.length === 0) { flags.add('contradicted-by-priority-source'); return { text: n.text, status: 'ungrounded', evidenceIds: pick(hits).slice(0, 1).map((e) => e.evidenceId) }; }
      hits = usable;
      if (valuationClaim && !hits.some(isDeterministic)) { flags.add('valuation-number-not-from-engine'); return { text: n.text, status: 'ungrounded', evidenceIds: [] }; }
      if (status === 'grounded-other-tool') flags.add('number-from-other-tool');
      return { text: n.text, status, evidenceIds: pick(hits).slice(0, 2).map((e) => e.evidenceId) };
    }
    if (n.unit === 'pctp' && isDerivedPointChange(n, group)) return { text: n.text, status: 'derived', evidenceIds: [] };
    if (mismatched) flags.add('number-field-mismatch');
    return { text: n.text, status: 'ungrounded', evidenceIds: [] };
  };

  // ---- claims ----
  const raws = normalizeClaims(input.claims);
  const claims: GroundedClaim[] = raws.map((c) => {
    const flags = new Set<GroundingIssueCode>();
    const refEv: Evidence[] = [];
    const cited = new Set<string>();
    for (const r of c.evidenceRefs) {
      if (!index.okTools.has(r.tool)) { flags.add('tool-not-executed'); continue; }
      cited.add(r.tool);
      if (r.fieldPath) {
        const found = resolveRef(index, r.tool, r.fieldPath);
        if (found.length === 0) flags.add('evidence-ref-invalid'); else refEv.push(...found);
      }
    }
    const toolPool = [...cited].flatMap((t) => (index.byTool.get(t) ?? []).filter((e) => !e.missing));
    const nums = parseNumbers(c.text);
    const terms = termsIn(c.text);
    const valuationClaim = terms.some((t) => t.category === 'valuation' || t.key === 'wacc') && !terms.some((t) => t.category === 'market' || t.category === 'peer');
    const numbers = nums.map((n) => checkNumber(n, nums, refEv.filter((e) => !e.missing), toolPool, valuationClaim, flags, clauseTerms(c.text, n.start)));
    const linked = new Map<string, Evidence>();
    const link = (e: Evidence | undefined) => { if (e && !e.missing) linked.set(e.evidenceId, e); };
    refEv.forEach(link);
    numbers.forEach((n) => n.evidenceIds.forEach((id) => link(index.byId.get(id))));

    // 용어 연결: 문장의 용어(한국어 포함)에 해당하는 field 의 근거. 값이 없는(missing) 항목을 채우는 문장은 잡는다.
    const pool = toolPool.length > 0 ? toolPool : all;
    for (const t of terms) {
      const withTerm = (list: Evidence[]) => list.filter((e) => termsForPath(e.fieldPath ?? '').some((x: Term) => x.key === t.key));
      const hit = withTerm(pool);
      if (hit.length > 0) {
        const best = [...hit].sort((a, b) => (/\[(\d+)\]$/.exec(b.fieldPath ?? '')?.[1] ?? '0').localeCompare(/\[(\d+)\]$/.exec(a.fieldPath ?? '')?.[1] ?? '0', undefined, { numeric: true }));
        link(best[0]);
      } else {
        const miss = withTerm(index.list.filter((e) => e.missing));
        if (miss.length > 0) { if (!NEGATION.test(c.text)) flags.add('evidence-missing-value'); else linked.set(miss[0].evidenceId, miss[0]); }   // "확인되지 않는다"는 진술은 값 없음 표시가 근거다
      }
    }

    // 문서 · 뉴스 근거: 인용한 검색 결과의 발췌에 주장의 핵심 단어가 들어 있는가
    const docCited = [...cited].some((t) => DOC_TOOLS.has(t)) || refEv.some((e) => e.excerpt !== undefined);
    if (docCited) {
      const cands = (refEv.some((e) => e.excerpt !== undefined) ? refEv : toolPool).filter((e) => e.excerpt !== undefined);
      const toks = tokensOf(c.text, nums);
      const textOf = (e: Evidence) => index.texts.get(e.evidenceId) ?? e.excerpt ?? '';
      const scored = cands.map((e) => ({ e, r: supportRatio(toks, textOf(e)) })).sort((a, b) => b.r - a.r);
      // 하나의 문단이 아니라 인용한 여러 문단(뉴스 여러 건 등)이 함께 주장을 받쳐도 된다
      const unionRatio = supportRatio(toks, cands.map(textOf).join(' '));
      if (scored.length > 0 && toks.length >= 2 && (scored[0].r >= TEXT_SUPPORT || unionRatio >= TEXT_SUPPORT)) { if (scored[0].r >= TEXT_SUPPORT) link(scored[0].e); else scored.filter((s) => s.r > 0).slice(0, 3).forEach((s) => link(s.e)); }
      else if (c.type === 'fact' && (numbers.length === 0 || numbers.every((n) => n.status === 'ungrounded'))) flags.add('text-not-in-evidence');   // 해석 · 위험 · 권고는 발췌와 일치할 필요가 없다 (관련 근거만 있으면 된다)
    }

    const ev = [...linked.values()];
    if (c.type === 'calculation' && (numbers.length > 0 ? numbers.some((n) => n.status !== 'derived' && n.evidenceIds.some((id) => !isDeterministic(index.byId.get(id)!))) : !ev.some(isDeterministic))) flags.add('calculation-not-deterministic');
    if (c.type === 'calculation' && ev.length > 0 && !ev.some(isDeterministic)) flags.add('calculation-not-deterministic');
    if (ev.length === 0) flags.add('no-evidence');
    if (WACC_CHANGE.test(c.text) && ev.some((e) => termsForPath(e.fieldPath ?? '').some((x) => x.category === 'wacc' && x.key !== 'wacc')) && !ev.some((e) => e.fieldPath === 'wacc')) flags.add('wacc-component-conflation');
    // 시점이 다른 근거(공시 연도 · 현재 시장 · 뉴스 발행일)를 섞었는데 문장에 시점이 없다
    const groups = new Set(ev.map((e) => (e.sourceType === 'news' ? 'news' : e.sourceType === 'market-data' || e.sourceType === 'peer-data' ? 'market' : e.period || e.sourceKind === 'actual' ? 'historical' : 'other')));
    groups.delete('other');
    if (groups.size >= 2 && !TIME_MARK.test(c.text)) flags.add('time-basis-not-stated');

    const fatal = numbers.some((n) => n.status === 'ungrounded') || flags.has('evidence-missing-value') || flags.has('contradicted-by-priority-source') || flags.has('valuation-number-not-from-engine')
      || flags.has('calculation-not-deterministic') || flags.has('no-evidence') || flags.has('text-not-in-evidence');
    const partial = !fatal && (numbers.some((n) => n.status === 'grounded-other-tool') || flags.has('evidence-ref-invalid') || flags.has('tool-not-executed') || flags.has('time-basis-not-stated') || flags.has('wacc-component-conflation'));
    const status: GroundedClaim['status'] = fatal ? 'unsupported' : partial ? 'partially-supported' : 'supported';
    const conf = status === 'unsupported' ? { level: undefined, notes: [] } : claimConfidence(ev, c.type);
    return { claimId: c.claimId, text: c.text, type: c.type, basis: c.type === 'fact' || c.type === 'calculation' ? 'objective' : 'judgment', evidenceIds: ev.map((e) => e.evidenceId).slice(0, 8), status, confidence: conf.level, numbers, issues: [...flags], confidenceNotes: conf.notes };
  });

  const seen = new Set<string>();
  const push = (i: GroundingIssue) => { const k = `${i.target}|${i.code}`; if (!seen.has(k)) { seen.add(k); issues.push(i); } };
  for (const g of claims) {
    const code = (i: GroundingIssueCode): string => (i === 'no-evidence' || i === 'text-not-in-evidence' || i === 'tool-not-executed' ? 'ungrounded-claim' : i === 'ungrounded-number' ? 'ungrounded-number'
      : i === 'evidence-missing-value' ? 'missing-value-in-text' : i === 'contradicted-by-priority-source' ? 'provider-contradiction' : i === 'time-basis-not-stated' ? 'time-basis-not-stated' : 'ungrounded-claim');
    for (const i of g.issues) {
      if (i === 'number-from-other-tool' || i === 'evidence-ref-invalid') continue;   // 참고 정보 (violation 아님)
      push({ target: g.claimId, code: code(i), detail: `${i}: ${g.text.slice(0, 80)}`, blocking: g.status === 'unsupported' && i !== 'time-basis-not-stated' && i !== 'wacc-component-conflation' });
    }
    if (g.numbers.some((n) => n.status === 'ungrounded')) push({ target: g.claimId, code: 'ungrounded-number', detail: `ungrounded number(s) ${g.numbers.filter((n) => n.status === 'ungrounded').map((n) => n.text).join(', ')} in: ${g.text.slice(0, 60)}`, blocking: true });
  }

  // ---- summary 의 숫자 (claim 에 속하지 않는 숫자 포함) ----
  const sNums = parseNumbers(input.summary);
  const sFlags = new Set<GroundingIssueCode>();
  const summaryNumbers = sNums.map((n) => checkNumber(n, sNums, [], all, false, sFlags, clauseTerms(input.summary, n.start)));
  for (const n of summaryNumbers) if (n.status === 'ungrounded') issues.push({ target: 'summary', code: 'ungrounded-text-number', detail: `summary number "${n.text}" is not found in any tool result`, blocking: true });
  if (sFlags.has('contradicted-by-priority-source')) issues.push({ target: 'summary', code: 'provider-contradiction', detail: 'summary uses a provider value that conflicts with a higher-priority source', blocking: true });

  // ---- 변경 제안 (WACC 구성요소 의미 검사) ----
  const proposals = input.proposedActions.map((p) => validateProposal(p, index));
  proposals.forEach((c, i) => {
    if (!c.ok && c.issue) issues.push({ target: `proposal:${i + 1}`, code: c.issue.code, detail: c.issue.detail, blocking: true });
    else if (c.retyped) issues.push({ target: `proposal:${i + 1}`, code: 'proposal-semantic-mismatch', detail: `${c.retyped.from} → ${c.retyped.to}: ${c.note ?? ''}`, blocking: false });
  });
  for (const c of contradictions) issues.push({ target: c.metric, code: 'provider-contradiction', detail: c.note, blocking: false });

  // ---- 보고서 ----
  const usedIds = new Set([...claims.flatMap((c) => c.evidenceIds), ...summaryNumbers.flatMap((n) => n.evidenceIds)]);
  const evidenceMap = [...usedIds].map((id) => index.byId.get(id)).filter((e): e is Evidence => !!e);
  const graph: EvidenceGraphEdge[] = claims.flatMap((c) => c.evidenceIds.map((id) => ({ claimId: c.claimId, evidenceId: id, tool: index.byId.get(id)?.tool ?? '', sourceType: index.byId.get(id)?.sourceType ?? '' })));
  const range = (xs: (string | undefined)[]) => { const v = xs.filter((x): x is string => !!x).sort(); return v.length ? (v[0] === v[v.length - 1] ? v[0] : `${v[0]} ~ ${v[v.length - 1]}`) : undefined; };
  const histP = evidenceMap.filter((e) => e.sourceKind === 'actual' && e.period).map((e) => e.period);
  const mk = evidenceMap.filter((e) => e.sourceType === 'market-data' || e.sourceType === 'peer-data').map((e) => e.asOf);
  const nw = evidenceMap.filter((e) => e.sourceType === 'news').map((e) => e.asOf);
  const tb: { historical?: string; market?: string; news?: string } = {};
  for (const [k, v] of [['historical', range(histP)], ['market', range(mk)], ['news', range(nw)]] as const) if (v) tb[k] = v;
  const timeBasis = Object.keys(tb).length >= 2 ? tb : null;
  const supported = claims.filter((c) => c.status === 'supported').length;
  const numbersAll = [...claims.flatMap((c) => c.numbers), ...summaryNumbers];
  const report: GroundingReport = {
    evidenceCount: index.list.length, claims, summaryNumbers, evidenceMap, graph, contradictions, timeBasis, hallucinatedSources: 0, issues,
    coverage: claims.length > 0 ? supported / claims.length : null,
    stats: { claims: claims.length, supported, partial: claims.filter((c) => c.status === 'partially-supported').length, unsupported: claims.filter((c) => c.status === 'unsupported').length, numbersChecked: numbersAll.length, numbersUngrounded: numbersAll.filter((n) => n.status === 'ungrounded').length },
  };
  return { claims, report, proposals, issues };
}

export { normalizePath };
export type { Contradiction };
