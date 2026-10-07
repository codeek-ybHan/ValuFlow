// Raw(DartRawAccount[]) → Domain(HistoricalData) 변환. 순수 함수이며 입력을 바꾸지 않는다.
//  1) 기간 정규화  2) 단위 정규화(→ KRW million)  3) 연결/별도 기준 선택  4) 계정 매핑(id → 이름 → alias → weak)
//  5) 구조 판별(금융업 등 미지원)  6) 회계 항등식 · 연도 간 검증  7) 매핑 추적 · 품질 보고
// 필수 계정이 하나라도 없으면 값을 만들어 채우지 않고 ok:false 로 돌려준다 (숨은 기본값 없음, missing 을 0 으로 바꾸지 않음).
import type { HistoricalData, HistoricalSource } from '../types.ts';
import type { DartBasis, DartRawAccount, DartRawUnit } from '../dart/types.ts';
import { ACCOUNT_RULES, OPTIONAL_FIELDS, REQUIRED_FIELDS, normalizeAccountName, type AccountRule, type CanonicalField, type RulePart } from './accounts.ts';
import { runChecks } from './checks.ts';
import { detectUnsupported, mixedFinancialBusiness } from './industry.ts';
import { buildPeriods, resolveRelativePeriod } from './periods.ts';
import type { DataQuality, FieldQuality, MappingTrace, MatchType, TraceComponent } from './quality.ts';
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

/** incomplete: 필수 계정 부족 · unsupported-industry: 금융업 등 · unsupported-structure: 성격별 비용 손익계산서 등 */
export type NormalizeFailureCode = 'incomplete' | 'unsupported-industry' | 'unsupported-structure';

export type NormalizeResult =
  | { ok: true; data: HistoricalData; quality: DataQuality }
  | { ok: false; code: NormalizeFailureCode; reason: string; missingRequired: CanonicalField[]; quality: DataQuality };

interface Resolved { year: number; account: DartRawAccount }
type Tier = Exclude<MatchType, 'sum'>;
const TIER_ORDER: Tier[] = ['account-id', 'exact-name', 'alias', 'weak'];

const otherBasis = (b: DartBasis): DartBasis => (b === 'Consolidated' ? 'Separate' : 'Consolidated');
const basisCode = (b: DartBasis): 'CFS' | 'OFS' => (b === 'Consolidated' ? 'CFS' : 'OFS');

function resolveYear(a: DartRawAccount): number | null {
  if (a.fiscalYear !== null) return a.fiscalYear;
  if (a.periodLabel && a.reportYear !== undefined) return resolveRelativePeriod(a.periodLabel, a.reportYear);
  return null;
}

interface Match { tier: Tier; note?: string }

function classify(rule: AccountRule, a: DartRawAccount): Match | null {
  if (!rule.statements.includes(a.statementType)) return null;
  if (a.accountId && rule.excludeIds?.includes(a.accountId)) return null;
  if (a.accountId && rule.ids?.includes(a.accountId)) return { tier: 'account-id' };
  const n = normalizeAccountName(a.accountName);
  if (rule.names.some((x) => normalizeAccountName(x) === n)) return { tier: 'exact-name' };
  if (rule.aliases?.some((x) => normalizeAccountName(x) === n)) return { tier: 'alias' };
  const weak = rule.weak?.find((w) => (w.id && a.accountId === w.id) || (w.name && normalizeAccountName(w.name) === n));
  return weak ? { tier: 'weak', note: weak.note } : null;
}

function classifyPart(rule: AccountRule, part: RulePart, a: DartRawAccount): Tier | null {
  if (!rule.statements.includes(a.statementType)) return null;
  if (a.accountId && part.ids?.includes(a.accountId)) return 'account-id';
  const n = normalizeAccountName(a.accountName);
  if (part.names?.some((x) => normalizeAccountName(x) === n)) return 'exact-name';
  return null;
}

interface YearValue {
  value: number | null;
  ambiguous: boolean;
  weak: boolean;
  notes: string[];
  trace?: Omit<MappingTrace, 'canonicalField' | 'fiscalYear' | 'basis'>;
  sources: string[];
}
const EMPTY: YearValue = { value: null, ambiguous: false, weak: false, notes: [], sources: [] };

