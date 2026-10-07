// DataQuality → 화면 표시 모델. DataQuality 전체 JSON 을 보여 주는 대신 필드 상태 · 데이터 노트 · 대표 계정의 출처(mapping trace)만 추린다.
// 경고(warning)는 오류가 아니라 "Review Required / Data Note" 수준으로 구분한다.
import { ACCOUNT_RULES, type CanonicalField } from '../data/normalization/accounts.ts';
import type { DataQuality, FieldStatus } from '../data/normalization/quality.ts';

export interface QualityNote { level: 'review' | 'note'; text: string }
export interface FieldStatusRow { field: CanonicalField; label: string; status: FieldStatus }
export interface SourceRow {
  field: CanonicalField;
  label: string;
  /** 추적 기준 연도 (가장 최근) */
  fiscalYear: number | null;
  status: FieldStatus;
  /** 값이 없으면 null */
  accountName: string | null;
  accountId: string | null;
  matchType: string | null;
  basis: string | null;
  rawStatementType: string | null;
  /** 후보가 여러 개였거나 weak 매핑일 때 이유 */
  detail: string | null;
  components: { accountName: string; accountId: string | null; matchType: string }[];
}
export interface QualityView {
  notes: QualityNote[];
  fields: FieldStatusRow[];
  sources: SourceRow[];
  basisLine: string;
}

const LABEL = new Map(ACCOUNT_RULES.map((r) => [r.field, r.label]));
/** 화면에 보여 줄 대표 필드 (표 / 출처 보기) */
export const KEY_QUALITY_FIELDS: CanonicalField[] = [
  'revenue', 'operatingProfit', 'netIncome', 'accountsReceivable', 'inventory', 'accountsPayable', 'cash', 'interestBearingDebt', 'leaseLiabilities', 'cfo', 'ppeAcquisition', 'depreciationAmortization',
];

/** 검토가 필요한 경고: 값의 의미 · 범위가 달라질 수 있는 것. 나머지는 데이터 노트. */
const REVIEW = /financial-business|statements used because|differ from|differs from|Sign anomaly|unit mismatch|outside ±100%|multiple different values|mapped from broader|Unsupported/;

export function buildQualityView(q: DataQuality | null): QualityView | null {
  if (!q) return null;
  const years = [...new Set(q.trace.map((t) => t.fiscalYear))].sort((a, b) => a - b);
  const latest = years.length > 0 ? years[years.length - 1] : null;
  const sources: SourceRow[] = KEY_QUALITY_FIELDS.map((field) => {
    const t = latest === null ? undefined : q.trace.find((x) => x.canonicalField === field && x.fiscalYear === latest);
    const status = q.fields[field]?.status ?? 'missing';
    return {
      field, label: LABEL.get(field) ?? field, fiscalYear: t ? latest : null, status,
      accountName: t?.sourceAccountName ?? null, accountId: t?.sourceAccountId ?? null, matchType: t?.matchType ?? null,
      basis: t?.basis ?? null, rawStatementType: t?.rawStatementType ?? null, detail: t?.selection ?? null,
      components: (t?.components ?? []).map((c) => ({ accountName: c.accountName, accountId: c.accountId, matchType: c.matchType })),
    };
  });
  return {
    notes: q.warnings.map((text) => ({ level: REVIEW.test(text) ? 'review' : 'note', text } as QualityNote)),
    fields: KEY_QUALITY_FIELDS.map((field) => ({ field, label: LABEL.get(field) ?? field, status: q.fields[field]?.status ?? 'missing' })),
    sources,
    basisLine: q.basisFallback ? `${q.basisUsed} (요청: ${q.basisRequested} → 대체 사용)` : q.basisUsed,
  };
}
