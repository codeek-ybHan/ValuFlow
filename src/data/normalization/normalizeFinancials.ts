// Raw(DartRawAccount[]) → Domain(HistoricalData) 변환. 순수 함수이며 입력을 바꾸지 않는다.
//  1) 기간 정규화  2) 단위 정규화(→ KRW million)  3) 연결/별도 기준 선택  4) 계정 매핑  5) 품질 보고
// 필수 계정이 하나라도 없으면 값을 만들어 채우지 않고 ok:false 로 돌려준다 (숨은 기본값 없음).
import type { HistoricalData, HistoricalSource } from '../types.ts';
import type { DartBasis, DartRawAccount, DartRawUnit } from '../dart/types.ts';
import { ACCOUNT_RULES, OPTIONAL_FIELDS, REQUIRED_FIELDS, normalizeAccountName, type AccountRule, type CanonicalField } from './accounts.ts';
import { buildPeriods, resolveRelativePeriod } from './periods.ts';
import type { DataQuality, FieldQuality } from './quality.ts';
import { toKrwMillion } from './units.ts';

export interface NormalizeInput {
  company: { name: string; corpCode?: string; stockCode?: string };
  accounts: readonly DartRawAccount[];
  /** 만들 회계연도. 예: [2023, 2024, 2025] */
  fiscalYears: readonly number[];
  /** 기본 Consolidated. */
  preferredBasis?: DartBasis;
  /** 선호 기준으로 데이터를 만들 수 없을 때 다른 기준을 쓸지 (기본 true). 쓰면 company.basis 와 quality 에 기록된다. */
  allowBasisFallback?: boolean;
  /** 계정에 unit 이 없을 때의 단위. OpenDART 금액은 원 단위이므로 기본 'KRW'. */
  defaultUnit?: DartRawUnit;
  fetchedAt: string;
  source?: HistoricalSource;
}

export type NormalizeResult =
  | { ok: true; data: HistoricalData; quality: DataQuality }
  | { ok: false; reason: string; missingRequired: CanonicalField[]; quality: DataQuality };

interface Resolved { year: number; account: DartRawAccount }

const otherBasis = (b: DartBasis): DartBasis => (b === 'Consolidated' ? 'Separate' : 'Consolidated');

function resolveYear(a: DartRawAccount): number | null {
  if (a.fiscalYear !== null) return a.fiscalYear;
  if (a.periodLabel && a.reportYear !== undefined) return resolveRelativePeriod(a.periodLabel, a.reportYear);
  return null;
}

function inRule(rule: AccountRule, a: DartRawAccount): 'strong' | { weak: string } | null {
  if (!rule.statements.includes(a.statementType)) return null;
  if (a.accountId && rule.ids?.includes(a.accountId)) return 'strong';
  const n = normalizeAccountName(a.accountName);
  if (rule.names.some((x) => normalizeAccountName(x) === n)) return 'strong';
  const weak = rule.weakNames?.find((w) => normalizeAccountName(w.name) === n);
  return weak ? { weak: weak.note } : null;
}

interface YearValue { value: number | null; sources: string[]; ambiguous: boolean; notes: string[] }

/** 한 규칙을 한 연도에 적용한다. 값은 KRW million. */
function applyRule(rule: AccountRule, rows: Resolved[], year: number, unitOf: (a: DartRawAccount) => DartRawUnit): YearValue {
  const mine = rows.filter((r) => r.year === year && r.account.amount !== null);
  const conv = (a: DartRawAccount) => {
    const v = toKrwMillion(a.amount as number, unitOf(a));
    return rule.magnitude ? Math.abs(v) : v;
  };

  if (rule.kind === 'sum') {
    const parts: { name: string; value: number }[] = [];
    for (const name of rule.names) {
      const hit = mine.find((r) => rule.statements.includes(r.account.statementType) && normalizeAccountName(r.account.accountName) === normalizeAccountName(name));
      if (hit) parts.push({ name: hit.account.accountName, value: conv(hit.account) });
    }
    if (parts.length === 0) return { value: null, sources: [], ambiguous: false, notes: [] };
    const notes = [`${rule.label} summed from: ${parts.map((p) => p.name).join(', ')}`];
    if (rule.warnIfPartial && parts.length < rule.names.length) notes.push(`${rule.label} is partial: only ${parts.map((p) => p.name).join(', ')} found`);
    return { value: parts.reduce((s, p) => s + p.value, 0), sources: parts.map((p) => p.name), ambiguous: false, notes };
  }

  const strong: DartRawAccount[] = [];
  const weak: { account: DartRawAccount; note: string }[] = [];
  for (const r of mine) {
    const m = inRule(rule, r.account);
    if (m === 'strong') strong.push(r.account);
    else if (m) weak.push({ account: r.account, note: m.weak });
  }
  const pool = strong.length > 0 ? strong : weak.map((w) => w.account);
  if (pool.length === 0) return { value: null, sources: [], ambiguous: false, notes: [] };
  const notes = strong.length === 0 ? [weak[0].note] : [];
  const values = pool.map(conv);
  const ambiguous = values.some((v) => v !== values[0]);
  if (ambiguous) notes.push(`${rule.label}: multiple different values found for ${year}, first one used`);
  return { value: values[0], sources: [pool[0].accountName], ambiguous, notes };
}

interface BasisBuild {
  series: Partial<Record<CanonicalField, (number | null)[]>>;
  fields: Partial<Record<CanonicalField, FieldQuality>>;
  notes: string[];
}

