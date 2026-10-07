// ReportModel: Renderer / Export 가 받는 유일한 입력. 각 section 은 독립 타입이다.
// 숫자는 모두 Cell(원본 값 + 정책 단위 표시 + Actual/Estimate/Calculated + 출처 id)이고, 서술은 AI(Grounded Claim)가 쓴 것과 deterministic 한 것을 구분한다.
import type { Cell, Narrative, PeriodLabel, ReportSchemaVersion, SectionState, SourceRef } from './types.ts';
import type { ReportIssue } from './validation/validate.ts';

export interface ReportMetadata {
  schemaVersion: ReportSchemaVersion;
  reportId: string;
  reportTitle: string;
  createdAt: string;
  company: { name: string; ticker: string | null; corpCode: string | null };
  /** Valuation 기준일: 가정으로 계산한 시점이 아니라 Report 생성 시점의 snapshot 이다. */
  valuationDate: string | null;
  currency: string;
  monetaryUnit: string;
  perShareUnit: string;
  snapshot: { contextSnapshotId: string; historicalAsOf: string | null; marketAsOf: string | null; valuationSnapshotId: string | null; inputHash: string };
  /** 데이터 성격: 학습용 fixture / 가정이면 보고서 전체에 표시해야 한다 */
  dataBasis: { historical: 'actual' | 'fixture'; assumptions: 'user-input' | 'learning' };
  sourceSummary: { id: string; kind: string; label: string }[];
}

export interface ExecutiveSummary {
  headline: { enterpriseValue: Cell; equityValue: Cell; perShareValue: Cell; wacc: Cell; terminalGrowth: Cell; tvContribution: Cell };
  range: SectionState<ValuationRangeSection>;
  /** 데이터 성격에 대한 고지 (학습용 가정 · fixture) */
  notices: string[];
  narrative: SectionState<Narrative>;
}

export interface CompanyOverview {
  name: string;
  ticker: string | null;
  corpCode: string | null;
  basis: string | null;
  currency: string;
  periods: PeriodLabel[];
  historicalKind: 'actual' | 'fixture';
  historicalSourceId: string;
}

export interface TableRow { key: string; label: string; unit: Cell['unit']; note: string | null; cells: Cell[] }

export interface HistoricalPerformance {
  periods: PeriodLabel[];
  rows: TableRow[];
  trends: { key: string; direction: string; fromPeriod: string | null; toPeriod: string | null }[];
  revenueCagr: Cell;
  /** 데이터 품질 · 부재 안내 (값을 만들지 않고 이유를 적는다) */
  notes: string[];
  narrative: SectionState<Narrative>;
}

export interface ForecastSection {
  periods: PeriodLabel[];
  /** 가정 (Estimate) */
  assumptions: TableRow[];
  /** 가정에서 엔진이 투영한 값 (Estimate) */
  projections: TableRow[];
  scalars: { key: string; label: string; cell: Cell }[];
  basisNote: string;
}

export interface WaccSection {
  components: { key: string; label: string; cell: Cell }[];
  wacc: Cell;
  note: string;
}

export interface DcfSection {
  periods: PeriodLabel[];
  rows: TableRow[];
  terminal: { key: string; label: string; cell: Cell }[];
  bridge: { key: string; label: string; cell: Cell }[];
  tvContribution: Cell;
}

export interface SensitivitySection {
  /** 행 = Terminal Growth, 열 = WACC */
  waccAxis: Cell[];
  growthAxis: Cell[];
  rows: { terminalGrowth: Cell; cells: { wacc: Cell; enterpriseValue: Cell; perShareValue: Cell; isBaseCase: boolean }[] }[];
  base: { wacc: Cell; terminalGrowth: Cell; inGrid: boolean };
  enterpriseValueRange: { min: Cell; max: Cell; widthRatio: Cell };
  directionNotes: string[];
}

export interface ScenarioSection {
  columns: { id: string; label: string; description: string; ok: boolean; error: string | null; wacc: Cell; enterpriseValue: Cell; equityValue: Cell; perShareValue: Cell; assumptionNotes: string[] }[];
  equityRange: SectionState<{ min: Cell; max: Cell }>;
  note: string;
}

export interface RelativeSection {
  rows: { method: string; status: 'ok' | 'incomplete' | 'invalid'; enterpriseValue: Cell; equityValue: Cell; perShareValue: Cell; evDerived: boolean; message: string | null }[];
  equityRange: SectionState<{ min: Cell; max: Cell }>;
  maxDivergence: Cell;
  inputs: { key: string; label: string; cell: Cell }[];
  disclaimer: string;
}

export interface RiskItem {
  id: string;
  /** engine-review: 엔진 검토 경고 · ai-claim: 검증된 AI claim · data-quality: 데이터 품질 검토 */
  origin: 'engine-review' | 'ai-claim' | 'data-quality';
  text: string;
  basis: string | null;
  evidenceIds: string[];
  sourceIds: string[];
}

export interface KeyRisks { items: RiskItem[]; narrative: SectionState<Narrative> }

export interface ValuationRangeSection {
  low: { label: string; equityValue: Cell; perShareValue: Cell };
  base: { label: string; equityValue: Cell; perShareValue: Cell };
  high: { label: string; equityValue: Cell; perShareValue: Cell };
  spans: { source: string; low: Cell; high: Cell }[];
  /** 평균이나 중앙값으로 하나의 "정답 가치"를 만들지 않는다 */
  disclaimer: string;
}

export interface Conclusion { range: SectionState<ValuationRangeSection>; narrative: SectionState<Narrative>; disclaimers: string[] }

export interface Appendix {
  unitPolicy: { key: string; value: string }[];
  kindLegend: { kind: 'actual' | 'estimate' | 'calculated'; meaning: string }[];
  dataQualityNotes: string[];
  inputAssumptions: { key: string; label: string; cell: Cell }[];
  validation: { errors: ReportIssue[]; warnings: ReportIssue[] };
  aiLimitations: string[];
}

export interface ReportModel {
  schemaVersion: ReportSchemaVersion;
  metadata: ReportMetadata;
  executiveSummary: ExecutiveSummary;
  companyOverview: CompanyOverview;
  historicalPerformance: HistoricalPerformance;
  forecast: ForecastSection;
  wacc: WaccSection;
  dcf: DcfSection;
  sensitivity: SectionState<SensitivitySection>;
  scenario: SectionState<ScenarioSection>;
  relativeValuation: SectionState<RelativeSection>;
  keyRisks: KeyRisks;
  conclusion: Conclusion;
  sources: SourceRef[];
  appendix: Appendix;
}
