// STEP 09-2 Template 계약. ReportModel 은 데이터이고 Template 은 "어떤 section 을 어떤 순서 · 제목 · 번호 · 가시성 · layout 힌트로 보여 줄지"만 정한다.
// Template 은 숫자를 만들거나 바꾸지 않는다 (Cell 은 모델 그대로이며 Renderer 도 다시 계산하지 않는다).
import type { Cell, SourceDocument, SourceKind, SourceProvider, SourceRef } from '../types.ts';
import type { Appendix, ExternalReference, CompanyOverview, DcfSection, ExecutiveSummary, ForecastSection, HistoricalPerformance, KeyRisks, RelativeSection, ReportMetadata, ScenarioSection, SensitivitySection, TableRow, ValuationRangeSection, WaccSection } from '../model.ts';
import type { Narrative, SectionState } from '../types.ts';

export const SECTION_IDS = ['cover', 'executiveSummary', 'companyOverview', 'historicalPerformance', 'forecast', 'wacc', 'dcf', 'sensitivity', 'scenario', 'relativeValuation', 'marketReference', 'keyRisks', 'conclusion', 'sources', 'appendix'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** always: 데이터가 없어도 section 을 보여 준다(unavailable 안내) · when-available: 데이터가 없으면 숨기고 diagnostics 에 이유를 남긴다 · never: 이 template 에서 쓰지 않는다 */
export type Visibility = 'always' | 'when-available' | 'never';

/** Renderer 에 주는 배치 힌트 (스타일이 아니라 의미). */
export interface LayoutHint {
  kind: 'cover' | 'summary' | 'key-value' | 'table' | 'matrix' | 'columns' | 'bridge' | 'narrative' | 'list' | 'sources' | 'appendix';
  pageBreakBefore?: boolean;
  /** columns 형 section(Scenario)의 열 수 힌트 등 */
  columns?: number;
}

export interface SectionTemplate {
  sectionId: SectionId;
  title: string;
  /** 정렬 기준. 번호는 보이는 section 만 순서대로 template 이 매긴다 */
  order: number;
  required: boolean;
  visibility: Visibility;
  layout: LayoutHint;
  /** 번호 방식: decimal(1, 2, …) · appendix(A) · none(표지) */
  numbering: 'decimal' | 'appendix' | 'none';
}

export interface ReportTemplate {
  id: string;
  name: string;
  version: string;
  sections: SectionTemplate[];
}

// ---- 해석된 문서 (ReportModel + Template) ----
export type SectionStatus = 'ok' | 'warning' | 'unavailable' | 'not-applicable';

export interface SourceEntry {
  /** [S1] 같은 footnote marker (S1) */
  marker: string;
  id: string;
  label: string;
  /** ValuFlow Engine · OpenDART · Disclosure · Uploaded PDF · Assumption · Market Data · Peer Data · News · Learning Fixture */
  type: string;
  kind: SourceKind;
  asOf: string | null;
  provider: string | null;
  reliability: string | null;
  /** 문서 · page · section · 접수번호 · 공시일 등 가능한 정보만 */
  reference: string | null;
  url: string | null;
  /** 문서 · 뉴스 출처의 위치 정보 */
  document: SourceDocument | null;
  /** 외부 provider 메타데이터 (등급 · official · valuationGrade) */
  providerInfo: SourceProvider | null;
  /** Development provider 등 사용자가 알아야 하는 고지 */
  notice: string | null;
}

export interface CoverContent {
  company: string;
  ticker: string | null;
  title: string;
  /** "As of 2026-10-08" */
  subtitle: string | null;
  valuationDate: string | null;
  createdAt: string;
  currency: string;
  monetaryUnit: string;
  perShareUnit: string;
  reportVersion: { schema: string; template: string };
}

export interface CompanyOverviewContent {
  companyName: string;
  corpCode: string | null;
  stockCode: string | null;
  reportingBasis: string | null;
  historicalPeriod: string;
  periods: CompanyOverview['periods'];
  dataSource: { sourceId: string; label: string; origin: string };
  dataKind: 'actual' | 'fixture';
}

export interface HistoricalContent {
  periods: HistoricalPerformance['periods'];
  /** Revenue · Operating Profit · Operating Margin · Net Income · CFO · CAPEX */
  coreRows: TableRow[];
  additionalRows: TableRow[];
  trendSummary: { key: string; label: string; direction: string; directionLabel: string; fromPeriod: string | null; toPeriod: string | null }[];
  revenueCagr: Cell;
  notes: string[];
  narrative: SectionState<Narrative>;
  dataSource: { sourceId: string; label: string };
}

export interface ForecastContent {
  periods: ForecastSection['periods'];
  assumptions: TableRow[];
  projections: TableRow[];
  scalars: ForecastSection['scalars'];
  basisNote: string;
  narrative: ForecastSection['narrative'];
  /** 가정의 출처 (user-input / learning-fixture) */
  assumptionSource: { sourceId: string; label: string; origin: string };
}

export interface WaccContent {
  /** 입력(Estimate) — 구성요소 */
  inputs: WaccSection['components'];
  /** 계산 결과(Calculated) — Cost of Equity · After-tax Cost of Debt · 가중치 */
  derived: WaccSection['components'];
  wacc: Cell;
  note: string;
}

export interface SectionContentMap {
  cover: CoverContent;
  executiveSummary: ExecutiveSummary;
  companyOverview: CompanyOverviewContent;
  historicalPerformance: HistoricalContent;
  forecast: ForecastContent;
  wacc: WaccContent;
  dcf: DcfSection;
  sensitivity: SensitivitySection;
  scenario: ScenarioSection;
  relativeValuation: RelativeSection & { inputSource: { sourceId: string; label: string } | null; note: string };
  marketReference: ExternalReference;
  keyRisks: KeyRisks;
  conclusion: { headline: ExecutiveSummary['headline']; range: SectionState<ValuationRangeSection>; narrative: SectionState<Narrative>; disclaimers: string[] };
  sources: { entries: SourceEntry[] };
  appendix: AppendixContent;
}

export interface MissingDataEntry { sectionId: SectionId; label: string; state: Exclude<Cell['state'], 'ok'>; reason: string | null }

export interface AppendixContent {
  dataQuality: string[];
  provenance: { sourceId: string; label: string; origin: string; basis: string | null; asOf: string | null; kind: 'actual' | 'fixture' } | null;
  missingData: MissingDataEntry[];
  validationWarnings: Appendix['validation']['warnings'];
  assumptionSources: { key: string; label: string; cell: Cell; sourceLabel: string }[];
  unitPolicy: Appendix['unitPolicy'];
  kindLegend: Appendix['kindLegend'];
  narrativeRejected: Appendix['narrativeRejected'];
  narrativeOmitted: number;
  technical: { schemaVersion: string; templateId: string; templateVersion: string; reportId: string; inputHash: string; contextSnapshotId: string; valuationSnapshotId: string | null };
}

export type ResolvedSection = {
  [K in SectionId]: {
    sectionId: K;
    /** 보이는 section 에 template 이 매긴 번호 ("1", "2" …, 부록 "A", 표지 null) */
    number: string | null;
    title: string;
    required: boolean;
    layout: LayoutHint;
    status: SectionStatus;
    /** status 가 unavailable / not-applicable 이거나 warning 일 때의 이유 */
    reason: string | null;
    /** section 상단에 표시할 고지 (예: Learning / Demonstration Data) */
    notices: string[];
    /** 이 section 이 인용하는 출처의 footnote marker (예: ['S1', 'S3']) */
    sourceMarkers: string[];
    /** status 가 unavailable / not-applicable 이면 null (빈 section 을 만들지 않는다) */
    content: SectionContentMap[K] | null;
  };
}[SectionId];

export interface ReportBanner { id: 'learning-data'; title: string; text: string }

export interface ReportDocument {
  documentVersion: '1.0';
  template: { id: string; name: string; version: string };
  metadata: ReportMetadata;
  /** 보고서 상단에 표시할 고지 (학습용 · 시연용 데이터) */
  banners: ReportBanner[];
  /** 보이는 section 만, template 순서대로 */
  sections: ResolvedSection[];
  sources: SourceEntry[];
  /** sourceId → footnote marker. Renderer 는 sourceId 를 가진 Cell · narrative 에 이 marker 를 붙인다 */
  footnoteIndex: Record<string, string>;
  diagnostics: {
    hiddenSections: { sectionId: SectionId; title: string; reason: string }[];
    sectionStatus: Record<string, SectionStatus>;
  };
}

export type { SourceRef };
