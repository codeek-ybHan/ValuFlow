// 실제 Historical 불러오기 흐름 (React 비의존). 화면은 이 결과를 그대로 상태에 반영하고 표시한다.
//   selectedCompany.corpCode → repository.getHistoricalFinancials → historicalData · historicalQuality · historicalProvenance
// 정책: 실패(unsupported / incomplete / unavailable)해도 기존 Historical 은 지우지 않고 오류만 표시한다. fixture 로 대체하지 않는다.
import type { DataQuality, HistoricalData, HistoricalProvenance, SelectedCompany } from '../data/types.ts';
import type { FinancialRepository, HistoricalFinancialsResult } from '../data/repository/financialRepository.ts';
import { withHistoricalLoaded, type ProjectState } from './projectModel.ts';

export type HistoricalFailureKind = 'unsupported' | 'incomplete' | 'unavailable' | 'not-found';

export interface HistoricalFailure {
  kind: HistoricalFailureKind;
  /** unsupported 일 때: 금융업 / 성격별 비용 손익계산서 */
  code?: 'unsupported-industry' | 'unsupported-structure';
  message: string;
  /** 서버가 돌려준 사유 / 품질 (표시용). 데이터는 없다. */
  quality: DataQuality | null;
}

export type HistoricalLoadOutcome =
  | { ok: true; data: HistoricalData; quality: DataQuality | null; provenance: HistoricalProvenance }
  | { ok: false; failure: HistoricalFailure };

/** 화면 상태: 불러오는 중이거나 마지막 시도가 실패했는지 (저장하지 않는 일시 상태). */
export type HistoricalLoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; refresh: boolean }
  | { kind: 'failed'; failure: HistoricalFailure; refresh: boolean };

export const UNSUPPORTED_UX = {
  title: '현재 Generic Valuation Model 이 이 재무제표 구조를 지원하지 않습니다.',
  scope: '지원 범위: 제조업 / 일반 비금융 기업',
} as const;

const years = (h: HistoricalData) => h.company.period.map((p) => Number.parseInt(p, 10)).filter(Number.isInteger);

/** repository 결과를 Historical 상태에 넣을 값으로 바꾼다. */
export function toLoadOutcome(res: HistoricalFinancialsResult, company: SelectedCompany): HistoricalLoadOutcome {
  if (res.ok) {
    const p = res.provenance;
    return {
      ok: true, data: res.data, quality: res.quality,
      provenance: {
        source: p?.source ?? 'opendart', persisted: p?.persisted ?? false, fetchedAt: p?.fetchedAt ?? res.data.meta?.fetchedAt,
        fetchId: p?.fetchId === undefined || p.fetchId === null ? null : String(p.fetchId), corpCode: company.corpCode, fiscalYears: years(res.data),
      },
    };
  }
  const kind: HistoricalFailureKind = res.reason === 'unsupported' ? 'unsupported' : res.reason === 'incomplete' ? 'incomplete' : res.reason === 'not-found' ? 'not-found' : 'unavailable';
  return { ok: false, failure: { kind, ...(res.code ? { code: res.code } : {}), message: res.message, quality: res.quality ?? null } };
}

/** 선택한 기업의 Historical 을 repository 로 불러온다. 예외는 던지지 않고 failure 로 돌려준다. */
export async function loadHistorical(
  repo: FinancialRepository, company: SelectedCompany, options: { refresh?: boolean; fiscalYears?: number[] } = {},
): Promise<HistoricalLoadOutcome> {
  try {
    const res = await repo.getHistoricalFinancials({
      corpCode: company.corpCode, ...(company.stockCode ? { stockCode: company.stockCode } : {}), companyName: company.corpName,
      ...(options.fiscalYears ? { fiscalYears: options.fiscalYears } : {}), ...(options.refresh ? { refresh: true } : {}),
    });
    return toLoadOutcome(res, company);
  } catch {
    return { ok: false, failure: { kind: 'unavailable', message: '재무데이터를 불러오지 못했습니다.', quality: null } };
  }
}

/** 결과 반영: 성공이면 데이터 · 품질 · 출처를 교체하고, 실패면 상태를 그대로 둔다 (기존 Historical 을 지우지 않는다). */
export function applyLoadOutcome(state: ProjectState, outcome: HistoricalLoadOutcome): ProjectState {
  return outcome.ok ? withHistoricalLoaded(state, outcome) : state;
}

/** 출처 표시(Company / Basis / Source / Fetched / Periods / Persisted). Fixture 와 실제 데이터를 구분한다. */
export interface ProvenanceLine { label: string; value: string }

export function provenanceView(h: HistoricalData, p: HistoricalProvenance | null): { sourceLabel: string; actual: boolean; lines: ProvenanceLine[] } {
  const source = p?.source ?? 'fixture';
  const sourceLabel = source === 'database' ? 'Database' : source === 'opendart' ? 'OpenDART' : 'Fixture (학습용)';
  return {
    sourceLabel, actual: source !== 'fixture',
    lines: [
      { label: 'Company', value: `${h.company.name}${h.company.ticker ? ` (${h.company.ticker})` : ''}` },
      { label: 'Basis', value: h.company.basis },
      { label: 'Source', value: sourceLabel },
      ...(p?.fetchedAt ? [{ label: 'Fetched at', value: p.fetchedAt }] : []),
      { label: 'Periods', value: `${h.company.period[0]}–${h.company.period[h.company.period.length - 1]}` },
      { label: 'Persisted', value: source === 'fixture' ? 'No (fixture)' : p?.persisted ? 'Yes' : 'No' },
    ],
  };
}