/** 한 규칙을 한 연도에 적용한다. 값은 KRW million. */
function applyRule(rule: AccountRule, rows: Resolved[], year: number, unitOf: (a: DartRawAccount) => DartRawUnit): YearValue {
  const mine = rows.filter((r) => r.year === year && r.account.amount !== null).map((r) => r.account);
  const conv = (a: DartRawAccount) => {
    const v = toKrwMillion(a.amount as number, unitOf(a));
    return rule.magnitude ? Math.abs(v) : v;
  };

  if (rule.kind === 'components') {
    const parts = rule.parts ?? [];
    const picked: { part: RulePart; account: DartRawAccount; tier: Tier; value: number; conflict: boolean }[] = [];
    const used = new Set<DartRawAccount>();
    for (const part of parts) {
      const cands = mine.filter((a) => !used.has(a)).flatMap((a) => { const t = classifyPart(rule, part, a); return t ? [{ a, t }] : []; });
      if (cands.length === 0) continue;
      const best = TIER_ORDER.find((t) => cands.some((c) => c.t === t))!;
      const top = cands.filter((c) => c.t === best);
      const values = top.map((c) => conv(c.a));
      picked.push({ part, account: top[0].a, tier: best, value: values[0], conflict: values.some((v) => v !== values[0]) });
      used.add(top[0].a);
      if (part.combined) break; // 합계 계정이 있으면 그것만 쓴다 (이중 집계 방지)
    }
    if (picked.length === 0) return EMPTY;
    const notes: string[] = [];
    if (rule.warnIfPartial && !picked.some((p) => p.part.combined) && picked.length < parts.filter((p) => !p.combined).length) {
      notes.push(`${rule.label} is partial: only ${picked.map((p) => p.account.accountName).join(', ')} found`);
    }
    const conflict = picked.some((p) => p.conflict);
    if (conflict) notes.push(`${rule.label}: multiple different values found for a component in ${year}, first one used`);
    const components: TraceComponent[] = picked.map((p) => ({ accountName: p.account.accountName, accountId: p.account.accountId ?? null, value: p.value, matchType: p.tier }));
    const first = picked[0].account;
    return {
      value: picked.reduce((s, p) => s + p.value, 0), ambiguous: conflict, weak: false, notes, sources: picked.map((p) => p.account.accountName),
      trace: { value: picked.reduce((s, p) => s + p.value, 0), sourceAccountName: picked.map((p) => p.account.accountName).join(' + '), sourceAccountId: null, matchType: 'sum', rawStatementType: first.rawStatementType ?? first.statementType, components },
    };
  }

  const cands = mine.flatMap((a) => { const m = classify(rule, a); return m ? [{ a, m }] : []; });
  if (cands.length === 0) return EMPTY;
  const best = TIER_ORDER.find((t) => cands.some((c) => c.m.tier === t))!;
  const top = cands.filter((c) => c.m.tier === best).sort((x, y) => rule.statements.indexOf(x.a.statementType) - rule.statements.indexOf(y.a.statementType));
  const values = top.map((c) => conv(c.a));
  const conflict = values.some((v) => v !== values[0]);
  const chosen = top[0];
  const notes: string[] = [];
  let selection: string | undefined;
  if (best === 'weak' && chosen.m.note) notes.push(chosen.m.note);
  if (conflict) {
    notes.push(`${rule.label}: multiple different values found for ${year}, first one used`);
    selection = `multiple different values (${top.map((c) => c.a.rawStatementType ?? c.a.statementType).join(', ')}); ${chosen.a.rawStatementType ?? chosen.a.statementType} used`;
  } else if (top.length > 1) {
    // 같은 값이 IS 와 CIS 에 중복돼 있는 경우: 합산하지 않고 대표 하나만 쓴다
    selection = `same value in ${[...new Set(top.map((c) => c.a.rawStatementType ?? c.a.statementType))].join(' and ')}; counted once, ${chosen.a.rawStatementType ?? chosen.a.statementType} preferred`;
  }
  return {
    value: values[0], ambiguous: conflict, weak: best === 'weak', notes, sources: [chosen.a.accountName],
    trace: { value: values[0], sourceAccountName: chosen.a.accountName, sourceAccountId: chosen.a.accountId ?? null, matchType: best, rawStatementType: chosen.a.rawStatementType ?? chosen.a.statementType, ...(selection ? { selection } : {}) },
  };
}

