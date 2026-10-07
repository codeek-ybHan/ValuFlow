// Data Quality / Mapping Trace Tool: "이 숫자는 믿을 만한가", "어디서 온 값인가".
import type { AiValuationContext } from '../context.ts';
import { ACCOUNT_RULES, type CanonicalField } from '../../data/normalization/accounts.ts';
import { buildQualityView } from '../../engine/qualityView.ts';
import { dedupeWarnings, missing, ok, unavailable, type ToolResult } from './result.ts';
import { historicalSource, qualityWarnings } from './shared.ts';

const LABEL = new Map(ACCOUNT_RULES.map((r) => [r.field, r.label]));
const NO_QUALITY = 'No DataQuality is available (learning fixture data carries no mapping information, or Historical is not loaded).';

export function getHistoricalQuality(ctx: AiValuationContext): ToolResult<unknown> {
  const view = buildQualityView(ctx.historicalQuality);
  if (!view || !ctx.historicalData) return unavailable('getHistoricalQuality', NO_QUALITY, ctx.historicalData ? [historicalSource(ctx)] : []);
  const p = ctx.historicalProvenance;
  const data = {
    basis: view.basisLine,
    fields: view.fields.map((f) => ({ field: f.field, label: f.label, status: f.status })),
    reviewRequired: view.notes.filter((n) => n.level === 'review').map((n) => n.text),
    dataNotes: view.notes.filter((n) => n.level === 'note').map((n) => n.text),
    provenance: {
      source: p?.source ?? 'unknown', persisted: p?.persisted ?? false, fetchedAt: p?.fetchedAt ?? null, periods: [...ctx.historicalData.company.period],
      basis: ctx.historicalData.company.basis,
    },
  };
  return ok('getHistoricalQuality', data, [historicalSource(ctx)], dedupeWarnings(qualityWarnings(ctx)));
}

const MISSING_REASON: Partial<Record<CanonicalField, string>> = {
  depreciationAmortization: 'Not available from current OpenDART financial statement source.',
  leaseLiabilities: 'No lease liability account found in the statements (never inferred).',
};

export function getMappingTrace(ctx: AiValuationContext, input: { field?: string; fiscalYear?: number } = {}): ToolResult<unknown> {
  const q = ctx.historicalQuality;
  if (!q || !ctx.historicalData) return unavailable('getMappingTrace', NO_QUALITY, ctx.historicalData ? [historicalSource(ctx)] : []);
  const field = input.field as CanonicalField | undefined;
  if (!field || !LABEL.has(field)) return { status: 'invalid-input', tool: 'getMappingTrace', reason: `field must be one of the canonical fields (got ${String(input.field)}).`, sources: [], warnings: [] };
  const fq = q.fields[field];
  const status = fq?.status ?? 'missing';
  const entries = q.trace
    .filter((t) => t.canonicalField === field && (input.fiscalYear === undefined || t.fiscalYear === input.fiscalYear))
    .sort((a, b) => a.fiscalYear - b.fiscalYear)
    .map((t) => ({
      fiscalYear: t.fiscalYear, value: t.value, sourceAccountName: t.sourceAccountName, sourceAccountId: t.sourceAccountId, matchType: t.matchType,
      rawStatementType: t.rawStatementType, basis: t.basis,
      ...(t.selection ? { selection: t.selection } : {}), ...(t.components ? { components: t.components.map((c) => ({ ...c })) } : {}),
    }));
  const data = {
    field, label: LABEL.get(field) as string, status,
    matchType: fq?.matchType ?? null,
    entries,
    missing: entries.length === 0 ? missing(MISSING_REASON[field] ?? 'Account not found or incomplete in the source statements.') : null,
  };
  const warnings = qualityWarnings(ctx).filter((w) => w.text.includes(LABEL.get(field) as string) || (field === 'depreciationAmortization' && w.text.startsWith('D&A')));
  return ok('getMappingTrace', data, [historicalSource(ctx)], dedupeWarnings(warnings));
}
