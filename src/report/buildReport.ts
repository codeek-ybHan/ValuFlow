// ReportInput → ReportModel. 이 파일과 sections/ 는 valuation · engine 의 계산 함수를 호출하지 않는다 (타입 · 표시 상수만 가져온다): DCF · WACC · Historical 지표를 다시 계산하지 않는다.
// 숫자는 입력의 값을 Cell 로 옮기고, 서술은 AI 가 쓴 Grounded Claim(검증 통과분)만 재사용한다.
import { buildQualityView } from '../engine/qualityView.ts';
import { isCompleteAssumptions } from '../store/assumptions.ts';
import { hashOf } from './hash.ts';
import type { ReportInput } from './input.ts';
import type { Appendix, CompanyOverview, Conclusion, ExecutiveSummary, KeyRisks, ReportMetadata, ReportModel, RiskItem } from './model.ts';
import { buildRange, buildRelative, buildScenario, buildSensitivity } from './sections/analysis.ts';
import { buildHistorical, periodLabels } from './sections/historical.ts';
import { selectNarrative } from './sections/narrative.ts';
import { buildDcf, buildForecast, buildWacc } from './sections/dcfModel.ts';
import { baseSources, SRC_ASSUMPTIONS, SRC_ENGINE, SRC_HISTORICAL, SourceRegistry } from './sources.ts';
import { REPORT_SCHEMA_VERSION } from './types.ts';
import { cell } from './units.ts';
import { REPORT_UNIT_POLICY } from './units.ts';
import { validateReportInput, type ReportValidation } from './validation/validate.ts';

export interface BuildReportOptions { reportId?: string; title?: string }

export type ReportBuildResult =
  | { status: 'ok'; model: ReportModel; validation: ReportValidation }
  | { status: 'blocked'; model: null; validation: ReportValidation };

const KIND_LEGEND = [
  { kind: 'actual' as const, meaning: 'Actual: 공시로 확정된 값 (예: 2025A)' },
  { kind: 'estimate' as const, meaning: 'Estimate: 가정 · 예측값 (예: 2026E). Actual 이 아니다' },
  { kind: 'calculated' as const, meaning: 'Calculated: ValuFlow 엔진이 계산한 결과 (EV · WACC · Equity Value 등)' },
];

const ASSUMPTION_LABELS: [string, string, 'ratio' | 'eok' | 'shares' | 'factor'][] = [
  ['currentRevenue', 'Base-year Revenue', 'eok'], ['taxRate', 'Tax Rate', 'ratio'], ['riskFreeRate', 'Risk-free Rate', 'ratio'], ['beta', 'Beta', 'factor'], ['marketRiskPremium', 'Market Risk Premium', 'ratio'],
  ['preTaxCostOfDebt', 'Cost of Debt (pre-tax)', 'ratio'], ['equityMarketValue', 'Equity Market Value', 'eok'], ['debtMarketValue', 'Debt Market Value', 'eok'], ['terminalGrowth', 'Terminal Growth', 'ratio'],
  ['interestBearingDebt', 'Interest-bearing Debt', 'eok'], ['cash', 'Cash', 'eok'], ['sharesOutstanding', 'Shares Outstanding', 'shares'],
];

