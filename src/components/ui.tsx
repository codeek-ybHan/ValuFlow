import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** 상태 표시: 알약(버튼처럼 보임) 대신 점 + 텍스트. 상태가 아닌 보조 라벨은 .chip 을 쓴다. */
export function StatusBadge({ label }: { label: string }) {
  return <span className={`status status-${label.toLowerCase().replace(/\s+/g, '-')}`}><i aria-hidden />{label}</span>;
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
  const empty = value === '—';
  return (
    <div className="kpi">
      <div className="kpi-main">
        <div className="kpi-label">{label}</div>
        <div className={`kpi-value num${empty ? ' empty' : ''}`}>{value}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
      {icon && <div className="kpi-tile">{icon}</div>}
    </div>
  );
}

/** 페이지 제목 영역. actions 는 제목 오른쪽(좁은 화면에서는 아래)에 놓인다. */
export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-row">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** 기업을 선택하기 전의 공통 빈 상태. Historical · Valuation · AI · Report 의 어떤 데이터도 보이지 않고 기업 검색/선택으로 안내한다. */
export const NO_COMPANY_MESSAGE = '기업을 선택해 기업가치평가를 시작하세요.';
export function NoCompanyState() {
  return (
    <div className="empty-state no-company" role="status" data-empty="no-company">
      <h3>{NO_COMPANY_MESSAGE}</h3>
      <Link className="btn primary" to="/workspace">기업 검색 · 선택</Link>
    </div>
  );
}

export function ComingSoon({ comingIn, children }: { comingIn: string; children?: ReactNode }) {
  return (
    <div className="coming">
      <span className="chip">{comingIn}</span>
      <p className="muted">이 기능은 아직 구현되지 않았습니다. 가짜 결과를 보여주지 않고 개발 예정 상태로 표시합니다.</p>
      {children}
    </div>
  );
}

export const BackLink = ({ to, children }: { to: string; children: ReactNode }) => <Link className="back" to={to}>← {children}</Link>;

export { newestFirstOrder } from '../engine/columnOrder.ts';

// ---- 숫자 포맷 ----
export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPct = (n: number | null | undefined, digits = 1) => (n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(digits)}%`);
/** 끝자리 0 을 줄인 퍼센트: 0.075 → '7.5%', 0.081375 → '8.1375%', 0.02 → '2%' (분석 범위 / Base 값 표기용) */
export const fmtPctTrim = (n: number | null | undefined, maxDigits = 4) => (n == null || !Number.isFinite(n) ? '—' : `${Number((n * 100).toFixed(maxDigits))}%`);