interface BasisBuild {
  series: Partial<Record<CanonicalField, (number | null)[]>>;
  fields: Partial<Record<CanonicalField, FieldQuality>>;
  notes: string[];
  trace: MappingTrace[];
  rows: DartRawAccount[];
}

function buildForBasis(basis: DartBasis, resolved: Resolved[], years: number[], unitOf: (a: DartRawAccount) => DartRawUnit, sourceLabel: string): BasisBuild {
  const rows = resolved.filter((r) => r.account.basis === basis);
  const series: BasisBuild['series'] = {};
  const fields: BasisBuild['fields'] = {};
  const notes: string[] = [];
  const trace: MappingTrace[] = [];
  const order: MatchType[] = ['account-id', 'exact-name', 'alias', 'weak'];
  for (const rule of ACCOUNT_RULES) {
    const per = years.map((y) => applyRule(rule, rows, y, unitOf));
    series[rule.field] = per.map((p) => p.value);
    const missingYears = years.filter((_, i) => per[i].value === null);
    const status = missingYears.length === years.length ? 'missing'
      : missingYears.length > 0 ? 'partial'
      : per.some((p) => p.ambiguous || p.weak) ? 'ambiguous' : 'available';
    const types = per.flatMap((p) => (p.trace ? [p.trace.matchType] : []));
    const matchType = types.includes('sum') ? 'sum' : order.slice().reverse().find((t) => types.includes(t));
    fields[rule.field] = { status, source: sourceLabel, ...(matchType ? { matchType } : {}), missingYears, sources: [...new Set(per.flatMap((p) => p.sources))] };
    per.forEach((p, i) => { if (p.trace) trace.push({ canonicalField: rule.field, fiscalYear: years[i], basis: basisCode(basis), ...p.trace }); });
    for (const n of new Set(per.flatMap((p) => p.notes))) notes.push(n);
  }
  return { series, fields, notes, trace, rows: rows.map((r) => r.account) };
}

