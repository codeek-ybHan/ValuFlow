// AI Valuation Analyst 가 볼 수 있는 context. 현재 Project State 에서 만들어지는 읽기 전용 스냅샷이다.
//   - Raw OpenDART 행 전체를 담지 않는다. 필요한 값은 Tool 로 조회한다 (Historical · Quality · Trace · Valuation …).
//   - Actual(공시) / Assumption(가정) / Calculated(엔진 결과)를 `dataKinds` 로 구분해서 전달한다.
//   - 지원하지 않는 기업(unsupported-industry / unsupported-structure)이면 `support` 로 알리고 Historical 은 비운다.
//   - 원본 Project State 를 바꾸지 않는다 (깊은 복사 + freeze).
import type { DataQuality, HistoricalData, HistoricalProvenance, SelectedCompany } from '../data/types.ts';
import type { RelativeInput, SensitivityResult, ValuationResult } from '../valuation/index.ts';
import type { ProjectState } from '../store/projectModel.ts';
import type { AssumptionsDraft } from '../store/assumptions.ts';
import { assumptionBasis, type AssumptionBasis } from '../store/workflowStatus.ts';
import type { HistoricalLoadStatus } from '../store/historicalLoad.ts';
import { analyzeHistorical, UNSUPPORTED_MESSAGE, type HistoricalAnalysis } from '../engine/historicalAnalysis.ts';

export type CompanySupport =
  | { status: 'supported' }
  | { status: 'no-data' }
  | { status: 'unsupported'; code: 'unsupported-industry' | 'unsupported-structure'; reason: string; message: string };

export interface AiCompany {
  name: string;
  corpCode: string | null;
  stockCode: string | null;
  basis: string | null;
}

export interface AiValuationContext {
  company: AiCompany | null;
  support: CompanySupport;

  historicalData: HistoricalData | null;
  /** Historical Analysis Engine 의 결과 (Historical 이 있을 때). 파생값이라 context 생성 시 계산한다. */
  historicalAnalysis: HistoricalAnalysis | null;
  historicalQuality: DataQuality | null;
  historicalProvenance: HistoricalProvenance | null;

  valuationAssumptions: AssumptionsDraft | null;
  valuationResult: ValuationResult | null;
  sensitivityResult: SensitivityResult | null;
  relativeInputs: RelativeInput;
  valuationError: string | null;
  sensitivityError: string | null;

  /** Actual / Assumption / Calculated 를 섞지 않도록 구분 */
  dataKinds: {
    historical: 'actual' | 'fixture' | 'none';
    assumptions: AssumptionBasis;
    results: 'calculated' | 'none';
  };
}

export interface AiContextOptions {
  /** 마지막 Historical 불러오기 상태. 선택한 기업이 unsupported 로 실패했다면 context 가 이를 반영한다. */
  historicalStatus?: HistoricalLoadStatus;
}

const deepFreeze = <T,>(o: T): T => {
  if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

function supportOf(selected: SelectedCompany | null, status: HistoricalLoadStatus | undefined): CompanySupport | null {
  if (status?.kind === 'failed' && status.failure.kind === 'unsupported' && selected) {
    return {
      status: 'unsupported', code: status.failure.code ?? 'unsupported-structure', reason: status.failure.message, message: UNSUPPORTED_MESSAGE,
    };
  }
  return null;
}

/** 현재 Project State 로 AI context 를 만든다. 순수 함수이며 state 를 변경하지 않는다. */
export function buildAiContext(project: ProjectState, options: AiContextOptions = {}): AiValuationContext {
  const snapshot = structuredClone(project);
  const unsupported = supportOf(snapshot.selectedCompany, options.historicalStatus);
  const h = unsupported ? null : snapshot.historicalData;
  const quality = unsupported ? null : snapshot.historicalQuality;
  const provenance = unsupported ? null : snapshot.historicalProvenance;
  const selected = snapshot.selectedCompany;

  const company: AiCompany | null = unsupported && selected
    ? { name: selected.corpName, corpCode: selected.corpCode, stockCode: selected.stockCode, basis: null }
    : h
      ? { name: h.company.name, corpCode: provenance?.corpCode ?? h.meta?.corpCode ?? null, stockCode: h.company.ticker || null, basis: h.company.basis }
      : selected
        ? { name: selected.corpName, corpCode: selected.corpCode, stockCode: selected.stockCode, basis: null }
        : null;

  // 지원하지 않는 기업이면 가치평가 결과도 그 기업의 것이 아니므로 노출하지 않는다.
  const ctx: AiValuationContext = {
    company,
    support: unsupported ?? (h ? { status: 'supported' } : { status: 'no-data' }),
    historicalData: h,
    historicalAnalysis: h ? analyzeHistorical(h, quality) : null,
    historicalQuality: quality,
    historicalProvenance: provenance,
    valuationAssumptions: unsupported ? null : snapshot.valuationAssumptions,
    valuationResult: unsupported ? null : snapshot.valuationResult,
    sensitivityResult: unsupported ? null : snapshot.sensitivityResult,
    relativeInputs: unsupported ? {} : snapshot.relativeInputs,
    valuationError: unsupported ? null : snapshot.valuationError,
    sensitivityError: unsupported ? null : snapshot.sensitivityError,
    dataKinds: {
      historical: !h ? 'none' : provenance?.source === 'fixture' ? 'fixture' : 'actual',
      assumptions: unsupported ? 'none' : assumptionBasis(snapshot),
      results: !unsupported && snapshot.valuationResult ? 'calculated' : 'none',
    },
  };
  return deepFreeze(ctx);
}
