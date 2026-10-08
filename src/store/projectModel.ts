// PROJECT 상태의 순수 모델. React 에 의존하지 않으므로 단위 테스트할 수 있다.
//
// 상태는 출처가 다른 네 영역으로 분리하며 하나의 companyData 객체로 섞지 않는다.
//   historicalData        공시 / fixture 기반 과거 데이터
//   valuationAssumptions  사용자 / 학습용 입력 (입력 도중에는 일부 필드만 있을 수 있다. 엔진은 완성된 입력에서만 실행)
//   valuationResult       runValuation() 결과  — 파생값
//   sensitivityResult     runSensitivity() 결과 — 파생값
//   relativeInputs        상대가치 검증용 입력 (순이익·PER 등. 사용자가 직접 입력, Valuation 가정과 별개)
//
// 계산은 valuation 공개 API 로만 수행한다 (forecast.ts / wacc.ts / dcf.ts 직접 import 금지).
// 저장 대상은 historicalData 와 valuationAssumptions 뿐이며, 결과는 로드할 때 다시 계산한다
// (입력과 결과가 어긋난 stale state 를 만들지 않기 위해).
import { calculateWacc, runSensitivity, runValuation, ValuationError } from '../valuation/index.ts';
import type { RelativeInput, SensitivityResult, ValuationInput, ValuationResult } from '../valuation/index.ts';
import type { DataQuality, HistoricalData, HistoricalProvenance, SelectedCompany } from '../data/types.ts';
import type { ForecastInputs } from '../engine/forecastForm.ts';
import type { WaccInputs } from '../engine/waccForm.ts';
import { buildSensitivityAxes } from '../engine/sensitivityAxes.ts';
import type { DcfInputs } from '../engine/dcfForm.ts';
import { isCompleteAssumptions, type AssumptionsDraft } from './assumptions.ts';
import { samsungHistoricalData } from '../data/samsungHistorical.ts';
import { step04PracticeAssumptions } from '../data/step04PracticeAssumptions.ts';

export interface ProjectState {
  /** Workspace 에서 고른 기업(OpenDART). Historical 재무데이터와 별개이며 선택만으로 historicalData 가 바뀌지 않는다. */
  selectedCompany: SelectedCompany | null;
  historicalData: HistoricalData | null;
  /** 정규화 품질(필드 상태 · warning · 매핑 추적). fixture 는 null. 저장하지 않는다 (reload 때 backend 에서 다시 받는다). */
  historicalQuality: DataQuality | null;
  /** Historical 의 출처. 데이터가 없으면 null. */
  historicalProvenance: HistoricalProvenance | null;
  valuationAssumptions: AssumptionsDraft | null;
  valuationResult: ValuationResult | null;
  sensitivityResult: SensitivityResult | null;
  /** 상대가치 입력. 입력한 필드만 들어 있다 (Valuation 가정이 아니므로 가정 초기화로 지워지지 않는다). */
  relativeInputs: RelativeInput;
  /** 직전 계산이 ValuationError 로 실패했을 때의 메시지. 화면에 표시하고 앱은 멈추지 않는다. */
  valuationError: string | null;
  sensitivityError: string | null;
}

/** 저장되는 부분. 결과와 오류는 파생값이라 저장하지 않는다. */
export interface PersistedProject {
  selectedCompany?: SelectedCompany | null;
  /** fixture 일 때만 저장한다. database / opendart 는 provenance 만 저장하고 reload 때 다시 조회한다. */
  historicalData: HistoricalData | null;
  historicalProvenance?: HistoricalProvenance | null;
  valuationAssumptions: AssumptionsDraft | null;
  relativeInputs: RelativeInput;
}

export const emptyProjectState: ProjectState = {
  selectedCompany: null,
  historicalData: null,
  historicalQuality: null,
  historicalProvenance: null,
  valuationAssumptions: null,
  valuationResult: null,
  sensitivityResult: null,
  relativeInputs: {},
  valuationError: null,
  sensitivityError: null,
};

