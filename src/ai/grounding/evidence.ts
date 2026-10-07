// Evidence 추출: Tool 결과에서 grounding 에 필요한 정보(값 · 단위 · 경로 · 출처 · 시점 · 품질)만 뽑는다. Tool 결과를 통째로 복사하지 않는다.
//  - 숫자 하나 = Evidence 하나 (fieldPath 로 어디서 왔는지 추적). {status:'missing'} 은 missing Evidence (근거로 쓸 수 없다).
//  - 검색 Tool(공시 · PDF · 지식)과 뉴스의 results[i] = 문단 / 기사 하나당 Evidence (문서 · page · section · url · 짧은 발췌).
//  - 실패한 Tool 은 Evidence 가 없다.
import type { SourceInfo, ToolResult } from '../tools/result.ts';
import type { Evidence } from './types.ts';

const MAX_EVIDENCE = 6000;
const EXCERPT = 240;
const clip = (s: string, n = EXCERPT) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : null);
// 근거로 읽지 않는 key: 안내문 · 단위표 · 검색 메타 · 회사 식별자
const SKIP = new Set(['units', 'disclaimer', 'notice', 'basis', 'contentType', 'futureExtension', 'limitations', 'retrieval', 'filters', 'providers', 'criteria', 'company', 'query', 'windowDays', 'timeBasis', 'applied']);
const RATIO_KEYS = new Set(['wacc', 'terminalGrowth', 'costOfEquity', 'afterTaxCostOfDebt', 'equityWeight', 'debtWeight', 'tvContribution', 'spread']);
// field 이름으로 단위를 정한다 (ValuFlow Tool 의 단위 규약: 비율은 소수, 금액은 억원, 주당 가치는 원, 주식수는 주). 알 수 없으면 가까운 sibling / 상위 unit 을 쓴다.
const FIELD_UNIT: Record<string, string> = {
  wacc: 'ratio', waccValues: 'ratio', terminalGrowth: 'ratio', terminalGrowthValues: 'ratio', riskFreeRate: 'ratio', marketRiskPremium: 'ratio', preTaxCostOfDebt: 'ratio', afterTaxCostOfDebt: 'ratio',
  costOfEquity: 'ratio', taxRate: 'ratio', equityWeight: 'ratio', debtWeight: 'ratio', tvContribution: 'ratio', spread: 'ratio',
  perShareValue: '원', sharesOutstanding: '주',
  enterpriseValue: '억원', equityValue: '억원', netDebt: '억원', fcff: '억원', equityMarketValue: '억원', debtMarketValue: '억원', interestBearingDebt: '억원', cash: '억원', currentRevenue: '억원',
};
const lastKey = (path: string) => path.split('.').pop()!.replace(/\[\d+\]/g, '');
const DOC_TOOLS = new Set(['searchDisclosures', 'searchUploadedDocuments', 'searchKnowledge']);

export interface EvidenceIndex {
  list: Evidence[];
  byId: Map<string, Evidence>;
  byTool: Map<string, Evidence[]>;
  /** 성공(ok)한 Tool 이름 */
  okTools: Set<string>;
  /** 실패한 Tool: 이름 → 상태 */
  failedTools: Map<string, string>;
  /** 문서 · 뉴스 근거의 전체 문단 (claim ↔ 발췌 대조용, 내부 전용: 표시 · audit · 재생성 요청에는 쓰지 않는다) */
  texts: Map<string, string>;
}

const sourceTypeOf = (s: SourceInfo | undefined): string => s?.type ?? s?.kind ?? 'unknown';