const ok = (b: BasisBuild, f: CanonicalField) => b.fields[f]?.status === 'available' || b.fields[f]?.status === 'ambiguous';
const isComplete = (b: BasisBuild) => REQUIRED_FIELDS.every((f) => ok(b, f));
const coverage = (b: BasisBuild) => REQUIRED_FIELDS.filter((f) => ok(b, f)).length;
const labelOf = (f: CanonicalField) => ACCOUNT_RULES.find((r) => r.field === f)!.label;

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

  // 기준 선택: 선호 기준이 필수 계정을 모두 채우면 그것을, 아니면 (허용 시) 다른 기준을 쓴다. 두 기준을 섞지 않는다.
  const sourceLabel = (input.source ?? 'DART Annual Report') === 'DART Annual Report' ? 'OpenDART Financial Statement' : String(input.source);
  const first = buildForBasis(requested, resolved, periods.years, unitOf, sourceLabel);
  let used = requested;
  let chosen = first;
  if (!isComplete(first) && (input.allowBasisFallback ?? true)) {
    const alt = buildForBasis(otherBasis(requested), resolved, periods.years, unitOf, sourceLabel);
    if (isComplete(alt) || coverage(alt) > coverage(first)) { used = otherBasis(requested); chosen = alt; }
  }
  const basisFallback = used !== requested;
  if (basisFallback) {
    warnings.push(used === 'Separate' ? 'Separate statements used because consolidated data unavailable' : 'Consolidated statements used because separate data unavailable');
  }
  warnings.push(...chosen.notes);

  const missingRequired = REQUIRED_FIELDS.filter((f) => !ok(chosen, f));
  for (const f of OPTIONAL_FIELDS) {
    const q = chosen.fields[f];
    if (q?.status === 'missing') {
      if (f === 'depreciationAmortization') warnings.push('D&A not available from current OpenDART financial statement source.');
      else if (f !== 'leaseLiabilities') warnings.push(`${labelOf(f)} account not found`);
    } else if (q?.status === 'partial') warnings.push(`${labelOf(f)} missing for ${q.missingYears.join(', ')}`);
  }
  if (chosen.fields.leaseLiabilities && chosen.fields.leaseLiabilities.status !== 'missing') {
    warnings.push('Lease liabilities found but not included in interest-bearing debt (kept separately as leaseLiabilities).');
  }
  if (mixedFinancialBusiness(chosen.rows)) {
    warnings.push('Statements include financial-business (금융업) accounts; interest-bearing debt and working capital may include financial-segment items.');
  }
  for (const f of missingRequired) warnings.push(`${labelOf(f)} account not found or incomplete`);

  const series = chosen.series as Record<string, (number | null)[]>;
  const checks = runChecks({ years: periods.years, series });
  for (const c of checks) if (c.status === 'warn') warnings.push(c.message);

  const quality: DataQuality = { basisRequested: requested, basisUsed: used, basisFallback, fields: chosen.fields, warnings, trace: chosen.trace, checks };
  if (periods.years.length === 0) return { ok: false, code: 'incomplete', reason: 'fiscalYears 가 비어 있습니다.', missingRequired: [...REQUIRED_FIELDS], quality };

  // 일반 기업 구조가 아니면 "지원하지 않는다" 고 말한다 (그럴듯한 숫자를 만들지 않는다)
  const has = (f: CanonicalField) => (chosen.series[f] ?? []).some((v) => v !== null);
  const unsupported = detectUnsupported(chosen.rows, { hasRevenue: has('revenue'), hasOperatingProfit: has('operatingProfit'), hasCogsOrGrossProfit: has('cogs') || has('grossProfit') });
  if (unsupported) {
    warnings.push(`Unsupported statement structure (${unsupported.kind}): ${unsupported.message}`);
    return { ok: false, code: unsupported.kind === 'financial' ? 'unsupported-industry' : 'unsupported-structure', reason: unsupported.message, missingRequired, quality };
  }
  if (missingRequired.length > 0) {
    return { ok: false, code: 'incomplete', reason: `필수 계정을 찾지 못했습니다: ${missingRequired.join(', ')}`, missingRequired, quality };
  }

  const num = (f: CanonicalField) => chosen.series[f] as number[];
  const optional = (f: CanonicalField) => (ok(chosen, f) ? { value: num(f) } : null);
  const cash = optional('cash'), debt = optional('interestBearingDebt'), lease = optional('leaseLiabilities'), da = optional('depreciationAmortization');

  const data: HistoricalData = {
    meta: { corpCode: input.company.corpCode, stockCode: input.company.stockCode, source: input.source ?? 'DART Annual Report', fetchedAt: input.fetchedAt },
    company: { name: input.company.name, ticker: input.company.stockCode ?? '', basis: used, currency: 'KRW', unit: 'million', period: periods.labels },
    incomeStatement: {
      revenue: num('revenue'), cogs: num('cogs'), grossProfit: num('grossProfit'), sga: num('sga'),
      operatingProfit: num('operatingProfit'), netIncome: num('netIncome'),
    },
    balanceSheet: {
      accountsReceivable: num('accountsReceivable'), inventory: num('inventory'), accountsPayable: num('accountsPayable'),
      ...(cash ? { cash: cash.value } : {}),
      ...(debt ? { interestBearingDebt: debt.value } : {}),
      ...(lease ? { leaseLiabilities: lease.value } : {}),
      totalAssets: num('totalAssets'), totalLiabilities: num('totalLiabilities'), totalEquity: num('totalEquity'),
    },
    cashFlow: {
      cfo: num('cfo'), ppeAcquisition: num('ppeAcquisition'), intangibleAcquisition: num('intangibleAcquisition'),
      ...(da ? { depreciationAmortization: da.value } : {}),
    },
  };
  return { ok: true, data, quality };
}
