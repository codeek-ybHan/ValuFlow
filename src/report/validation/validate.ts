// Report 생성 전 검증. error 가 있으면 Report 를 만들지 않는다 (필요한 값을 임의로 채우지 않는다). warning 은 Report 에 고지로 남는다.
// 선택 section(Sensitivity · Scenario · 상대가치 · AI narrative)은 없어도 error 가 아니다.
import { assumptionCompleteness } from '../../store/assumptions.ts';
import { REPORT_SCHEMA_VERSION } from '../types.ts';
import type { ReportInput } from '../input.ts';

export interface ReportIssue { code: string; message: string; section?: string }
export interface ReportValidation { ok: boolean; errors: ReportIssue[]; warnings: ReportIssue[] }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function validateReportInput(input: ReportInput): ReportValidation {
  const errors: ReportIssue[] = [];
  const warnings: ReportIssue[] = [];
  const err = (code: string, message: string, section?: string) => errors.push({ code, message, section });
  const warn = (code: string, message: string, section?: string) => warnings.push({ code, message, section });

  if (input.schemaVersion !== REPORT_SCHEMA_VERSION) err('schema-mismatch', `ReportInput schemaVersion ${String(input.schemaVersion)} 은 지원하지 않습니다 (지원: ${REPORT_SCHEMA_VERSION}).`);
  if (input.support.status === 'unsupported') err('unsupported-company', `지원하지 않는 기업입니다${input.support.reason ? `: ${input.support.reason}` : ''}.`);
  if (!input.company) err('no-company', '기업이 선택되지 않았습니다.');
  if (!input.historical || !input.historicalAnalysis) err('no-historical', 'Historical 재무데이터가 없습니다. Workspace 에서 재무데이터를 먼저 불러오세요.', 'historicalPerformance');
  else if (input.historical.company.currency !== 'KRW' || input.historical.company.unit !== 'million') err('unit-missing', `Historical 의 통화 · 단위(${String(input.historical.company.currency)} / ${String(input.historical.company.unit)})가 정책(KRW · million)과 다릅니다. 단위를 추정하지 않습니다.`, 'historicalPerformance');

  const c = assumptionCompleteness(input.assumptions);
  if (!input.assumptions) err('no-assumptions', 'Valuation 가정이 입력되지 않았습니다.', 'forecast');
  else if (!c.complete) err('assumptions-incomplete', `Valuation 가정이 완성되지 않았습니다 (없는 값: ${Object.values(c.missing).flat().join(', ')}).`, 'forecast');

  const r = input.valuationResult;
  if (!r) err('no-valuation-result', input.valuationError ? `Valuation 이 실패했습니다: ${input.valuationError}` : 'Valuation 결과가 없습니다. Run Valuation 을 먼저 실행하세요.', 'dcf');
  else {
    if (![r.enterpriseValue, r.equityValue, r.perShareValue, r.wacc].every(finite)) err('missing-critical-result', 'EV · Equity Value · 주당 가치 · WACC 중 유한한 값이 아닌 결과가 있습니다.', 'dcf');
    const g = input.assumptions?.terminalGrowth;
    if (finite(g) && finite(r.wacc) && r.wacc <= g) err('invalid-wacc-g', `WACC(${(r.wacc * 100).toFixed(2)}%)가 영구성장률(${(g * 100).toFixed(2)}%) 이하이면 Terminal Value 를 정의할 수 없습니다.`, 'dcf');
  }

  // ---- warnings ----
  if (input.historicalKind === 'fixture') warn('fixture-historical', 'Historical 은 학습용 fixture 이며 실제 공시 조회 결과가 아닙니다.', 'historicalPerformance');
  if (input.assumptionKind === 'learning') warn('learning-assumptions', '가정이 STEP 04 학습용 가상값입니다. 이 결과를 해당 기업의 가치평가로 해석하면 안 됩니다.', 'forecast');
  const reviews = (input.dataQuality?.warnings ?? []).length;
  if (reviews > 0) warn('data-quality-notes', `데이터 품질 노트 ${reviews}건이 있습니다 (부록 참고).`, 'appendix');
  if (r && !input.sensitivity) warn('sensitivity-unavailable', 'Sensitivity 가 계산되지 않아 해당 section 을 생략합니다.', 'sensitivity');
  if (input.scenario && input.scenario.columns.some((x) => !x.ok)) warn('scenario-incomplete', '계산하지 못한 시나리오가 있습니다.', 'scenario');
  if (input.relativeValuation && !input.relativeValuation.rows.some((x) => x.method !== 'DCF' && x.status === 'ok')) warn('relative-unavailable', '상대가치 입력이 없어 DCF 외 방법을 표시하지 않습니다.', 'relativeValuation');
  if (!input.aiAnalysis) warn('no-ai-analysis', 'AI 분석(Deep Analysis) 결과가 없어 서술 section 은 deterministic 내용만 담습니다.', 'executiveSummary');
  else if (input.aiAnalysis.contextSnapshotId !== input.snapshot.contextSnapshotId) warn('ai-analysis-stale', 'AI 분석이 Report 의 Project snapshot 과 다른 상태를 기준으로 해서 서술에 사용하지 않았습니다.', 'executiveSummary');
  return { ok: errors.length === 0, errors, warnings };
}