export function extractEvidence(results: ToolResult<unknown>[]): EvidenceIndex {
  const list: Evidence[] = [];
  const okTools = new Set<string>();
  const failedTools = new Map<string, string>();
  const runs = new Map<string, number>();
  const texts = new Map<string, string>();

  for (const r of results) {
    if (r.status !== 'ok') { if (!okTools.has(r.tool)) failedTools.set(r.tool, r.status); continue; }
    okTools.add(r.tool);
    failedTools.delete(r.tool);
    const n = (runs.get(r.tool) ?? 0) + 1;
    runs.set(r.tool, n);
    const prefix = n > 1 ? `${r.tool}#${n}` : r.tool;
    const src = r.sources[0];
    const base = { tool: r.tool, sourceType: sourceTypeOf(src), sourceKind: src?.kind ?? 'unknown', origin: src?.origin };
    const label = src ? (src.title ?? src.reportName ?? `${src.origin}${src.basis ? `:${src.basis}` : ''}`) : undefined;
    const data = rec(r.data);
    if (!data) continue;
    const provider = (() => { const p = rec(Array.isArray(data.providers) ? data.providers[0] : null); return p ? { name: String(p.name), reliability: String(p.reliability), tier: String(p.tier) } : undefined; })();
    const histReview = r.tool.startsWith('getHistorical') && r.warnings.some((w) => w.level === 'review');
    const periods = Array.isArray(data.periods) ? (data.periods as unknown[]).map(String) : null;
    const unitsRec = rec(data.units);
    const topAsOf = typeof data.asOf === 'string' ? data.asOf : undefined;

    const push = (e: Omit<Evidence, 'evidenceId' | 'tool' | 'sourceType' | 'sourceKind' | 'origin'> & { sourceType?: string; fullText?: string }) => {
      if (list.length >= MAX_EVIDENCE) return;
      const { fullText, ...rest } = e;
      const id = `${prefix}:${e.fieldPath}`;
      if (fullText) texts.set(id, fullText);
      list.push({ evidenceId: id, ...base, ...rest });
    };

    // 문서 · 뉴스 문단
    const items = DOC_TOOLS.has(r.tool) || r.tool === 'searchCompanyNews' ? (Array.isArray(data.results) ? (data.results as Rec[]) : []) : null;
    if (items) {
      const rerank = items.map((i) => (typeof i.rerankScore === 'number' ? i.rerankScore : null)).filter((x): x is number => x !== null);
      items.forEach((it, i) => {
        const isNews = r.tool === 'searchCompanyNews';
        const type = isNews ? 'news' : it.sourceType === 'user-upload' ? 'uploaded-document' : 'disclosure-document';
        push({
          fieldPath: `results[${i}]`, sourceType: type, documentId: typeof it.documentId === 'string' ? it.documentId : undefined, page: typeof it.pageNumber === 'number' ? it.pageNumber : undefined,
          section: typeof it.section === 'string' ? it.section : undefined, asOf: String(it.publishedAt ?? it.filingDate ?? it.uploadedAt ?? '') || undefined,
          sourceLabel: String(it.title ?? it.reportName ?? it.publisher ?? label ?? ''), url: typeof it.url === 'string' ? it.url : undefined,
          excerpt: clip(String(it.text ?? [it.title, it.snippet].filter(Boolean).join(' — '))),
          fullText: String(it.text ?? [it.title, it.snippet].filter(Boolean).join(' — ')).slice(0, 4000),
          retrieval: isNews ? undefined : { retrievalScore: typeof it.retrievalScore === 'number' ? it.retrievalScore : undefined, rerankScore: typeof it.rerankScore === 'number' ? it.rerankScore : null, rank: typeof it.finalRank === 'number' ? it.finalRank : i + 1, count: items.length, maxRerank: rerank.length ? Math.max(...rerank) : null },
        });
      });
      continue;
    }

    const walk = (node: unknown, path: string, unit: string | undefined, asOf: string | undefined, quality: string | undefined) => {
      if (typeof node === 'number') {
        if (!Number.isFinite(node)) return;
        const m = /\[(\d+)\]$/.exec(path);
        push({ fieldPath: path, value: node, unit: FIELD_UNIT[lastKey(path)] ?? unit, period: periods && m ? periods[Number(m[1])] : undefined, asOf: asOf ?? topAsOf, sourceLabel: label, provider, quality: quality ?? (histReview ? 'review' : undefined) });
        return;
      }
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`, unit, asOf, quality)); return; }
      const o = rec(node);
      if (!o) return;
      if (o.status === 'missing' && o.value === null) { push({ fieldPath: path, missing: true, sourceLabel: label, provider }); return; }
      const u = typeof o.unit === 'string' ? o.unit : unit;
      const a = typeof o.asOf === 'string' ? o.asOf : asOf;
      const q = typeof o.status === 'string' && r.tool.startsWith('getHistorical') ? o.status : quality;
      for (const [k, v] of Object.entries(o)) {
        if (SKIP.has(k) || k === 'unit' || k === 'asOf' || (k === 'status' && typeof v === 'string')) continue;
        const kUnit = u ?? (unitsRec ? (k === 'perShareValue' ? String(unitsRec.perShareValue ?? '') : RATIO_KEYS.has(k) ? 'ratio' : String(unitsRec.amounts ?? '')) || undefined : undefined);
        walk(v, path ? `${path}.${k}` : k, kUnit, a, q);
      }
    };
    for (const [k, v] of Object.entries(data)) {
      if (SKIP.has(k) || k === 'periods' || k === 'unit' || k === 'asOf') continue;
      const kUnit = typeof data.unit === 'string' ? data.unit : unitsRec ? (k === 'perShareValue' ? String(unitsRec.perShareValue ?? '') : RATIO_KEYS.has(k) ? 'ratio' : String(unitsRec.amounts ?? '')) || undefined : undefined;
      walk(v, k, kUnit, topAsOf, undefined);
    }
  }
  const byId = new Map(list.map((e) => [e.evidenceId, e]));
  const byTool = new Map<string, Evidence[]>();
  for (const e of list) byTool.set(e.tool, [...(byTool.get(e.tool) ?? []), e]);
  return { list, byId, byTool, okTools, failedTools, texts };
}

/** `data.metrics.x[2]` · `$.metrics.x[2]` · `metrics.x.2` 같은 표기를 evidence 의 fieldPath 형태로 맞춘다. */
export function normalizePath(path: string): string {
  return path.trim().replace(/^\$\.?/, '').replace(/^data\./, '').replace(/\.(\d+)(?=\.|$)/g, '[$1]').replace(/\["?(\d+)"?\]/g, '[$1]');
}

/**
 * (tool, fieldPath) 로 Evidence 를 찾는다. 같은 Tool 을 여러 번 실행했으면 모든 실행에서 찾는다.
 * 정확히 일치하는 값 → 아니면 상위 경로(`results[0].text` → `results[0]`) → 아니면 하위 값들(`trends.operatingMargin` 객체를 가리킨 경우). 어느 것도 없으면 빈 배열(= 잘못된 인용).
 */
export function resolveRef(index: EvidenceIndex, tool: string, fieldPath: string): Evidence[] {
  const list = index.byTool.get(tool) ?? [];
  const base = normalizePath(fieldPath);
  const exact = list.find((e) => e.fieldPath === base);
  if (exact) return [exact];
  for (let q = base; ;) {   // 상위 경로
    const next = q.replace(/(\.[^.[\]]+|\[\d+\])$/, '');
    if (next === q) break;
    q = next;
    const hit = list.find((e) => e.fieldPath === q);
    if (hit) return [hit];
  }
  return list.filter((e) => e.fieldPath !== undefined && (e.fieldPath.startsWith(`${base}.`) || e.fieldPath.startsWith(`${base}[`))).slice(0, 40);   // 하위 값들
}
