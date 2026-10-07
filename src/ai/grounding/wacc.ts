// WACC 의미 모델: WACC 는 구성요소(무위험수익률 · 베타 · 시장위험프리미엄 · 타인자본비용 · 세율 · 자본구조)의 결과다.
// 구성요소 변경은 WACC 직접 변경이 아니다. 모델이 Rf 변경을 change-wacc-directly 로 분류하면 의미 오류로 잡고, 근거 값으로 올바른 구성요소가 분명하면 type 을 바로잡는다.
import type { CheckpointKind } from '../agent/types.ts';
import type { EvidenceIndex } from './evidence.ts';
import { parseNumbers, matchesValue, type ParsedNumber } from './numbers.ts';
import { termsIn } from './terms.ts';
import type { Evidence } from './types.ts';

export type WaccComponent = 'risk-free-rate' | 'beta' | 'market-risk-premium' | 'cost-of-debt' | 'tax-rate' | 'capital-structure';

export const COMPONENTS: { component: WaccComponent; type: CheckpointKind; term: string; fields: string[]; label: string }[] = [
  { component: 'risk-free-rate', type: 'change-risk-free-rate', term: 'riskFreeRate', fields: ['riskFreeRate'], label: '무위험수익률' },
  { component: 'beta', type: 'change-beta', term: 'beta', fields: ['beta'], label: '베타' },
  { component: 'market-risk-premium', type: 'change-market-risk-premium', term: 'marketRiskPremium', fields: ['marketRiskPremium'], label: '시장위험프리미엄' },
  { component: 'cost-of-debt', type: 'change-cost-of-debt', term: 'costOfDebt', fields: ['preTaxCostOfDebt', 'afterTaxCostOfDebt'], label: '타인자본비용' },
  { component: 'tax-rate', type: 'change-tax-rate', term: 'taxRate', fields: ['taxRate'], label: '세율' },
  { component: 'capital-structure', type: 'change-capital-structure', term: 'capitalStructure', fields: ['equityMarketValue', 'debtMarketValue', 'equityWeight', 'debtWeight'], label: '자본구조' },
];

export interface Proposal { type: CheckpointKind; target: string; currentValue: string | null; proposedValue: string | null; rationale: string }
export interface ProposalCheck { proposal: Proposal; ok: boolean; retyped?: { from: CheckpointKind; to: CheckpointKind }; issue?: { code: 'proposal-semantic-mismatch' | 'proposal-ungrounded'; detail: string }; note?: string }

const lastSeg = (path: string | undefined) => (path ?? '').split('.').pop()!.replace(/\[\d+\]/g, '');
/** 경로가 WACC 의 구성요소 필드인가 (예: `wacc.riskFreeRate`, `wacc.beta`). */
const componentOf = (e: Evidence): WaccComponent | null => COMPONENTS.find((c) => c.fields.includes(lastSeg(e.fieldPath)) && e.tool !== 'getComparableCompanies')?.component ?? null;
/** 전체 WACC 값인가 (getValuationResult 의 `wacc`). */
const isWaccTotal = (e: Evidence) => e.fieldPath === 'wacc' && typeof e.value === 'number';

function parseValue(s: string | null): ParsedNumber | null {
  if (!s) return null;
  const p = parseNumbers(s).find((n) => n.unit !== 'plain' || true);
  if (p) return p;
  const f = Number(s.replace(/[,\s]/g, ''));
  return Number.isFinite(f) ? { text: s, value: f, unit: 'plain', decimals: s.includes('.') ? s.length - s.indexOf('.') - 1 : 0, start: 0 } : null;
}

function matchEvidence(index: EvidenceIndex, value: string | null): Evidence[] {
  const p = parseValue(value);
  if (!p) return [];
  return index.list.filter((e) => !e.missing && typeof e.value === 'number' && matchesValue(p, e.value as number, e.unit));
}

const typeFor = (c: WaccComponent): CheckpointKind => COMPONENTS.find((x) => x.component === c)!.type;

export function validateProposal(pr: Proposal, index: EvidenceIndex): ProposalCheck {
  const isComponentType = COMPONENTS.some((c) => c.type === pr.type);
  if (!isComponentType && pr.type !== 'change-wacc-directly') return { proposal: pr, ok: true };   // 가정 / peer / scenario 제안은 WACC 의미 검사 대상이 아니다
  const targetTerms = termsIn(`${pr.target}`).map((t) => t.key);
  const current = matchEvidence(index, pr.currentValue);
  const currentComponents = [...new Set(current.map(componentOf).filter((c): c is WaccComponent => c !== null))];
  const currentIsTotal = current.some(isWaccTotal);
  if (pr.currentValue && current.length === 0) {
    return { proposal: pr, ok: false, issue: { code: 'proposal-ungrounded', detail: `current value "${pr.currentValue}" is not found in any tool result` } };
  }
  if (pr.type === 'change-wacc-directly') {
    const targetsWacc = targetTerms.includes('wacc');
    if (currentIsTotal && (targetsWacc || targetTerms.length === 0)) return { proposal: pr, ok: true };
    // 근거 값이 WACC 가 아니라 구성요소 하나의 값이면: 구성요소 변경이다
    if (!currentIsTotal && currentComponents.length === 1) {
      const to = typeFor(currentComponents[0]);
      return { proposal: { ...pr, type: to, target: COMPONENTS.find((c) => c.component === currentComponents[0])!.label }, ok: true, retyped: { from: pr.type, to }, note: `current value is the ${currentComponents[0]} assumption, not the overall WACC` };
    }
    return { proposal: pr, ok: false, issue: { code: 'proposal-semantic-mismatch', detail: 'change-wacc-directly requires the current overall WACC (getValuationResult wacc) as its current value' } };
  }
  // 구성요소 type
  const spec = COMPONENTS.find((c) => c.type === pr.type)!;
  const targetMatches = targetTerms.length === 0 || targetTerms.includes(spec.term);
  const valueMatches = current.length === 0 || current.some((e) => componentOf(e) === spec.component);
  if (targetMatches && valueMatches) return { proposal: pr, ok: true };
  // 다른 구성요소의 값 · 대상이면 그 구성요소로 바로잡는다 (근거가 한 가지로 분명할 때만)
  const byValue = currentComponents.length === 1 ? currentComponents[0] : null;
  const byTarget = COMPONENTS.filter((c) => targetTerms.includes(c.term));
  const to = byValue ?? (byTarget.length === 1 ? byTarget[0].component : null);
  if (to && to !== spec.component) {
    const toType = typeFor(to);
    return { proposal: { ...pr, type: toType, target: COMPONENTS.find((c) => c.component === to)!.label }, ok: true, retyped: { from: pr.type, to: toType }, note: `${pr.type} did not match the cited value / target` };
  }
  return { proposal: pr, ok: false, issue: { code: 'proposal-semantic-mismatch', detail: `${pr.type} does not match the target "${pr.target}" / current value "${pr.currentValue ?? ''}"` } };
}
