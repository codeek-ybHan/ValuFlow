// HTML Renderer: RenderModel → HTML. 같은 RenderModel 을 PDF Renderer(backend)도 그린다. 값은 RenderModel 의 표시 문자열을 그대로 쓴다 (계산 · 재서식 없음).
import type { RCell, RColumn, RenderBlock, RenderModel, RRow } from './types.ts';
import { chartToSvg } from './svg.ts';

const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** footnote marker: [S1] — Sources section 의 항목(#src-S1)으로 연결된다. */
export const markerHtml = (markers: string[]): string => (markers.length === 0 ? '' : `<sup class="fn">${markers.map((m) => `[<a href="#src-${esc(m)}" data-marker="${esc(m)}">${esc(m)}</a>]`).join('')}</sup>`);

function cellHtml(c: RCell, align: 'left' | 'right'): string {
  const cls = `${align === 'right' ? 'num' : ''}${c.flag ? ` flag-${c.flag}` : ''}`.trim();
  if (c.text === null) return `<td class="${cls} empty" title="${esc(c.reason)}">—</td>`;
  const tag = c.flag === 'base' ? ' <span class="tag">Base</span>' : c.flag === 'invalid' ? ' <span class="tag">invalid</span>' : '';
  return `<td class="${cls}">${esc(c.text)}${c.alt ? ` <span class="alt">(${esc(c.alt)})</span>` : ''}${tag}${markerHtml(c.markers)}</td>`;
}

function tableHtml(b: Extract<RenderBlock, { type: 'table' }>): string {
  const periodCols = b.columns.some((c) => c.kindLabel !== null);
  const head = `<tr>${b.columns.map((c: RColumn) => `<th class="${c.align === 'right' ? 'num' : ''}">${esc(c.label)}${c.kindLabel ? `<small class="kind">${esc(c.kindLabel)}</small>` : ''}</th>`).join('')}</tr>`;
  const rows = b.rows.map((r: RRow) => {
    const label = `${r.operator ? `<span class="op">${esc(r.operator)}</span> ` : ''}${esc(r.label)}${!periodCols && r.kindLabel ? ` <small class="kind">${esc(r.kindLabel)}</small>` : ''}${r.note ? `<small class="note">${esc(r.note)}</small>` : ''}`;
    return `<tr class="${r.emphasis ? 'total' : ''}"><th scope="row">${label}</th>${r.cells.map((c, i) => cellHtml(c, b.columns[i + 1]?.align ?? 'right')).join('')}</tr>`;
  }).join('');
  return `<figure class="tbl" id="tbl-${esc(b.id)}"><figcaption>${esc(b.title)}${markerHtml(b.markers)}</figcaption>${b.notices.map((n) => `<p class="tbl-note">${esc(n)}</p>`).join('')}<table><thead>${head}</thead><tbody>${rows}</tbody></table></figure>`;
}

function blockHtml(b: RenderBlock): string {
  switch (b.type) {
    case 'cover':
      return `<section class="cover"><p class="eyebrow">Valuation Report</p><h1>${esc(b.company)}</h1><p class="cover-title">${esc(b.title)}</p>${b.subtitle ? `<p class="cover-sub">${esc(b.subtitle)}</p>` : ''}<dl class="cover-meta"><div><dt>Company</dt><dd>${esc(b.company)}${b.ticker ? ` (${esc(b.ticker)})` : ''}</dd></div><div><dt>Valuation Date</dt><dd>${esc(b.valuationDate ?? '-')}</dd></div><div><dt>Created At</dt><dd>${esc(b.createdAt)}</dd></div><div><dt>Currency</dt><dd>${esc(b.currency)}</dd></div><div><dt>Monetary Unit</dt><dd>${esc(b.monetaryUnit)} (주당 ${esc(b.perShareUnit)})</dd></div><div><dt>Report Version</dt><dd>${esc(b.version)}</dd></div></dl></section>`;
    case 'banner': return `<aside class="banner" role="note"><strong>${esc(b.title)}</strong><span>${esc(b.text)}</span></aside><div class="page-break"></div>`;
    case 'heading': return `${b.pageBreakBefore ? '<div class="page-break"></div>' : ''}<h2 id="${esc(b.id)}" data-status="${esc(b.status)}">${b.number ? `<span class="no">${esc(b.number)}.</span> ` : ''}${esc(b.text)}</h2>`;
    case 'notice': return `<p class="notice notice-${b.kind}" role="note">${esc(b.text)}</p>`;
    case 'paragraph': return `<p class="${b.muted ? 'muted' : ''}">${esc(b.text)}${markerHtml(b.markers)}</p>`;
    case 'kpis': return `<div class="kpis">${b.items.map((k) => `<div class="kpi"><div class="kpi-label">${esc(k.label)}${k.kindLabel ? ` <small class="kind">${esc(k.kindLabel)}</small>` : ''}</div><div class="kpi-value">${k.value.text === null ? '—' : esc(k.value.text)}${markerHtml(k.value.markers)}</div>${k.value.alt ? `<div class="kpi-alt">${esc(k.value.alt)}</div>` : ''}</div>`).join('')}</div>`;
    case 'keyvalues': return `<div class="kvs">${b.title ? `<h3>${esc(b.title)}</h3>` : ''}<dl>${b.items.map((i) => `<div class="${i.emphasis ? 'total' : ''}"><dt>${esc(i.label)}${i.kindLabel ? ` <small class="kind">${esc(i.kindLabel)}</small>` : ''}</dt><dd${i.value.text === null ? ' class="empty"' : ''}>${i.value.text === null ? `— <small>${esc(i.value.reason)}</small>` : esc(i.value.text)}${i.value.alt ? ` <span class="alt">(${esc(i.value.alt)})</span>` : ''}${markerHtml(i.value.markers)}</dd></div>`).join('')}</dl></div>`;
    case 'table': return tableHtml(b);
    case 'chart': return `<figure class="chart-fig" id="chart-${esc(b.id)}"><figcaption>${esc(b.chart.title)}${markerHtml(b.chart.markers)}</figcaption>${chartToSvg(b.chart)}</figure>`;
    case 'narrative': return `<div class="narr"><h3>${esc(b.title)}</h3><ul>${b.items.map((i) => `<li class="${i.label === 'Fact' ? 'fact' : 'judgment'}"><span class="badge">${i.label === 'Fact' ? 'FACT' : 'JUDGMENT'}</span> ${esc(i.text)}${markerHtml(i.markers)}${i.confidence ? ` <small class="conf">${esc(i.confidence)} Confidence</small>` : ''}</li>`).join('')}</ul>${b.note ? `<p class="muted">${esc(b.note)}</p>` : ''}</div>`;
    case 'list': return `<div class="lst">${b.title ? `<h3>${esc(b.title)}</h3>` : ''}<ul>${b.items.map((i) => `<li>${esc(i.text)}${markerHtml(i.markers)}${i.note ? ` <small class="note">${esc(i.note)}</small>` : ''}</li>`).join('')}</ul></div>`;
    case 'sources': return `<ol class="sources">${b.entries.map((e) => `<li id="src-${esc(e.marker)}" data-marker="${esc(e.marker)}"><strong>[${esc(e.marker)}]</strong> ${esc(e.label)} <span class="type">${esc(e.type)}</span>${e.asOf ? ` · as of ${esc(e.asOf)}` : ''}${e.provider ? ` · ${esc(e.provider)}${e.reliability ? ` (${esc(e.reliability)})` : ''}` : ''}${e.reference ? `<div class="ref">${esc(e.reference)}</div>` : ''}${e.url ? `<div class="ref">${esc(e.url)}</div>` : ''}${e.notice ? `<div class="dev">${esc(e.notice)}</div>` : ''}</li>`).join('')}</ol>`;
  }
}

export const REPORT_CSS = `
.valuflow-report{font-family:'Pretendard Variable',Pretendard,-apple-system,'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif;color:#1c1e22;line-height:1.55;font-size:13px;max-width:860px;margin:0 auto}
.valuflow-report h1{font-size:34px;margin:6px 0 4px;letter-spacing:-.02em}
.valuflow-report h2{font-size:19px;margin:30px 0 10px;padding-bottom:6px;border-bottom:2px solid #2a2e35;break-after:avoid}
.valuflow-report h2 .no{color:#666}
.valuflow-report h3{font-size:14px;margin:16px 0 6px}
.valuflow-report .cover{padding:48px 0 24px}
.valuflow-report .eyebrow{letter-spacing:.14em;text-transform:uppercase;color:#666;font-weight:700;font-size:12px;margin:0}
.valuflow-report .cover-title{font-size:20px;margin:0}.valuflow-report .cover-sub{color:#444;font-size:16px;margin:4px 0 20px}
.valuflow-report .cover-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 28px;max-width:560px;margin:0}
.valuflow-report .cover-meta dt{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.valuflow-report .cover-meta dd{margin:0;font-weight:600}
.valuflow-report .banner{border:2px solid #7a5a12;background:#f6eed8;padding:10px 14px;margin:16px 0;display:flex;flex-direction:column;gap:2px}
.valuflow-report .notice{border-left:4px solid #7a5a12;background:#faf5e6;padding:6px 10px;margin:8px 0;font-size:12.5px}
.valuflow-report .muted{color:#666;font-size:12px}
.valuflow-report .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:12px 0}
.valuflow-report .kpi{border:1px solid #d0d0cb;padding:10px 12px;break-inside:avoid}.valuflow-report .kpi-label{font-size:11px;color:#555}.valuflow-report .kpi-value{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}.valuflow-report .kpi-alt{font-size:11px;color:#666}
.valuflow-report figure{margin:14px 0;break-inside:avoid}.valuflow-report figcaption{font-weight:650;font-size:12.5px;margin-bottom:4px}
.valuflow-report table{border-collapse:collapse;width:100%;font-size:12px}
.valuflow-report th,.valuflow-report td{border-bottom:1px solid #e0e0dc;padding:5px 8px;text-align:left;vertical-align:top}
.valuflow-report thead th{border-bottom:2px solid #2a2e35;background:#f1f1ee;font-weight:650}
.valuflow-report .num{text-align:right;font-variant-numeric:tabular-nums}
.valuflow-report tr.total th,.valuflow-report tr.total td{font-weight:700;border-top:1px solid #2a2e35}
.valuflow-report td.empty{color:#888}.valuflow-report td.flag-base{outline:2px solid #111;outline-offset:-2px;font-weight:700}
.valuflow-report .tag{font-size:10px;border:1px solid #111;padding:0 4px;margin-left:2px;font-weight:700}
.valuflow-report small.kind{display:block;font-weight:500;color:#666;font-size:10px}
.valuflow-report tbody th small.kind{display:inline;margin-left:4px}
.valuflow-report small.note,.valuflow-report .tbl-note{color:#666;font-size:11px;display:block}
.valuflow-report .alt{color:#666;font-size:11px}
.valuflow-report sup.fn{font-size:9px;margin-left:1px}.valuflow-report sup.fn a{color:#2a2e35;text-decoration:none;font-weight:700}
.valuflow-report .kvs dl{margin:0}.valuflow-report .kvs dl>div{display:flex;gap:16px;border-bottom:1px solid #e0e0dc;padding:4px 0}.valuflow-report .kvs dt{flex:0 0 220px;color:#444}.valuflow-report .kvs dd{margin:0;font-weight:600}
.valuflow-report .narr li,.valuflow-report .lst li{margin:6px 0}.valuflow-report .narr ul,.valuflow-report .lst ul{padding-left:18px}
.valuflow-report .badge{font-size:10px;font-weight:800;letter-spacing:.06em;border:1px solid #2a2e35;padding:0 5px}
.valuflow-report li.judgment{font-style:italic}.valuflow-report li.judgment .badge{border-style:dashed}
.valuflow-report .conf{color:#666}
.valuflow-report ol.sources{padding-left:0;list-style:none}.valuflow-report ol.sources li{margin:8px 0;padding:6px 8px;border-left:3px solid #d0d0cb;break-inside:avoid}
.valuflow-report ol.sources li.hl{border-left-color:#111;background:#f1f1ee}
.valuflow-report .sources .type{font-size:11px;border:1px solid #888;padding:0 4px}.valuflow-report .sources .ref{color:#555;font-size:11.5px}.valuflow-report .sources .dev{color:#7a5a12;font-size:11.5px;font-weight:600}
.valuflow-report .page-break{break-after:page;height:0}
.valuflow-report svg.chart{max-width:100%;height:auto;font-family:inherit}
@media print{.valuflow-report{max-width:none;font-size:11.5px}.valuflow-report .page-break{page-break-after:always}}
`;

export interface HtmlOptions { mode: 'document' | 'fragment' }

/** mode=fragment: Preview 에 넣는 본문(<div class="valuflow-report">…) · mode=document: 단독 HTML 파일(스타일 · A4 인쇄 설정 포함). */
export function renderReportHtml(rm: RenderModel, opts: HtmlOptions = { mode: 'document' }): string {
  const body = `<div class="valuflow-report" lang="ko" data-report-id="${esc(rm.meta.reportId)}">${rm.blocks.map(blockHtml).join('\n')}<footer class="muted">${esc(rm.meta.footer)}</footer></div>`;
  if (opts.mode === 'fragment') return body;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(rm.meta.title)}</title><meta name="generator" content="ValuFlow report ${esc(rm.meta.schemaVersion)} / ${esc(rm.meta.templateId)} v${esc(rm.meta.templateVersion)}"><style>@page{size:A4;margin:18mm 16mm}body{margin:24px;background:#fff}${REPORT_CSS}</style></head><body>${body}</body></html>`;
}