function toMessage(e: unknown): string {
  if (e instanceof ValuationError) return e.message;
  // 엔진 버그 등 예상 밖 오류도 화면이 멈추지 않게 하되, 원인은 콘솔에 남긴다.
  console.error(e);
  return '계산 중 예기치 않은 오류가 발생했습니다.';
}

// ---- 상태 전이 (모두 새 상태를 반환하며 입력 상태를 변경하지 않는다) ----

/**
 * 기업을 선택 · 변경 · 해제한다. 다른 기업(또는 해제)이 되면 이전 기업의 Historical · 가정 · 결과 · 상대가치 입력을 모두 비운다
 * (이전 기업 데이터가 새 기업 화면에 남지 않도록). 같은 기업을 다시 고르면 현재 상태를 그대로 둔다 (재무데이터는 별도로 불러온다).
 */
export function withSelectedCompany(state: ProjectState, selectedCompany: SelectedCompany | null): ProjectState {
  if (selectedCompany !== null && state.selectedCompany?.corpCode === selectedCompany.corpCode) return { ...state, selectedCompany };
  return { ...emptyProjectState, selectedCompany };
}

/** 이 상태에서 학습용 가정을 적용할 수 있는가: 기업을 선택했고 Historical 이 불러와진 뒤에만 (명시적으로 눌렀을 때). */
export function canApplyPractice(state: ProjectState): boolean {
  return state.selectedCompany !== null && state.historicalData !== null;
}

/** 데이터의 meta 로 출처를 추정한다 (provenance 없이 설정되거나 이전 버전에서 저장된 데이터). */
export function deriveProvenance(h: HistoricalData | null): HistoricalProvenance | null {
  if (!h) return null;
  const s = h.meta?.source;
  if (s === 'DART Annual Report') return { source: 'opendart', persisted: false, ...(h.meta?.fetchedAt ? { fetchedAt: h.meta.fetchedAt } : {}), ...(h.meta?.corpCode ? { corpCode: h.meta.corpCode } : {}) };
  if (s === 'Database') return { source: 'database', persisted: true, ...(h.meta?.fetchedAt ? { fetchedAt: h.meta.fetchedAt } : {}), ...(h.meta?.corpCode ? { corpCode: h.meta.corpCode } : {}) };
  return { source: 'fixture', persisted: false, ...(h.meta?.fetchedAt ? { fetchedAt: h.meta.fetchedAt } : {}) };
}

/** Historical Data 만 설정한다. 가정과 결과는 건드리지 않는다. 품질은 알 수 없으므로 비우고 출처는 meta 에서 추정한다. */
export function withHistoricalData(state: ProjectState, historicalData: HistoricalData | null): ProjectState {
  return { ...state, historicalData, historicalQuality: null, historicalProvenance: deriveProvenance(historicalData) };
}

/** 실제 데이터(backend 가 정규화 · 저장한 결과)를 Historical 로 설정한다: 데이터 · 품질 · 출처를 함께 교체한다. 가정과 결과는 건드리지 않는다. */
export function withHistoricalLoaded(state: ProjectState, loaded: { data: HistoricalData; quality: DataQuality | null; provenance: HistoricalProvenance }): ProjectState {
  return { ...state, historicalData: loaded.data, historicalQuality: loaded.quality, historicalProvenance: loaded.provenance };
}

/** [Historical 제거]: Historical 만 지운다. 선택한 기업과 Valuation 가정 · 결과는 유지한다. */
export function withHistoricalCleared(state: ProjectState): ProjectState {
  return { ...state, historicalData: null, historicalQuality: null, historicalProvenance: null };
}

/** 삼성전자 FY2023~FY2025 공시 기반 데이터 불러오기. historicalData 만 바뀐다. */
export function withSamsungHistorical(state: ProjectState): ProjectState {
  return { ...state, historicalData: samsungHistoricalData, historicalQuality: null, historicalProvenance: { source: 'fixture', persisted: false } };
}

/** 가정을 바꾸면 이전 결과는 더 이상 유효하지 않으므로 비운다 (stale 방지). */
export function withAssumptions(state: ProjectState, valuationAssumptions: AssumptionsDraft | null): ProjectState {
  return { ...state, valuationAssumptions, valuationResult: null, sensitivityResult: null, valuationError: null, sensitivityError: null };
}

