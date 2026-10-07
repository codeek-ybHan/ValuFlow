// Sensitivity · Scenario · 상대가치 · Valuation Range section: ReportInput 에 수집된 엔진 view 를 Cell 로 옮긴다 (평균 · 중앙값으로 하나의 "정답 가치"를 만들지 않는다).
import { DIRECTION_NOTES, RANGE_DISCLAIMER } from '../../engine/validationView.ts';
import type { ReportInput } from '../input.ts';
import type { RelativeSection, ScenarioSection, SensitivitySection, ValuationRangeSection } from '../model.ts';
import { SRC_ENGINE, SRC_RELATIVE } from '../sources.ts';
import type { SectionState } from '../types.ts';
import { cell } from '../units.ts';

const E = SRC_ENGINE;

export function buildSensitivity(input: ReportInput): SectionState<SensitivitySection> {
  const s = input.sensitivity;
  if (!s) return { status: 'unavailable', reason: 'Sensitivity 가 계산되지 않았습니다.' };
  return {
    status: 'ok',
    data: {
      waccAxis: s.waccValues.map((v) => cell(v, 'ratio', 'estimate', E)),
      growthAxis: s.terminalGrowthValues.map((v) => cell(v, 'ratio', 'estimate', E)),
      rows: s.rows.map((row) => ({
        terminalGrowth: cell(row.terminalGrowth, 'ratio', 'estimate', E),
        cells: row.cells.map((c) => ({ wacc: cell(c.wacc, 'ratio', 'estimate', E), enterpriseValue: cell(c.enterpriseValue, 'eok', 'calculated', E), perShareValue: cell(c.perShareValue, 'won', 'calculated', E), isBaseCase: c.isBaseCase, valid: c.wacc > row.terminalGrowth })),
      })),
      base: { wacc: cell(s.base.wacc, 'ratio', 'calculated', E), terminalGrowth: cell(s.base.terminalGrowth, 'ratio', 'estimate', E), inGrid: s.base.inGrid },
      enterpriseValueRange: { min: cell(s.enterpriseValueRange.min, 'eok', 'calculated', E), max: cell(s.enterpriseValueRange.max, 'eok', 'calculated', E), widthRatio: cell(s.enterpriseValueRange.widthRatio, 'ratio', 'calculated', E, { state: 'not-applicable', reason: 'Base EV 가 0 이하라 폭 비율을 정의할 수 없습니다.' }) },
      directionNotes: [...DIRECTION_NOTES],
    },
  };
}

export function buildScenario(input: ReportInput): SectionState<ScenarioSection> {
  const s = input.scenario;
  if (!s) return { status: 'unavailable', reason: 'Scenario 를 계산할 수 없습니다 (가정 또는 Valuation 결과 없음).' };
  const fail = (e: string | null) => ({ state: 'unavailable' as const, reason: e ?? '이 시나리오는 계산되지 않았습니다.' });
  return {
    status: 'ok',
    data: {
      columns: s.columns.map((c) => ({
        id: c.id, label: c.label, description: c.description, ok: c.ok, error: c.error,
        wacc: cell(c.wacc, 'ratio', 'calculated', E, fail(c.error)), enterpriseValue: cell(c.enterpriseValue, 'eok', 'calculated', E, fail(c.error)),
        equityValue: cell(c.equityValue, 'eok', 'calculated', E, fail(c.error)), perShareValue: cell(c.perShareValue, 'won', 'calculated', E, fail(c.error)),
        assumptions: {
          revenueGrowth: c.assumptions.revenueGrowth.map((v) => cell(v, 'ratio', 'estimate', E)), operatingMargin: c.assumptions.operatingMargin.map((v) => cell(v, 'ratio', 'estimate', E)),
          marketRiskPremium: cell(c.assumptions.marketRiskPremium, 'ratio', 'estimate', E), terminalGrowth: cell(c.assumptions.terminalGrowth, 'ratio', 'estimate', E),
        },
      })),
      equityRange: s.equityRange ? { status: 'ok', data: { min: cell(s.equityRange.min, 'eok', 'calculated', E), max: cell(s.equityRange.max, 'eok', 'calculated', E) } } : { status: 'unavailable', reason: '계산된 시나리오가 2개 미만입니다.' },
      note: 'Bear / Bull 은 현재 가정에서 파생한 가정 묶음이며 예측이 아닙니다.',
    },
  };
}

