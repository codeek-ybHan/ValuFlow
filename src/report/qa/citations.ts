// Citation 검증: footnote marker 와 Source Registry 의 일치 (orphan marker · 알 수 없는 sourceId · 사용되지 않는 출처).
// 정책: 목록(Sources)에 있는 모든 출처는 Report 안에서 한 번 이상 인용되어야 한다 (인용되지 않은 출처는 buildReport 가 목록에서 뺀다).
import type { Presentation } from '../presentation/types.ts';
import { collectSourceIds, markersOf } from '../templates/footnotes.ts';
import type { ReportDocument } from '../templates/types.ts';

export interface CitationReport {
  /** Report 에서 인용된 sourceId 수 */
  referenced: number;
  /** Sources 에 없는 marker (표 · 서술 · section 에서 쓰였지만 등록되지 않음) */
  orphanMarkers: string[];
  /** 출처 등록(Source Registry)에 없는 sourceId — marker 를 만들 수 없다 */
  unknownSourceIds: string[];
  /** Sources 목록에 있지만 어디에서도 인용되지 않은 출처 */
  unusedSources: string[];
  /** marker 번호가 S1.. 연속이고 같은 출처는 같은 번호인가 */
  numberingStable: boolean;
}

export function checkCitations(doc: ReportDocument, pres: Presentation): CitationReport {
  const registered = new Set(doc.sources.map((s) => s.id));
  const sectionIds = new Set<string>();
  for (const s of doc.sections) if (s.sectionId !== 'sources' && s.content) collectSourceIds(s.content, sectionIds);
  const used = new Set<string>([...sectionIds]);
  const markerSet = new Set<string>();
  for (const s of doc.sections) for (const m of s.sourceMarkers) markerSet.add(m);
  for (const t of Object.values(pres.tables)) for (const r of t.rows) for (const c of r.cells) { c.markers.forEach((m) => markerSet.add(m)); if (c.sourceId) used.add(c.sourceId); }
  for (const c of Object.values(pres.charts)) { c.markers.forEach((m) => markerSet.add(m)); c.sourceIds.forEach((id) => used.add(id)); }
  for (const k of pres.kpis) { k.cell.markers.forEach((m) => markerSet.add(m)); if (k.cell.sourceId) used.add(k.cell.sourceId); }
  const known = new Set(doc.sources.map((s) => s.marker));
  const idx = doc.footnoteIndex;
  return {
    referenced: used.size,
    orphanMarkers: [...markerSet].filter((m) => !known.has(m)),
    unknownSourceIds: [...used].filter((id) => !registered.has(id) || markersOf(idx, id).length === 0),
    unusedSources: doc.sources.filter((s) => !used.has(s.id)).map((s) => s.id),
    numberingStable: doc.sources.every((s, i) => s.marker === `S${i + 1}` && idx[s.id] === s.marker) && new Set(doc.sources.map((s) => s.id)).size === doc.sources.length,
  };
}
