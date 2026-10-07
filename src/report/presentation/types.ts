// STEP 09-3 Presentation 모델: ReportDocument 를 Renderer 와 무관한 TableModel / ChartModel / KPI 로 바꾼다.
// 숫자를 계산하지 않는다: 모든 값은 ReportModel 의 Cell(원본 값 · 표시 문자열 · 단위 · kind · 상태 · sourceId)을 그대로 유지하고, 차트 시리즈는 그 Cell 의 value 를 옮긴다.
import type { CellState, DataKind, ReportUnit } from '../types.ts';

export interface PCell {
  /** 정책 단위로 만든 표시 문자열. ok 가 아니면 null (Renderer 가 reason 으로 "—" 등을 표시) */
  text: string | null;
  /** 1조원 이상 금액의 조원 보조 표기 */
  altText: string | null;
  /** 원본 값 (반올림하지 않는다) */
  value: number | null;
  unit: ReportUnit;
  kind: DataKind;
  state: CellState;
  reason: string | null;
  sourceId: string | null;
  /** footnote marker (S1 …). 알 수 없는 sourceId 는 marker 를 만들지 않는다 */
  markers: string[];
  /** semantic flag 만 (색상에 의미를 의존하지 않는다): base = Base case · invalid = 계산 불가 조합 · total = 합계/결과 행 */
  flag: 'base' | 'invalid' | 'total' | null;
}

export interface TableColumn { key: string; label: string; align: 'left' | 'right'; kind: 'actual' | 'estimate' | 'calculated' | null }

export interface TableRowModel {
  key: string;
  label: string;
  cells: PCell[];
  note: string | null;
  /** Equity Bridge 같은 계산 흐름의 연산자 표기 (null 이면 해당 없음) */
  operator?: '-' | '+' | '=' | null;
  /** 이 행의 값 성격 (Actual / Estimate / Calculated) — 행 전체가 같을 때만 */
  kind: DataKind | null;
}

export interface TableModel {
  id: string;
  title: string;
  columns: TableColumn[];
  rows: TableRowModel[];
  notices: string[];
  sourceIds: string[];
  markers: string[];
}

export interface KpiModel { key: string; label: string; cell: PCell }

export type ChartType = 'line' | 'bar' | 'grouped-bar' | 'stacked-bar' | 'waterfall' | 'heatmap' | 'range';

export interface ChartPoint { value: number | null; text: string | null; state: CellState; flag: PCell['flag'] }

export interface ChartSeries { key: string; label: string; kind: DataKind; unit: ReportUnit; points: ChartPoint[] }

export interface WaterfallStep { key: string; label: string; operator: '-' | '+' | '=' | null; role: 'start' | 'delta' | 'total'; point: ChartPoint }

export interface HeatmapCell { value: number | null; text: string | null; flag: PCell['flag']; valid: boolean; isBaseCase: boolean }

export interface RangeItem { label: string; low: ChartPoint; base: ChartPoint | null; high: ChartPoint }

export interface ChartModel {
  id: string;
  type: ChartType;
  title: string;
  categories: string[];
  series: ChartSeries[];
  /** 축 단위 (모든 series 가 같은 단위) */
  unit: ReportUnit;
  sourceIds: string[];
  markers: string[];
  /** 스크린리더 · 텍스트 대체 설명 (값은 표시 문자열 그대로) */
  accessibleDescription: string;
  waterfall?: WaterfallStep[];
  heatmap?: { rowLabels: string[]; colLabels: string[]; cells: HeatmapCell[][] };
  range?: RangeItem[];
}

export interface Presentation {
  version: '1.0';
  kpis: KpiModel[];
  tables: Record<string, TableModel>;
  charts: Record<string, ChartModel>;
  /** section 별로 보여 줄 표 · 차트 id (순서 = 표시 순서) */
  bySection: Partial<Record<string, { tables: string[]; charts: string[] }>>;
}
