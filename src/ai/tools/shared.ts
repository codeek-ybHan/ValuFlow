// Tool 구현이 함께 쓰는 helper: 출처 / 경고 / Validation 모델. 계산은 하지 않고 engine · valuation 공개 API 의 결과를 조합한다.
import type { AiValuationContext } from '../context.ts';
import type { SourceInfo, ToolWarning } from './result.ts';
import { buildQualityView } from '../../engine/qualityView.ts';
import { buildValidationView, type ValidationView } from '../../engine/validationView.ts';
import { isCompleteAssumptions } from '../../store/assumptions.ts';

export function historicalSource(ctx: AiValuationContext): SourceInfo {
  const p = ctx.historicalProvenance;
  const fixture = ctx.dataKinds.historical === 'fixture';
  return {
    kind: 'actual', origin: p?.source ?? (fixture ? 'fixture' : 'unknown'), basis: ctx.historicalData?.company.basis ?? null,
    fetchedAt: p?.fetchedAt ?? null, persisted: p ? p.persisted : null,
    note: fixture ? '학습용 fixture 입니다. 실제 OpenDART 조회 결과가 아닙니다.' : null,
  };
}

export function assumptionSource(ctx: AiValuationContext): SourceInfo {
  const learning = ctx.dataKinds.assumptions === 'learning';
  return {
    kind: 'assumption', origin: learning ? 'learning-fixture' : 'user-input', basis: null, fetchedAt: null, persisted: null,
    note: learning ? 'STEP 04 학습용 가상값입니다. 이 기업에 대한 애널리스트 가정이 아닙니다.' : '사용자가 입력한 가정입니다 (Actual 이 아닙니다).',
  };
}

export function calculatedSource(ctx: AiValuationContext): SourceInfo {
  return { kind: 'calculated', origin: 'valuation-engine', basis: null, fetchedAt: null, persisted: null, note: `입력 가정: ${ctx.dataKinds.assumptions === 'learning' ? '학습용 가정' : '사용자 입력'}` };
}

/** DataQuality 의 경고를 Tool 경고로 옮긴다. review 는 답변에 반드시 언급해야 하는 경고다. */
export function qualityWarnings(ctx: AiValuationContext): ToolWarning[] {
  const out: ToolWarning[] = [];
  const view = buildQualityView(ctx.historicalQuality);
  for (const n of view?.notes ?? []) out.push({ code: 'data-quality', text: n.text, level: n.level });
  if (ctx.dataKinds.historical === 'fixture') {
    out.push({ code: 'fixture-data', text: 'Historical 은 학습용 fixture 이며 실제 공시 조회 결과가 아닙니다.', level: 'review' });
  }
  return out;
}

/** 학습용 가정으로 계산된 결과는 해당 기업의 가치평가가 아니다. */
export function assumptionWarnings(ctx: AiValuationContext): ToolWarning[] {
  return ctx.dataKinds.assumptions === 'learning'
    ? [{ code: 'learning-assumptions', text: '가정이 STEP 04 학습용 가상값입니다. 이 결과를 해당 기업의 가치평가로 해석하면 안 됩니다.', level: 'review' }]
    : [];
}

/** 현재 가정 · 결과로 Validation 모델(민감도 · 시나리오 · 상대가치 · 경고)을 만든다. 가정이 완성되지 않았거나 결과가 없으면 null. */
export function validationOf(ctx: AiValuationContext): ValidationView | null {
  const a = ctx.valuationAssumptions;
  if (!ctx.valuationResult || !a || !isCompleteAssumptions(a)) return null;
  return buildValidationView({ assumptions: a, result: ctx.valuationResult, sensitivity: ctx.sensitivityResult, relativeInput: ctx.relativeInputs });
}
