// ReportInput: Report 생성 시점의 snapshot. Project State 를 직접 읽는 곳은 이 파일(buildReportInput)뿐이고, 이후 단계(buildReport · Renderer)는 이 입력만 본다.
//
// 계산 정책 (No Recalculation)
//  - Historical 지표 · WACC · DCF 결과는 Project State 에 이미 있는 엔진 / 분석 결과를 그대로 옮긴다. 없으면 만들지 않고 비워 둔다 (runValuation 을 호출하지 않는다).
//  - Sensitivity · Scenario · 상대가치 view 는 Validation 화면 · AI Tool 과 같은 `buildValidationView`(valuation 공개 API 호출) 결과를 수집한다. Project State 에 저장되지 않는 엔진 산출물을 모으는 일이며,
//    이 수집은 여기서 한 번만 일어난다. buildReport 는 엔진을 import 하지 않는다.
import { buildAiContext, type AiContextOptions } from '../ai/context.ts';
import { snapshotId } from '../ai/agent/run.ts';
import type { AnswerSource } from '../ai/answer.ts';
import type { WorkflowAnswer } from '../ai/agent/types.ts';
import type { Evidence, GroundedClaim } from '../ai/grounding/types.ts';
import type { DataQuality, HistoricalData, HistoricalProvenance } from '../data/types.ts';
import type { HistoricalAnalysis } from '../engine/historicalAnalysis.ts';
import { buildValidationView, type ReviewMetrics, type RelativeView, type ScenarioView, type SensitivityView, type ValidationWarning, type ValuationRange } from '../engine/validationView.ts';
import { isCompleteAssumptions, type AssumptionsDraft } from '../store/assumptions.ts';
import type { ProjectState } from '../store/projectModel.ts';
import type { RelativeInput, ValuationResult } from '../valuation/index.ts';
import { hashOf } from './hash.ts';
import { REPORT_SCHEMA_VERSION, type ReportSchemaVersion } from './types.ts';

/** AI Analyst(Deep Analysis)의 검증된 결과. 모델이 쓴 문장을 그대로 받지 않고 검증을 통과한 claim · evidence 만 담는다. */
export interface AiAnalysisInput {
  analysisId: string;
  question: string;
  workflowType: string;
  /** 이 분석이 실행된 Project snapshot (WorkflowState.contextSnapshotId). Report snapshot 과 다르면 이전 상태 기준이다. */
  contextSnapshotId: string;
  createdAt: string;
  groundingLevel: 'claim-evidence';
  claims: GroundedClaim[];
  evidence: Evidence[];
  sources: AnswerSource[];
  limitations: string[];
}

export function aiAnalysisFromWorkflow(answer: WorkflowAnswer, meta: { analysisId: string; question: string; workflowType: string; contextSnapshotId: string; createdAt: string }): AiAnalysisInput {
  return structuredClone({
    ...meta, groundingLevel: 'claim-evidence' as const,
    claims: answer.claims, evidence: answer.evidenceMap, sources: answer.sources, limitations: answer.limitations,
  });
}

export interface ReportSnapshotInfo {
  /** Project context snapshot 식별자 (AI 분석과 같은 기준: ai/agent/run.ts 의 snapshotId) */
  contextSnapshotId: string;
  createdAt: string;
  /** Historical 을 가져온 시각 (없으면 null) */
  historicalAsOf: string | null;
  historicalPeriods: string[];
  /** 외부 시장 데이터의 관측 시점 (AI 분석 근거에 market-data 가 있을 때만) */
  marketAsOf: string | null;
  /** Valuation 결과 + 가정의 식별자. 결과가 없으면 null */
  valuationSnapshotId: string | null;
  /** 입력 전체의 해시: 같은 입력이면 같은 값 */
  inputHash: string;
}

