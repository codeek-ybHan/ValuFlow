// ChartModel → SVG (특정 chart library 에 종속되지 않는 공통 파이프라인). 숫자를 새로 만들지 않는다: 값 표시는 모두 ChartPoint.text 이고 축에는 숫자 눈금을 그리지 않는다.
// 접근성: role=img + <title>/<desc>(accessibleDescription). 색에 의미를 두지 않는다: 계열은 범례 문구 · 직접 값 라벨로, Base/invalid 는 문구와 테두리로 구분한다.
import type { ChartModel, ChartPoint, HeatmapCell } from '../presentation/types.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FILLS = ['#2a2e35', '#8c929c', '#c6cad1', '#5b616b'];
const W = 640, H = 300, L = 24, R = 24, T = 34, B = 56;

const num = (p: ChartPoint) => (p.state === 'ok' && typeof p.value === 'number' ? p.value : null);
const f1 = (n: number) => n.toFixed(1);

function frame(c: ChartModel, body: string, extra = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(c.title)}" class="chart chart-${c.type}"${extra}><title>${esc(c.title)}</title><desc>${esc(c.accessibleDescription)}</desc>${body}</svg>`;
}

function legend(c: ChartModel): string {
  return c.series.map((s, i) => `<g transform="translate(${L + i * 170},${H - 14})"><rect width="10" height="10" fill="${FILLS[i % FILLS.length]}"/><text x="14" y="9" font-size="11">${esc(s.label)}</text></g>`).join('');
}

function bars(c: ChartModel, stacked: boolean): string {
  const all = c.series.flatMap((s) => s.points.map(num)).filter((v): v is number => v !== null);
  if (all.length === 0) return frame(c, `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12">표시할 값이 없습니다</text>`);
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const plotH = H - T - B, plotW = W - L - R;
  const y = (v: number) => T + (max - v) / span * plotH;
  const groupW = plotW / Math.max(1, c.categories.length);
  const barW = Math.min(46, (groupW * 0.7) / (stacked ? 1 : c.series.length));
  let out = `<line x1="${L}" x2="${W - R}" y1="${f1(y(0))}" y2="${f1(y(0))}" stroke="#666" stroke-width="1"/>`;
  c.categories.forEach((cat, ci) => {
    const gx = L + ci * groupW + groupW / 2;
    out += `<text x="${f1(gx)}" y="${H - B + 16}" text-anchor="middle" font-size="11">${esc(cat)}</text>`;
    let acc = 0;
    c.series.forEach((s, si) => {
      const p = s.points[ci]!;
      const v = num(p);
      const x = stacked ? gx - barW / 2 : gx - (c.series.length * barW) / 2 + si * barW;
      if (v === null) { out += `<text x="${f1(x + barW / 2)}" y="${f1(y(0) - 4)}" text-anchor="middle" font-size="9">—</text>`; return; }
      const top = stacked ? y(acc + v) : y(Math.max(v, 0));
      const h = Math.abs(stacked ? y(acc) - y(acc + v) : y(v) - y(0));
      out += `<rect x="${f1(x)}" y="${f1(top)}" width="${f1(barW - 2)}" height="${f1(Math.max(h, 0.5))}" fill="${FILLS[si % FILLS.length]}"/>`;
      out += `<text x="${f1(x + (barW - 2) / 2)}" y="${f1(v >= 0 ? top - 3 : top + h + 10)}" text-anchor="middle" font-size="9">${esc(p.text ?? '')}</text>`;
      if (stacked) acc += v;
    });
  });
  return frame(c, out + legend(c));
}

