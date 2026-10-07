// Footnote marker contract (STEP 09-2). 실제 footnote 렌더링은 Renderer(이후 STEP)이고, 여기서는 sourceId → [S1] 대응만 정한다.
//   Cell · NarrativeItem · RiskItem 이 sourceId(s)를 가지면 Renderer 는 `markersOf` 로 marker 를 붙인다:  "Revenue 333조원 [S1]" · "회사는 설비투자 확대를 언급했다. [S4]"
import type { SourceRef } from '../types.ts';
import type { SourceEntry } from './types.ts';

/** 출처 등록 순서대로 S1, S2, … (Report 가 새 출처를 만들지 않고 ReportModel.sources 의 순서를 따른다). */
export function buildFootnoteIndex(sources: SourceRef[]): Record<string, string> {
  return Object.fromEntries(sources.map((s, i) => [s.id, `S${i + 1}`]));
}

/** sourceId(들) → marker 목록. 알 수 없는 id 는 건너뛴다 (marker 를 만들어 내지 않는다). 중복은 한 번만, 번호 순서로 돌려준다. */
export function markersOf(index: Record<string, string>, ids: string | string[] | null | undefined): string[] {
  const list = ids === null || ids === undefined ? [] : Array.isArray(ids) ? ids : [ids];
  const markers = [...new Set(list.map((id) => index[id]).filter((m): m is string => !!m))];
  return markers.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

/** "[S1][S3]" 형태 문자열 (Renderer 가 그대로 붙일 수 있는 표기). */
export const markerText = (markers: string[]): string => markers.map((m) => `[${m}]`).join('');

/** 출처 종류 라벨: ValuFlow Engine · OpenDART · Disclosure · Uploaded PDF · Assumption · Market Data · Peer Data · News · Learning Fixture */
export function sourceTypeLabel(s: SourceRef): string {
  switch (s.kind) {
    case 'historical': return s.origin === 'fixture' ? 'Learning Fixture' : 'OpenDART';
    case 'assumption': return s.origin === 'learning-fixture' ? 'Learning Fixture' : 'Assumption';
    case 'engine': return 'ValuFlow Engine';
    case 'disclosure': return 'Disclosure';
    case 'document': return 'Uploaded PDF';
    case 'market': return 'Market Data';
    case 'peer': return 'Peer Data';
    case 'news': return 'News';
    default: return 'AI Analysis';
  }
}

const DEV_NOTICE = 'Development Source: 공식 · Valuation 등급 데이터가 아닙니다 (참고용).';

export function sourceEntries(sources: SourceRef[], index: Record<string, string>): SourceEntry[] {
  return sources.map((s) => {
    const d = s.document ?? null;
    const reference = [
      s.document ? null : s.basis,
      d?.section, d?.page != null ? `p.${d.page}` : null, d?.receiptNo ? `접수번호 ${d.receiptNo}` : null, d?.filingDate ? `공시일 ${d.filingDate}` : null, d?.publisher,
      s.note && !/^https?:/.test(s.note) ? s.note : null,
    ].filter(Boolean).join(' · ') || null;
    const url = d?.url ?? (s.note && /^https?:/.test(s.note) ? s.note : null);
    return {
      marker: index[s.id]!, id: s.id, label: s.label, type: sourceTypeLabel(s), kind: s.kind, asOf: s.asOf, provider: s.origin, reliability: s.reliability, reference, url, document: d, providerInfo: s.provider ?? null,
      notice: s.provider?.development ? DEV_NOTICE : null,
    };
  });
}

/** content 안에서 sourceId / sourceIds 를 모은다 (Cell · NarrativeItem · RiskItem · dataSource …). */
export function collectSourceIds(content: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(content)) content.forEach((x) => collectSourceIds(x, out));
  else if (content && typeof content === 'object') {
    const r = content as Record<string, unknown>;
    if (typeof r.sourceId === 'string') out.add(r.sourceId);
    if (Array.isArray(r.sourceIds)) r.sourceIds.forEach((x) => typeof x === 'string' && out.add(x));
    for (const v of Object.values(r)) if (v && typeof v === 'object') collectSourceIds(v, out);
  }
  return out;
}