export interface ReportInput {
  schemaVersion: ReportSchemaVersion;
  createdAt: string;
  company: { name: string; ticker: string | null; corpCode: string | null; basis: 'Consolidated' | 'Separate' | null; currency: string | null } | null;
  support: { status: 'supported' | 'no-data' | 'unsupported'; reason: string | null };
  historical: HistoricalData | null;
  historicalAnalysis: HistoricalAnalysis | null;
  dataQuality: DataQuality | null;
  provenance: HistoricalProvenance | null;
  historicalKind: 'actual' | 'fixture' | 'none';
  assumptions: AssumptionsDraft | null;
  assumptionKind: 'user-input' | 'learning' | 'none';
  valuationResult: ValuationResult | null;
  valuationError: string | null;
  /** 엔진 산출물 view (Validation 화면 · AI Tool 과 같은 모델). Project State 에 결과가 없으면 null */
  sensitivity: SensitivityView | null;
  scenario: ScenarioView | null;
  relativeValuation: RelativeView | null;
  relativeInputs: RelativeInput;
  valuationRange: ValuationRange | null;
  reviewMetrics: ReviewMetrics | null;
  reviewWarnings: ValidationWarning[];
  aiAnalysis: AiAnalysisInput | null;
  snapshot: ReportSnapshotInfo;
}

export interface BuildReportInputOptions extends AiContextOptions {
  now?: () => Date;
  aiAnalysis?: AiAnalysisInput | null;
}

const latest = (xs: (string | null | undefined)[]): string | null => xs.filter((x): x is string => !!x).sort().pop() ?? null;

/** Project State 의 현재 값을 snapshot 으로 고정한다. 이후 Project 가 바뀌어도 이 입력(과 여기서 만든 Report)은 바뀌지 않는다. */
export function buildReportInput(project: ProjectState, options: BuildReportInputOptions = {}): ReportInput {
  const now = (options.now ?? (() => new Date()))().toISOString();
  const ctx = buildAiContext(project, { historicalStatus: options.historicalStatus });   // structuredClone 한 불변 snapshot
  const a = ctx.valuationAssumptions;
  const complete = a !== null && isCompleteAssumptions(a);
  const view = complete && ctx.valuationResult
    ? buildValidationView({ assumptions: a, result: ctx.valuationResult, sensitivity: ctx.sensitivityResult, relativeInput: ctx.relativeInputs })
    : null;
  const ai = options.aiAnalysis ? structuredClone(options.aiAnalysis) : null;
  const contextSnapshotId = snapshotId(ctx);

  const body = {
    company: ctx.company ? { name: ctx.company.name, ticker: ctx.company.stockCode, corpCode: ctx.company.corpCode, basis: ctx.historicalData?.company.basis ?? null, currency: ctx.historicalData?.company.currency ?? null } : null,
    support: { status: ctx.support.status === 'unsupported' ? 'unsupported' as const : ctx.support.status === 'supported' ? 'supported' as const : 'no-data' as const, reason: ctx.support.status === 'unsupported' ? ctx.support.reason : null },
    historical: structuredClone(ctx.historicalData),
    historicalAnalysis: structuredClone(ctx.historicalAnalysis),
    dataQuality: structuredClone(ctx.historicalQuality),
    provenance: structuredClone(ctx.historicalProvenance),
    historicalKind: ctx.dataKinds.historical,
    assumptions: structuredClone(a) as AssumptionsDraft | null,
    assumptionKind: ctx.dataKinds.assumptions === 'learning' ? 'learning' as const : a === null ? 'none' as const : 'user-input' as const,
    valuationResult: structuredClone(ctx.valuationResult),
    valuationError: ctx.valuationError,
    sensitivity: view?.sensitivity ?? null,
    scenario: view?.scenarios ?? null,
    relativeValuation: view?.relative ?? null,
    relativeInputs: structuredClone(ctx.relativeInputs),
    valuationRange: view?.range ?? null,
    reviewMetrics: view?.metrics ?? null,
    reviewWarnings: view?.warnings ?? [],
    aiAnalysis: ai,
  };
  const snapshot: ReportSnapshotInfo = {
    contextSnapshotId, createdAt: now,
    historicalAsOf: ctx.historicalProvenance?.fetchedAt ?? null,
    historicalPeriods: ctx.historicalData ? [...ctx.historicalData.company.period] : [],
    marketAsOf: latest((ai?.evidence ?? []).filter((e) => e.sourceType === 'market-data').map((e) => e.asOf)),
    valuationSnapshotId: ctx.valuationResult ? `val-${hashOf([a, ctx.valuationResult])}` : null,
    inputHash: hashOf(body),
  };
  return structuredClone({ schemaVersion: REPORT_SCHEMA_VERSION, createdAt: now, ...body, snapshot });
}