/** Report 를 만든다. 검증 error(Historical · 가정 · 결과 · WACC<=g …)가 있으면 만들지 않고 blocked 로 돌려준다 — 없는 값을 채우지 않는다. */
export function buildReport(input: ReportInput, options: BuildReportOptions = {}): ReportBuildResult {
  const validation = validateReportInput(input);
  const a = input.assumptions;
  if (!validation.ok || !input.historical || !input.historicalAnalysis || !input.valuationResult || !a || !isCompleteAssumptions(a) || !input.company) return { status: 'blocked', model: null, validation };
  const r = input.valuationResult;

  const reg = new SourceRegistry();
  baseSources(input, reg);

  // ---- AI narrative: 검증을 통과한 claim 만 (유형별로 나눠 쓰고 새 문장을 만들지 않는다) ----
  const summaryNarrative = selectNarrative(input, reg, ['fact', 'calculation', 'interpretation'], 5);
  const historicalNarrative = selectNarrative(input, reg, ['fact', 'calculation'], 4);
  const riskNarrative = selectNarrative(input, reg, ['risk'], 5);
  const conclusionNarrative = selectNarrative(input, reg, ['recommendation'], 3);

  const notices: string[] = [];
  if (input.historicalKind === 'fixture') notices.push('Historical 은 학습용 fixture 이며 실제 공시 조회 결과가 아닙니다.');
  if (input.assumptionKind === 'learning') notices.push('가정이 STEP 04 학습용 가상값입니다. 이 결과를 해당 기업의 가치평가로 해석하면 안 됩니다.');

  const range = buildRange(input);
  const executiveSummary: ExecutiveSummary = {
    headline: {
      enterpriseValue: cell(r.enterpriseValue, 'eok', 'calculated', SRC_ENGINE), equityValue: cell(r.equityValue, 'eok', 'calculated', SRC_ENGINE), perShareValue: cell(r.perShareValue, 'won', 'calculated', SRC_ENGINE),
      wacc: cell(r.wacc, 'ratio', 'calculated', SRC_ENGINE), terminalGrowth: cell(a.terminalGrowth, 'ratio', 'estimate', SRC_ASSUMPTIONS),
      tvContribution: cell(input.reviewMetrics?.terminalValueContribution, 'ratio', 'calculated', SRC_ENGINE, { state: 'unavailable', reason: 'PV(TV) / EV 를 구할 수 없습니다.' }),
    },
    range, notices, narrative: summaryNarrative,
    highlights: {
      conclusion: summaryNarrative.status === 'ok' ? summaryNarrative.data.items.filter((i) => i.claimType === 'fact' || i.claimType === 'calculation') : [],
      judgment: summaryNarrative.status === 'ok' ? summaryNarrative.data.items.filter((i) => i.claimType === 'interpretation') : [],
      risk: riskNarrative.status === 'ok' ? riskNarrative.data.items.slice(0, 2) : [],
    },
  };

  const companyOverview: CompanyOverview = {
    name: input.company.name, ticker: input.company.ticker, corpCode: input.company.corpCode, basis: input.company.basis, currency: input.company.currency ?? 'KRW',
    periods: periodLabels(input.historical.company.period), historicalKind: input.historicalKind === 'fixture' ? 'fixture' : 'actual', historicalSourceId: SRC_HISTORICAL,
  };

  // ---- Key risks: 엔진 검토 경고 + 데이터 품질 검토 (deterministic) + AI risk claim (narrative) ----
  const items: RiskItem[] = input.reviewWarnings.map((w, i) => ({ id: `engine-${i + 1}`, origin: 'engine-review', text: w.message, basis: w.basis, evidenceIds: [], sourceIds: [SRC_ENGINE] }));
  const quality = buildQualityView(input.dataQuality);
  (quality?.notes ?? []).filter((n) => n.level === 'review').forEach((n, i) => items.push({ id: `quality-${i + 1}`, origin: 'data-quality', text: n.text, basis: null, evidenceIds: [], sourceIds: [SRC_HISTORICAL] }));
  const keyRisks: KeyRisks = { items, narrative: riskNarrative };

  const disclaimers = [...notices, ...(range.status === 'ok' ? [range.data.disclaimer] : []), 'AI 서술은 검증을 통과한 Grounded Claim 만 사용하며 투자 판단이 아닙니다.'];
  const conclusion: Conclusion = { range, narrative: conclusionNarrative, disclaimers };

  const appendix: Appendix = {
    unitPolicy: Object.entries(REPORT_UNIT_POLICY).map(([key, value]) => ({ key, value })),
    kindLegend: KIND_LEGEND,
    dataQualityNotes: [...new Set([...(input.historicalAnalysis.warnings), ...(quality?.notes.map((n) => n.text) ?? [])])],
    inputAssumptions: ASSUMPTION_LABELS.map(([key, label, unit]) => ({ key, label, cell: cell((a as unknown as Record<string, number>)[key], unit, 'estimate', SRC_ASSUMPTIONS) })),
    validation: { errors: validation.errors, warnings: validation.warnings },
    aiLimitations: input.aiAnalysis ? [...input.aiAnalysis.limitations] : [],
  };

  const snap = input.snapshot;
  const metadata: ReportMetadata = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportId: options.reportId ?? `rpt-${hashOf([snap.createdAt, snap.inputHash])}`,
    reportTitle: options.title ?? `${input.company.name} Valuation Report`,
    createdAt: input.createdAt, company: { name: input.company.name, ticker: input.company.ticker, corpCode: input.company.corpCode },
    valuationDate: snap.valuationSnapshotId ? input.createdAt.slice(0, 10) : null,
    currency: REPORT_UNIT_POLICY.currency, monetaryUnit: REPORT_UNIT_POLICY.monetaryUnit, perShareUnit: REPORT_UNIT_POLICY.perShare,
    snapshot: { contextSnapshotId: snap.contextSnapshotId, historicalAsOf: snap.historicalAsOf, marketAsOf: snap.marketAsOf, valuationSnapshotId: snap.valuationSnapshotId, inputHash: snap.inputHash },
    dataBasis: { historical: input.historicalKind === 'fixture' ? 'fixture' : 'actual', assumptions: input.assumptionKind === 'learning' ? 'learning' : 'user-input' },
    sourceSummary: [],
  };

  const model: ReportModel = {
    schemaVersion: REPORT_SCHEMA_VERSION, metadata, executiveSummary, companyOverview,
    historicalPerformance: buildHistorical(input, historicalNarrative),
    forecast: buildForecast(input, a, r), wacc: buildWacc(a, r), dcf: buildDcf(input, a, r),
    sensitivity: buildSensitivity(input), scenario: buildScenario(input), relativeValuation: buildRelative(input),
    keyRisks, conclusion, sources: reg.all(), appendix,
  };
  model.metadata.sourceSummary = model.sources.map((s) => ({ id: s.id, kind: s.kind, label: s.label }));
  return { status: 'ok', model: structuredClone(model), validation };
}
