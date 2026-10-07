// STEP 08-8 평가용 Project 시나리오. 실제 OpenDART 로 정규화한 삼성전자 golden(backend/tests/golden)과 STEP 04 학습용 가정을 쓴다.
import { emptyProjectState, withHistoricalLoaded, withPracticeAssumptions, withRelativeInputs, withSelectedCompany, type ProjectState } from '../../store/projectModel.ts';
import type { HistoricalLoadStatus } from '../../store/historicalLoad.ts';

export type Scenario = 'full' | 'no-valuation' | 'no-historical' | 'unsupported' | 'empty';

const AT = '2026-10-07T00:00:00+00:00';
const SAMSUNG = { corpCode: '00126380', corpName: '삼성전자', corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART' as const, fetchedAt: AT };
const NAVER = { corpCode: '00266961', corpName: 'NAVER', corpNameEng: null, stockCode: '035420', corpClass: 'Y', source: 'OpenDART' as const, fetchedAt: AT };
const RELATIVE = { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 };

/** backend/tests/golden/samsung.json 의 `expected` (테스트 · 스크립트가 읽어서 넘긴다: 이 모듈은 파일 시스템을 모른다). */
export interface GoldenSamsung { data: never; quality: never }

const samsungHistorical = (s: ProjectState, golden: GoldenSamsung): ProjectState => {
  return withHistoricalLoaded(withSelectedCompany(s, SAMSUNG), { data: golden.data, quality: golden.quality, provenance: { source: 'database', persisted: true, fetchedAt: AT, fetchId: '1', corpCode: SAMSUNG.corpCode, fiscalYears: [2023, 2024, 2025] } });
};

export interface BuiltScenario { project: ProjectState; historicalStatus?: HistoricalLoadStatus }

export function buildScenario(s: Scenario, golden: GoldenSamsung): BuiltScenario {
  switch (s) {
    case 'full': return { project: withRelativeInputs(withPracticeAssumptions(samsungHistorical(emptyProjectState, golden)), RELATIVE) };
    case 'no-valuation': return { project: samsungHistorical(emptyProjectState, golden) };
    case 'no-historical': return { project: withSelectedCompany(emptyProjectState, SAMSUNG) };
    case 'unsupported': return {
      project: withSelectedCompany(withRelativeInputs(withPracticeAssumptions(samsungHistorical(emptyProjectState, golden)), RELATIVE), NAVER),   // 이전(삼성전자) 상태가 남아 있는 채로 미지원 기업을 선택
      historicalStatus: { kind: 'failed', refresh: false, failure: { kind: 'unsupported', code: 'unsupported-structure', message: '성격별 비용 손익계산서', quality: null } },
    };
    case 'empty': return { project: emptyProjectState };
  }
}