/**
 * Forecast 입력(매출·마진·세율·D&A·CAPEX·ΔNWC)만 가정에 반영한다. WACC / DCF 가정은 건드리지 않으며,
 * 아직 없으면 비어 있는 채로 둔다 (숨겨진 학습용 기본값으로 채우지 않는다). 이전 결과는 stale 이므로 비운다.
 */
export function withForecastInputs(state: ProjectState, forecast: ForecastInputs): ProjectState {
  return withAssumptions(state, { ...(state.valuationAssumptions ?? {}), ...forecast });
}

/**
 * WACC 입력(Rf, Beta, MRP, Kd, E, D)만 가정에 반영한다. Forecast(세율 포함) / DCF 가정은 그대로 유지한다.
 * 이전 결과는 stale 이므로 비운다.
 */
export function withWaccInputs(state: ProjectState, wacc: WaccInputs): ProjectState {
  return withAssumptions(state, { ...(state.valuationAssumptions ?? {}), ...wacc });
}

/**
 * DCF / Equity 입력(Terminal Growth, 이자부부채, 현금, 발행주식수)만 가정에 반영한다.
 * Forecast / WACC 가정은 그대로 유지한다. 이전 결과는 stale 이므로 비운다.
 */
export function withDcfInputs(state: ProjectState, dcf: DcfInputs): ProjectState {
  return withAssumptions(state, { ...(state.valuationAssumptions ?? {}), ...dcf });
}

/**
 * 상대가치 입력을 통째로 교체한다 (비운 칸은 빠진다). 상대가치 결과는 입력에서 매번 계산되는 파생값이라 stale 처리가 필요 없다.
 * Valuation 가정 / 결과는 건드리지 않는다.
 */
export function withRelativeInputs(state: ProjectState, relativeInputs: RelativeInput): ProjectState {
  return { ...state, relativeInputs: { ...relativeInputs } };
}

/** 입력이 유효하지 않은 상태로 바뀌었을 때: 가정은 그대로 두고 어긋난(stale) 결과와 오류만 비운다. */
export function withResultsCleared(state: ProjectState): ProjectState {
  if (!state.valuationResult && !state.sensitivityResult && !state.valuationError && !state.sensitivityError) return state;
  return { ...state, valuationResult: null, sensitivityResult: null, valuationError: null, sensitivityError: null };
}

/** valuationAssumptions 로 runValuation 을 실행해 결과(또는 오류 메시지)를 저장한다. 가정이 완성되지 않았으면 변화 없음. */
export function withValuationRun(state: ProjectState): ProjectState {
  const a = state.valuationAssumptions;
  if (!isCompleteAssumptions(a)) return state;
  try {
    return { ...state, valuationResult: runValuation(a), valuationError: null };
  } catch (e) {
    return { ...state, valuationResult: null, valuationError: toMessage(e) };
  }
}

/** Base WACC / g 를 중심으로 만든 축(보통 WACC 5 × g 5)으로 runSensitivity 를 실행한다. 가정이 완성되지 않았으면 변화 없음. */
export function withSensitivityRun(state: ProjectState): ProjectState {
  const a = state.valuationAssumptions;
  if (!isCompleteAssumptions(a)) return state;
  try {
    const axes = buildSensitivityAxes(calculateWacc(a).wacc, a.terminalGrowth);
    return { ...state, sensitivityResult: runSensitivity(a, axes.waccValues, axes.terminalGrowthValues), sensitivityError: null };
  } catch (e) {
    return { ...state, sensitivityResult: null, sensitivityError: toMessage(e) };
  }
}

/**
 * "새 Valuation 을 시작한다": 가정 · 결과 · 오류 · 상대가치 입력을 모두 비운다. historicalData 는 유지한다.
 * 이전 상대가치 멀티플이 새 Valuation 과 섞여 혼동되지 않도록 함께 지운다.
 */
export function withValuationReset(state: ProjectState): ProjectState {
  return { ...withAssumptions(state, null), relativeInputs: {} };
}