function buildForBasis(basis: DartBasis, resolved: Resolved[], years: number[], unitOf: (a: DartRawAccount) => DartRawUnit): BasisBuild {
  const rows = resolved.filter((r) => r.account.basis === basis);
  const series: BasisBuild['series'] = {};
  const fields: BasisBuild['fields'] = {};
  const notes: string[] = [];
  for (const rule of ACCOUNT_RULES) {
    const per = years.map((y) => applyRule(rule, rows, y, unitOf));
    series[rule.field] = per.map((p) => p.value);
    const missingYears = years.filter((_, i) => per[i].value === null);
    const status = missingYears.length === years.length ? 'missing' : missingYears.length > 0 ? 'partial' : per.some((p) => p.ambiguous) ? 'ambiguous' : 'available';
    fields[rule.field] = { status, missingYears, sources: [...new Set(per.flatMap((p) => p.sources))] };
    for (const n of new Set(per.flatMap((p) => p.notes))) notes.push(n);
  }
  return { series, fields, notes };
}

const isComplete = (b: BasisBuild) => REQUIRED_FIELDS.every((f) => b.fields[f]?.status === 'available' || b.fields[f]?.status === 'ambiguous');
const coverage = (b: BasisBuild) => REQUIRED_FIELDS.filter((f) => b.fields[f]?.status === 'available' || b.fields[f]?.status === 'ambiguous').length;

export function normalizeFinancials(input: NormalizeInput): NormalizeResult {
  const defaultUnit = input.defaultUnit ?? 'KRW';
  const unitOf = (a: DartRawAccount) => a.unit ?? defaultUnit;
  const requested = input.preferredBasis ?? 'Consolidated';
  const periods = buildPeriods(input.fiscalYears);
  const warnings: string[] = [];

  const resolved: Resolved[] = [];
  let unresolved = 0;
  for (const account of input.accounts) {
    const year = resolveYear(account);
    if (year === null) unresolved += 1;
    else if (periods.years.includes(year)) resolved.push({ year, account });
  }
  if (unresolved > 0) warnings.push(`${unresolved} account row(s) skipped: fiscal year could not be determined`);

  // 기준 선택: 선호 기준이 필수 계정을 모두 채우면 그것을, 아니면 (허용 시) 다른 기준을 쓴다.
  const first = buildForBasis(requested, resolved, periods.years, unitOf);
  let used = requested;
  let chosen = first;
  if (!isComplete(first) && (input.allowBasisFallback ?? true)) {
    const alt = buildForBasis(otherBasis(requested), resolved, periods.years, unitOf);
    if (isComplete(alt) || coverage(alt) > coverage(first)) { used = otherBasis(requested); chosen = alt; }
  }
  const basisFallback = used !== requested;
  if (basisFallback) {
    warnings.push(used === 'Separate'
      ? 'Separate statements used because consolidated data unavailable'
      : 'Consolidated statements used because separate data unavailable');
  }
  warnings.push(...chosen.notes);

  const missingRequired = REQUIRED_FIELDS.filter((f) => {
    const s = chosen.fields[f]?.status;
    return s !== 'available' && s !== 'ambiguous';
  });
  for (const f of OPTIONAL_FIELDS) {
    const q = chosen.fields[f];
    if (q?.status === 'missing') warnings.push(`${ACCOUNT_RULES.find((r) => r.field === f)!.label} account not found`);
    else if (q?.status === 'partial') warnings.push(`${ACCOUNT_RULES.find((r) => r.field === f)!.label} missing for ${q.missingYears.join(', ')}`);
  }
  for (const f of missingRequired) warnings.push(`${ACCOUNT_RULES.find((r) => r.field === f)!.label} account not found or incomplete`);

  const quality: DataQuality = { basisRequested: requested, basisUsed: used, basisFallback, fields: chosen.fields, warnings };
  if (periods.years.length === 0) return { ok: false, reason: 'fiscalYears 가 비어 있습니다.', missingRequired: [...REQUIRED_FIELDS], quality };
  if (missingRequired.length > 0) {
    return { ok: false, reason: `필수 계정을 찾지 못했습니다: ${missingRequired.join(', ')}`, missingRequired, quality };
  }

  const num = (f: CanonicalField) => chosen.series[f] as number[];
  const optional = (f: CanonicalField) => (chosen.fields[f]?.status === 'available' ? { value: num(f) } : null);
  const cash = optional('cash'), debt = optional('interestBearingDebt'), da = optional('depreciationAmortization');

  const data: HistoricalData = {
    meta: { corpCode: input.company.corpCode, stockCode: input.company.stockCode, source: input.source ?? 'DART Annual Report', fetchedAt: input.fetchedAt },
    company: {
      name: input.company.name,
      ticker: input.company.stockCode ?? '',
      basis: used,
      currency: 'KRW',
      unit: 'million',
      period: periods.labels,
    },
    incomeStatement: {
      revenue: num('revenue'), cogs: num('cogs'), grossProfit: num('grossProfit'), sga: num('sga'),
      operatingProfit: num('operatingProfit'), netIncome: num('netIncome'),
    },
    balanceSheet: {
      accountsReceivable: num('accountsReceivable'), inventory: num('inventory'), accountsPayable: num('accountsPayable'),
      ...(cash ? { cash: cash.value } : {}),
      ...(debt ? { interestBearingDebt: debt.value } : {}),
      totalAssets: num('totalAssets'), totalLiabilities: num('totalLiabilities'), totalEquity: num('totalEquity'),
    },
    cashFlow: {
      cfo: num('cfo'), ppeAcquisition: num('ppeAcquisition'), intangibleAcquisition: num('intangibleAcquisition'),
      ...(da ? { depreciationAmortization: da.value } : {}),
    },
  };
  return { ok: true, data, quality };
}
