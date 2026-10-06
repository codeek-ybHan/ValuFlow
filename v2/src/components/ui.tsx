import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function StatusBadge({ label }: { label: string }) {
  return <span className={`badge badge-${label.toLowerCase().replace(/\s+/g, '-')}`}>{label}</span>;
}

export function ProgressBar({ ratio, label }: { ratio: number; label?: string }) {
  const pct = Math.round(ratio * 100);
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Kpi({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-main">
        <div className="kpi-label">{label}</div>
        <div className="kpi-value num">{value}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
      {icon && <div className="kpi-tile">{icon}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function ComingSoon({ comingIn, children }: { comingIn: string; children?: ReactNode }) {
  return (
    <div className="coming">
      <span className="badge badge-locked">{comingIn}</span>
      <p className="muted">이 기능은 아직 구현되지 않았습니다. 가짜 결과를 보여주지 않고 개발 예정 상태로 표시합니다.</p>
      {children}
    </div>
  );
}

export const BackLink = ({ to, children }: { to: string; children: ReactNode }) => <Link className="back" to={to}>← {children}</Link>;

// ---- 숫자 포맷 ----
export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPct = (n: number | null | undefined, digits = 1) => (n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(digits)}%`);