/**
 * STEP 04 학습용 가정을 적용하고 두 계산을 모두 실행한다. historicalData 는 건드리지 않는다.
 * 이전 상대가치 입력은 학습용 가정과 섞이지 않도록 함께 비운다 (Reset 과 같은 이유).
 * 학습용 fixture 가 가정으로 들어오는 유일한 경로다 (명시적으로 이 동작을 실행했을 때만).
 * 이후의 수정이 fixture 객체에 영향을 주지 않도록 값을 복사해서 저장한다.
 */
export function withPracticeAssumptions(state: ProjectState): ProjectState {
  const fresh = { ...withAssumptions(state, structuredClone(step04PracticeAssumptions)), relativeInputs: {} };
  return withSensitivityRun(withValuationRun(fresh));
}

/**
 * [학습용 DCF 가정 적용] 이 사용자가 입력한 값을 덮어쓰게 되는가.
 * 가정에 값이 하나라도 있고, 그것이 이미 학습용 값과 같은 것이 아니면 true (같으면 덮어써도 잃는 것이 없다).
 * 상대가치 입력도 함께 비워지므로 값이 있으면 확인이 필요하다.
 * 아무 입력도 없는 초기 상태에서는 false 라서 확인 없이 바로 적용한다.
 */
export function practiceApplyNeedsConfirmation(state: ProjectState): boolean {
  if (hasRelativeInputs(state)) return true;
  const a = state.valuationAssumptions;
  if (a === null) return false;
  const hasValue = Object.values(a).some((v) => v !== undefined);
  return hasValue && !isPracticeAssumptions(a);
}

/** 사용자가 입력한 상대가치 값이 하나라도 있는가. */
export function hasRelativeInputs(state: ProjectState): boolean {
  return Object.values(state.relativeInputs).some((v) => v !== undefined);
}

/** 확인 절차를 거친 적용. 확인이 필요한데 승인하지 않았으면(취소) 상태를 그대로 돌려준다. */
export function applyPracticeWithConfirmation(state: ProjectState, confirmed: boolean): ProjectState {
  if (practiceApplyNeedsConfirmation(state) && !confirmed) return state;
  return withPracticeAssumptions(state);
}

// ---- 저장 / 복원 ----

export function toPersisted(state: ProjectState): PersistedProject {
  // database / opendart 의 Historical 은 복제 저장하지 않는다: provenance(corpCode · fiscalYears)만 저장하고 reload 때 backend 에서 다시 조회한다.
  const isFixture = state.historicalProvenance?.source === 'fixture';
  return { selectedCompany: state.selectedCompany, historicalData: isFixture ? state.historicalData : null, historicalProvenance: state.historicalProvenance, valuationAssumptions: state.valuationAssumptions, relativeInputs: state.relativeInputs };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** 저장된 선택 기업의 형식이 맞을 때만 복원한다 (손상된 값 방어). */
function sanitizeSelectedCompany(raw: unknown): SelectedCompany | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const corpCode = str(r.corpCode), corpName = str(r.corpName), fetchedAt = str(r.fetchedAt);
  if (!corpCode || !/^\d{8}$/.test(corpCode) || !corpName || !fetchedAt || r.source !== 'OpenDART') return null;
  return { corpCode, corpName, corpNameEng: str(r.corpNameEng), stockCode: str(r.stockCode), corpClass: str(r.corpClass), source: 'OpenDART', fetchedAt };
}

const SOURCES = ['database', 'opendart', 'fixture'];
/** 저장된 출처의 형식이 맞을 때만 복원한다. */
function sanitizeProvenance(raw: unknown): HistoricalProvenance | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.source !== 'string' || !SOURCES.includes(r.source)) return null;
  const years = Array.isArray(r.fiscalYears) && r.fiscalYears.every((y) => Number.isInteger(y)) ? (r.fiscalYears as number[]) : undefined;
  return {
    source: r.source as HistoricalProvenance['source'], persisted: r.persisted === true,
    ...(str(r.fetchedAt) ? { fetchedAt: str(r.fetchedAt) as string } : {}), ...(typeof r.fetchId === 'string' || r.fetchId === null ? { fetchId: r.fetchId as string | null } : {}),
    ...(str(r.corpCode) ? { corpCode: str(r.corpCode) as string } : {}), ...(years ? { fiscalYears: years } : {}),
    ...(r.basisChoice === 'auto' || r.basisChoice === 'consolidated' || r.basisChoice === 'separate' ? { basisChoice: r.basisChoice } : {}),
  };
}