function lines(c: ChartModel): string {
  const all = c.series.flatMap((s) => s.points.map(num)).filter((v): v is number => v !== null);
  if (all.length === 0) return frame(c, `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12">표시할 값이 없습니다</text>`);
  const max = Math.max(...all), min = Math.min(...all);
  const span = max - min || 1;
  const plotH = H - T - B - 12, plotW = W - L - R;
  const y = (v: number) => T + 8 + (max - v) / span * plotH;
  const step = plotW / Math.max(1, c.categories.length);
  let out = '';
  c.categories.forEach((cat, i) => { out += `<text x="${f1(L + i * step + step / 2)}" y="${H - B + 16}" text-anchor="middle" font-size="11">${esc(cat)}</text>`; });
  c.series.forEach((s, si) => {
    let path = '';
    let pen = false;
    s.points.forEach((p, i) => { const v = num(p); if (v === null) { pen = false; return; } path += `${pen ? 'L' : 'M'}${f1(L + i * step + step / 2)},${f1(y(v))} `; pen = true; });
    const dash = si === 0 ? '' : si === 1 ? ' stroke-dasharray="6 3"' : ' stroke-dasharray="2 3"';
    out += `<path d="${path.trim()}" fill="none" stroke="${FILLS[si % FILLS.length]}" stroke-width="2"${dash}/>`;
    s.points.forEach((p, i) => {
      const v = num(p);
      const x = L + i * step + step / 2;
      if (v === null) { out += `<text x="${f1(x)}" y="${H - B - 4}" text-anchor="middle" font-size="9">—</text>`; return; }
      out += `<circle cx="${f1(x)}" cy="${f1(y(v))}" r="3.5" fill="${FILLS[si % FILLS.length]}"/><text x="${f1(x)}" y="${f1(si === 0 ? y(v) + 14 : y(v) - 7)}" text-anchor="middle" font-size="9">${esc(p.text ?? '')}</text>`;
    });
  });
  return frame(c, out + legend(c));
}

function waterfall(c: ChartModel): string {
  const steps = c.waterfall ?? [];
  const vals = steps.map((s) => num(s.point));
  if (vals.some((v) => v === null)) return frame(c, `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12">표시할 값이 없습니다</text>`);
  const nums = vals as number[];
  const top = Math.max(...nums.map(Math.abs));
  const plotH = H - T - B, y = (v: number) => T + (top - v) / (top || 1) * plotH;
  const bw = 90, gap = (W - L - R - bw * steps.length) / Math.max(1, steps.length - 1 || 1);
  let out = `<line x1="${L}" x2="${W - R}" y1="${f1(y(0))}" y2="${f1(y(0))}" stroke="#666"/>`;
  let level = 0;
  steps.forEach((s, i) => {
    const v = nums[i]!;
    const x = L + i * (bw + gap);
    let from = 0, to = v;
    if (s.role === 'delta') { from = level; to = s.operator === '-' ? level - Math.abs(v) : level + Math.abs(v); }
    if (s.role === 'start') level = v;
    if (s.role === 'delta') level = to;
    const y1 = y(Math.max(from, to)), h = Math.abs(y(from) - y(to));
    out += `<rect x="${f1(x)}" y="${f1(y1)}" width="${bw}" height="${f1(Math.max(h, 1))}" fill="${s.role === 'delta' ? '#c6cad1' : FILLS[0]}" stroke="#2a2e35"${s.role === 'delta' ? ' stroke-dasharray="4 2"' : ''}/>`;
    out += `<text x="${f1(x + bw / 2)}" y="${f1(y1 - 6)}" text-anchor="middle" font-size="11" font-weight="600">${esc(`${s.operator ? `${s.operator === '=' ? '=' : s.operator} ` : ''}${s.point.text ?? ''}`)}</text>`;
    out += `<text x="${f1(x + bw / 2)}" y="${H - B + 16}" text-anchor="middle" font-size="11">${esc(s.label)}</text>`;
  });
  return frame(c, out);
}

