// 의존성 없는 간단한 SVG 차트. 값이 없는 점(null)은 그리지 않는다.
import { fmtNum } from './ui';

export interface Series {
  name: string;
  values: (number | null)[];
  color: string;
  dashed?: boolean;
}

const W = 520;
const H = 220;
const P = { l: 56, r: 16, t: 14, b: 28 };

function scale(all: number[], includeZero: boolean) {
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    max += 1;
    min -= 1;
  }
  const pad = (max - min) * 0.08;
  return { min: includeZero && min === 0 ? 0 : min - pad, max: max + pad };
}

function Frame({ title, labels, series, children, ticks, fmt }: { title: string; labels: string[]; series: Series[]; children: React.ReactNode; ticks: number[]; fmt: (n: number) => string }) {
  const { min, max } = scale(ticks, true);
  const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const v = min + (max - min) * t;
          return (
            <g key={t}>
              <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="grid" />
              <text x={P.l - 6} y={y(v) + 4} textAnchor="end" className="axis">{fmt(v)}</text>
            </g>
          );
        })}
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="zero" />
        {labels.map((l, i) => (
          <text key={l} x={P.l + ((W - P.l - P.r) * (i + 0.5)) / labels.length} y={H - 8} textAnchor="middle" className="axis">{l}</text>
        ))}
        {children}
      </svg>
      <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
    </figure>
  );
}

export function BarChart({ title, labels, series, fmt = (n: number) => fmtNum(n) }: { title: string; labels: string[]; series: Series[]; fmt?: (n: number) => string }) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (all.length === 0) return <Empty title={title} />;
  const { min, max } = scale(all, true);
  const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const slot = (W - P.l - P.r) / labels.length;
  const bw = Math.min(40, (slot * 0.7) / series.length);
  return (
    <Frame title={title} labels={labels} series={series} ticks={all} fmt={fmt}>
      {series.map((s, si) =>
        s.values.map((v, i) =>
          v == null ? null : (
            <rect key={`${si}-${i}`} x={P.l + slot * i + (slot - bw * series.length) / 2 + bw * si} width={bw - 2} y={Math.min(y(v), y(0))} height={Math.abs(y(v) - y(0))} fill={s.color}>
              <title>{`${s.name} ${labels[i]}: ${fmt(v)}`}</title>
            </rect>
          ),
        ),
      )}
    </Frame>
  );
}

export function LineChart({ title, labels, series, fmt }: { title: string; labels: string[]; series: Series[]; fmt: (n: number) => string }) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (all.length === 0) return <Empty title={title} />;
  const { min, max } = scale(all, true);
  const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const x = (i: number) => P.l + ((W - P.l - P.r) * (i + 0.5)) / labels.length;
  return (
    <Frame title={title} labels={labels} series={series} ticks={all} fmt={fmt}>
      {series.map((s) => {
        const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as const));
        const d = pts.reduce<string>((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? 'L' : 'M'}${p[0]},${p[1]}` : acc), '');
        return (
          <g key={s.name}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} />
            {pts.map((p, i) => p && (
              <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill={s.color}><title>{`${s.name} ${labels[i]}: ${fmt(s.values[i]!)}`}</title></circle>
            ))}
          </g>
        );
      })}
    </Frame>
  );
}

function Empty({ title }: { title: string }) {
  return (
    <figure className="chart chart-empty">
      <figcaption>{title}</figcaption>
      <p className="muted">표시할 데이터가 없습니다. 해당 항목을 데이터셋에 입력하세요.</p>
    </figure>
  );
}
