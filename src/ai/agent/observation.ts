// Observation: Tool 결과를 "다음 단계 판단에 필요한 만큼"만 구조화한 요약. 문서 본문 · chunk · Raw 행 · 기사 본문은 담지 않는다.
// nextHints 는 관찰에 따른 동적 계획(예: 품질 경고 → getMappingTrace, 뉴스에서 CAPEX 발표 → 공시 검색)의 규칙 기반 제안이며, Tool 입력을 만들지 않는다.
import { missingKeys } from '../answer.ts';
import type { ToolResult } from '../tools/result.ts';
import type { Observation } from './types.ts';

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : null);
const nums = (x: unknown): number[] => (Array.isArray(x) ? x.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []);

const EVENT_WORDS = /CAPEX|설비\s*투자|시설\s*투자|증설|투자\s*확대|M&A|인수|합병|규제|제재|소송|공급망|공급\s*(부족|지연)|리콜|실적\s*(쇼크|부진|발표)|가이던스|감산|증산|유상증자|배당/gi;

function findings(tool: string, data: Rec | null, hints: Observation['nextHints']): string[] {
  if (!data) return [];
  const out: string[] = [];
  switch (tool) {
    case 'getHistoricalAnalysis': {
      const m = rec(data.metrics);
      const periods = Array.isArray(data.periods) ? (data.periods as string[]) : [];
      for (const k of ['revenueGrowth', 'operatingMargin']) {
        const v = nums(rec(m?.[k])?.values);
        if (v.length >= 1) out.push(`${k}: ${v.length > 1 ? `${pct(v[0])} → ` : ''}${pct(v[v.length - 1])}${periods.length ? ` (${periods[0]}~${periods[periods.length - 1]})` : ''}`);
      }
      break;
    }
    case 'getHistoricalQuality': {
      const review = Array.isArray(data.reviewRequired) ? data.reviewRequired.length : 0;
      const notes = Array.isArray(data.dataNotes) ? data.dataNotes.length : 0;
      out.push(`review-required fields: ${review}`, `data notes: ${notes}`);
      if (review > 0) hints.push({ tool: 'getMappingTrace', reason: `${review} historical field(s) need review: trace their source accounts` });
      break;
    }
    case 'getForecastAssumptions': {
      out.push(`complete: ${String(data.complete)}`);
      const mi = rec(data.missingInputs);
      const n = ['forecast', 'wacc', 'dcf'].reduce((s, k) => s + (Array.isArray(mi?.[k]) ? (mi[k] as unknown[]).length : 0), 0);
      if (n > 0) out.push(`missing inputs: ${n}`);
      break;
    }
    case 'getValuationResult': {
      if (typeof data.enterpriseValue === 'number') out.push(`enterpriseValue(억원): ${data.enterpriseValue}`);
      if (typeof data.wacc === 'number') out.push(`wacc: ${pct(data.wacc)}`);
      if (typeof data.terminalGrowth === 'number') out.push(`terminalGrowth: ${pct(data.terminalGrowth)}`);
      if (typeof data.tvContribution === 'number') out.push(`terminal value share: ${pct(data.tvContribution)}`);
      const vw = Array.isArray(data.validationWarnings) ? data.validationWarnings.length : 0;
      if (vw > 0) out.push(`validation warnings: ${vw}`);
      break;
    }
    case 'getMarketAssumptions': {
      const rf = rec(data.riskFreeRate);
      out.push(typeof rf?.rate === 'number' ? `riskFreeRate ${pct(rf.rate)} (${String(rf.maturity)}, asOf ${String(rf.asOf)})` : 'riskFreeRate: missing');
      const b = rec(data.beta);
      out.push(typeof b?.value === 'number' ? `beta ${b.value} (raw)` : 'beta: missing');
      out.push('applied: false');
      break;
    }
    case 'getComparableCompanies': {
      out.push(`peer candidates: ${Array.isArray(data.peers) ? data.peers.length : 0}`, 'no average applied');
      break;
    }
    case 'getMarketData': {
      out.push(`asOf: ${String(data.asOf ?? 'unknown')}`);
      break;
    }
    case 'searchCompanyNews': {
      const items = Array.isArray(data.results) ? (data.results as Rec[]) : [];
      out.push(`news items: ${items.length}`);
      const dates = items.map((i) => String(i.publishedAt ?? '')).filter(Boolean).sort();
      if (dates.length) out.push(`published ${dates[0].slice(0, 10)} ~ ${dates[dates.length - 1].slice(0, 10)}`);
      const words = [...new Set(items.flatMap((i) => `${String(i.title ?? '')} ${String(i.snippet ?? '')}`.match(EVENT_WORDS) ?? []))].slice(0, 4);
      if (words.length) hints.push({ tool: 'searchDisclosures', reason: `news mentions ${words.join(', ')}: look for the company's own disclosure` });
      break;
    }
    case 'searchDisclosures': case 'searchUploadedDocuments': case 'searchKnowledge': {
      const items = Array.isArray(data.results) ? (data.results as Rec[]) : [];
      out.push(`passages: ${items.length}`, `documents: ${new Set(items.map((i) => String(i.documentId ?? ''))).size}`);
      break;
    }
    default: out.push(`fields: ${Object.keys(data).length}`);
  }
  return out;
}

export function observe(result: ToolResult<unknown>): Observation {
  const hints: Observation['nextHints'] = [];
  const base = { tool: result.tool, status: result.status, sourceTypes: [...new Set(result.sources.map((s) => s.type ?? s.kind))], warnings: [...new Set(result.warnings.filter((w) => w.level === 'review').map((w) => w.code))] };
  if (result.status !== 'ok') return { ...base, findings: [clip(`not available: ${result.reason}`)], missing: [], nextHints: [] };
  const data = rec(result.data);
  return { ...base, findings: findings(result.tool, data, hints), missing: [...missingKeys(result.data)], nextHints: hints };
}