function heatmap(c: ChartModel): string {
  const h = c.heatmap!;
  const flat: HeatmapCell[] = h.cells.flat();
  const vs = flat.map((x) => x.value).filter((v): v is number => v !== null);
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const cw = (W - 120) / h.colLabels.length, ch = 34;
  const Hh = T + 24 + h.rowLabels.length * ch + 30;
  let out = `<text x="4" y="${T + 14}" font-size="10">g \\ WACC</text>`;
  h.colLabels.forEach((l, i) => { out += `<text x="${f1(110 + i * cw + cw / 2)}" y="${T + 14}" text-anchor="middle" font-size="11">${esc(l)}</text>`; });
  h.rowLabels.forEach((rl, r) => {
    out += `<text x="104" y="${T + 24 + r * ch + ch / 2 + 4}" text-anchor="end" font-size="11">${esc(rl)}</text>`;
    h.cells[r]!.forEach((cell, i) => {
      const shade = cell.value === null ? 255 : Math.round(246 - ((cell.value - min) / span) * 60);   // 값 크기에 따른 옅은 음영 (의미는 텍스트가 가진다)
      const x = 110 + i * cw, y = T + 24 + r * ch;
      out += `<rect x="${f1(x)}" y="${y}" width="${f1(cw - 2)}" height="${ch - 2}" fill="rgb(${shade},${shade},${shade})" stroke="${cell.isBaseCase ? '#111' : '#bbb'}" stroke-width="${cell.isBaseCase ? 3 : 1}"${cell.flag === 'invalid' ? ' stroke-dasharray="3 3"' : ''}/>`;
      out += `<text x="${f1(x + (cw - 2) / 2)}" y="${y + 14}" text-anchor="middle" font-size="10">${esc(cell.text ?? '—')}</text>`;
      if (cell.isBaseCase) out += `<text x="${f1(x + (cw - 2) / 2)}" y="${y + 26}" text-anchor="middle" font-size="9" font-weight="700">Base</text>`;
      if (cell.flag === 'invalid') out += `<text x="${f1(x + (cw - 2) / 2)}" y="${y + 26}" text-anchor="middle" font-size="9">invalid</text>`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="${esc(c.title)}" class="chart chart-heatmap"><title>${esc(c.title)}</title><desc>${esc(c.accessibleDescription)}</desc>${out}</svg>`;
}

function range(c: ChartModel): string {
  const items = c.range ?? [];
  const vs = items.flatMap((i) => [num(i.low), num(i.high)]).filter((v): v is number => v !== null);
  if (vs.length === 0) return frame(c, `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12">표시할 값이 없습니다</text>`);
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const rowH = 40, plotL = 190, plotR = W - 110;
  const x = (v: number) => plotL + (v - min) / span * (plotR - plotL);
  const Hh = T + items.length * rowH + 20;
  let out = '';
  items.forEach((it, i) => {
    const yy = T + i * rowH + 18;
    const lo = num(it.low), hi = num(it.high), b = it.base ? num(it.base) : null;
    out += `<text x="4" y="${yy + 4}" font-size="11">${esc(it.label)}</text>`;
    if (lo === null || hi === null) { out += `<text x="${plotL}" y="${yy + 4}" font-size="11">—</text>`; return; }
    out += `<line x1="${f1(x(lo))}" x2="${f1(x(hi))}" y1="${yy}" y2="${yy}" stroke="#2a2e35" stroke-width="4"/><circle cx="${f1(x(lo))}" cy="${yy}" r="4" fill="#2a2e35"/><circle cx="${f1(x(hi))}" cy="${yy}" r="4" fill="#2a2e35"/>`;
    out += `<text x="${f1(x(lo))}" y="${yy - 8}" text-anchor="middle" font-size="9">Low ${esc(it.low.text ?? '')}</text><text x="${f1(x(hi))}" y="${yy - 8}" text-anchor="middle" font-size="9">High ${esc(it.high.text ?? '')}</text>`;
    if (b !== null) out += `<path d="M${f1(x(b))},${yy - 7} l6,7 l-6,7 l-6,-7 z" fill="#fff" stroke="#111" stroke-width="2"/><text x="${f1(x(b))}" y="${yy + 22}" text-anchor="middle" font-size="9" font-weight="700">Base ${esc(it.base?.text ?? '')}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="${esc(c.title)}" class="chart chart-range"><title>${esc(c.title)}</title><desc>${esc(c.accessibleDescription)}</desc>${out}</svg>`;
}

export function chartToSvg(c: ChartModel): string {
  switch (c.type) {
    case 'bar': case 'grouped-bar': return bars(c, false);
    case 'stacked-bar': return bars(c, true);
    case 'line': return lines(c);
    case 'waterfall': return waterfall(c);
    case 'heatmap': return heatmap(c);
    case 'range': return range(c);
  }
}