const RELATIVE_LABEL: Record<string, { label: string; unit: 'eok' | 'multiple' }> = {
  netIncome: { label: 'Net Income (입력)', unit: 'eok' }, per: { label: 'PER (입력)', unit: 'multiple' }, bookEquity: { label: 'Book Equity (입력)', unit: 'eok' },
  pbr: { label: 'PBR (입력)', unit: 'multiple' }, ebitda: { label: 'EBITDA (입력)', unit: 'eok' }, evEbitda: { label: 'EV/EBITDA (입력)', unit: 'multiple' },
};

export function buildRelative(input: ReportInput): SectionState<RelativeSection> {
  const r = input.relativeValuation;
  if (!r) return { status: 'unavailable', reason: '상대가치를 표시할 수 없습니다 (Valuation 결과 없음).' };
  const entered = Object.entries(input.relativeInputs).filter(([, v]) => v !== undefined);
  if (entered.length === 0) return { status: 'not-applicable', reason: '상대가치 입력(멀티플 · 이익 기준)이 없어 생략합니다. 입력하지 않은 값은 만들지 않습니다.' };
  const miss = (m: string | null) => ({ state: 'unavailable' as const, reason: m ?? '계산되지 않았습니다.' });
  return {
    status: 'ok',
    data: {
      rows: r.rows.map((x) => ({
        method: x.method, status: x.status, evDerived: x.evDerived, message: x.message,
        enterpriseValue: cell(x.enterpriseValue, 'eok', 'calculated', E, miss(x.message)), equityValue: cell(x.equityValue, 'eok', 'calculated', E, miss(x.message)), perShareValue: cell(x.perShareValue, 'won', 'calculated', E, miss(x.message)),
      })),
      equityRange: r.equityRange ? { status: 'ok', data: { min: cell(r.equityRange.min, 'eok', 'calculated', E), max: cell(r.equityRange.max, 'eok', 'calculated', E) } } : { status: 'unavailable', reason: '계산된 상대가치 방법이 없습니다.' },
      maxDivergence: cell(r.maxDivergence, 'ratio', 'calculated', E, { state: 'not-applicable', reason: 'DCF 와 비교할 상대가치 결과가 없습니다.' }),
      inputs: entered.map(([key, v]) => ({ key, label: RELATIVE_LABEL[key]?.label ?? key, cell: cell(v as number, RELATIVE_LABEL[key]?.unit ?? 'factor', 'estimate', SRC_RELATIVE) })),
      disclaimer: RANGE_DISCLAIMER,
    },
  };
}

export function buildRange(input: ReportInput): SectionState<ValuationRangeSection> {
  const g = input.valuationRange;
  if (!g) return { status: 'unavailable', reason: 'Valuation Range 를 만들 수 없습니다 (Valuation 결과 없음).' };
  const pt = (p: { label: string; equityValue: number; perShareValue: number | null }) => ({ label: p.label, equityValue: cell(p.equityValue, 'eok', 'calculated', E), perShareValue: cell(p.perShareValue, 'won', 'calculated', E, { state: 'unavailable', reason: '주당 가치를 구할 수 없습니다.' }) });
  return { status: 'ok', data: { low: pt(g.low), base: pt(g.base), high: pt(g.high), spans: g.spans.map((s) => ({ source: s.source, low: cell(s.low.equityValue, 'eok', 'calculated', E), high: cell(s.high.equityValue, 'eok', 'calculated', E) })), disclaimer: g.disclaimer } };
}