/**
 * Historical 복원 정책 (reload):
 *  - fixture(또는 출처 불명의 이전 저장값): 저장된 데이터를 그대로 복원한다.
 *  - database / opendart: 데이터는 복원하지 않는다. provenance(corpCode · fiscalYears)가 남아 있으면 needsHistoricalRefetch 가 true 이고
 *    provider 가 backend 에서 다시 조회한다 (오래된 값 · 출처가 남지 않는다).
 */
function restoreHistorical(p: Partial<PersistedProject>): Pick<ProjectState, 'historicalData' | 'historicalQuality' | 'historicalProvenance'> {
  const provenance = sanitizeProvenance(p.historicalProvenance);
  const data = p.historicalData ?? null;
  if (provenance && provenance.source !== 'fixture') return { historicalData: null, historicalQuality: null, historicalProvenance: provenance };
  if (data) return { historicalData: data, historicalQuality: null, historicalProvenance: provenance ?? deriveProvenance(data) };
  return { historicalData: null, historicalQuality: null, historicalProvenance: null };
}

/** reload 후 backend 에서 Historical 을 다시 조회해야 하는가. */
export function needsHistoricalRefetch(state: ProjectState): boolean {
  const p = state.historicalProvenance;
  return state.historicalData === null && p !== null && p.source !== 'fixture' && !!p.corpCode && !!p.fiscalYears?.length;
}

const RELATIVE_KEYS = ['netIncome', 'per', 'bookEquity', 'pbr', 'ebitda', 'evEbitda'] as const;
/** 저장된 상대가치 입력에서 알려진 필드의 유한한 숫자만 남긴다 (손상된 값 방어). */
function sanitizeRelativeInputs(raw: unknown): RelativeInput {
  const out: RelativeInput = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const k of RELATIVE_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

/**
 * 저장된 입력을 복원하고, 가정이 있으면 결과를 다시 계산한다.
 * 저장소 값이 비정상이어도 앱이 멈추지 않는다 (계산 오류는 상태의 오류 메시지로 남는다).
 */
export function restoreProjectState(raw: unknown): ProjectState {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<PersistedProject>;
  // 선택한 기업이 없으면 이전 세션의 어떤 데이터(Historical · 가정 · fixture)도 복원하지 않는다: 첫 화면은 항상 빈 상태다.
  const selectedCompany = sanitizeSelectedCompany(p.selectedCompany);
  if (selectedCompany === null) return emptyProjectState;
  const historical = restoreHistorical(p);
  // 저장된 Historical 이 다른 기업의 것이면(출처의 corpCode 불일치) 그 기업의 가정과 함께 버린다.
  if (historical.historicalProvenance?.corpCode && historical.historicalProvenance.corpCode !== selectedCompany.corpCode) return { ...emptyProjectState, selectedCompany };
  const base: ProjectState = {
    ...emptyProjectState,
    selectedCompany,
    ...historical,
    valuationAssumptions: p.valuationAssumptions ?? null,
    relativeInputs: sanitizeRelativeInputs(p.relativeInputs),
  };
  return withSensitivityRun(withValuationRun(base));
}

/**
 * 현재 가정이 STEP 04 학습용 가정과 값이 모두 같은지 (같을 때만 "학습용 가정" 배지를 표시).
 * 객체를 만든 순서(키 순서)와 무관하게 필드별 값으로 비교한다. 일부만 채워진 입력은 학습용 가정이 아니다.
 */
export function isPracticeAssumptions(a: AssumptionsDraft | null): boolean {
  if (a === null) return false;
  const keys = Object.keys(step04PracticeAssumptions) as (keyof ValuationInput)[];
  return Object.keys(a).length === keys.length && keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(step04PracticeAssumptions[k]));
}
