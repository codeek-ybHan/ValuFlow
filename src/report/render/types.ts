// STEP 09-6 RenderModel: ReportDocument + Presentation 을 "이미 서식이 정해진 블록 목록"으로 평탄화한 Renderer 공통 입력.
// HTML Renderer(TypeScript)와 PDF Renderer(backend)가 같은 RenderModel 을 그린다. 모든 숫자는 Cell 의 표시 문자열(text)이며 Renderer 는 값을 계산하거나 다시 서식화하지 않는다.
import type { ChartModel } from '../presentation/types.ts';
import type { SourceEntry } from '../templates/types.ts';

export const RENDER_MODEL_VERSION = '1.0' as const;

export interface RenderMeta {
  title: string;
  company: string;
  ticker: string | null;
  createdAt: string;
  valuationDate: string | null;
  reportId: string;
  schemaVersion: string;
  templateId: string;
  templateVersion: string;
  currency: string;
  monetaryUnit: string;
  language: 'ko';
  /** 다운로드 파일 이름: ValuFlow_{Company}_Valuation_{YYYY-MM-DD}.pdf */
  filename: string;
  /** header / footer 에 쓰는 한 줄 */
  footer: string;
}

export interface RCell {
  /** 표시 문자열. 값이 없으면 null (Renderer 는 "—" 로 표시하고 reason 을 title/주석으로 둔다) */
  text: string | null;
  /** 1조원 이상의 조원 보조 표기 */
  alt: string | null;
  reason: string | null;
  markers: string[];
  /** semantic flag (색이 아니라 표시 문구/테두리로 구분): base · invalid · total */
  flag: 'base' | 'invalid' | 'total' | null;
}

export interface RColumn { label: string; align: 'left' | 'right'; /** Actual / Estimate / Calculated 라벨 (기간 열) */ kindLabel: string | null }
export interface RRow { label: string; kindLabel: string | null; operator: string | null; note: string | null; cells: RCell[]; emphasis: boolean }

export interface RNarrativeItem { label: 'Fact' | 'Judgment'; type: string; text: string; confidence: string | null; markers: string[] }
export interface RKv { label: string; value: RCell; kindLabel: string | null; note: string | null; emphasis: boolean }

export type RenderBlock =
  | { type: 'cover'; title: string; subtitle: string | null; company: string; ticker: string | null; createdAt: string; valuationDate: string | null; currency: string; monetaryUnit: string; perShareUnit: string; version: string }
  | { type: 'banner'; title: string; text: string }
  | { type: 'heading'; id: string; level: 1 | 2; number: string | null; text: string; status: string; pageBreakBefore: boolean }
  | { type: 'notice'; text: string; kind: 'learning' | 'warning' | 'info' }
  | { type: 'paragraph'; text: string; markers: string[]; muted: boolean }
  | { type: 'kpis'; items: { label: string; value: RCell; kindLabel: string | null }[] }
  | { type: 'keyvalues'; title: string | null; items: RKv[] }
  | { type: 'table'; id: string; title: string; columns: RColumn[]; rows: RRow[]; notices: string[]; markers: string[] }
  | { type: 'chart'; id: string; chart: ChartModel }
  | { type: 'narrative'; title: string; items: RNarrativeItem[]; note: string | null }
  | { type: 'list'; title: string | null; items: { text: string; markers: string[]; note: string | null }[] }
  | { type: 'sources'; entries: SourceEntry[] };

export interface RenderModel {
  version: typeof RENDER_MODEL_VERSION;
  meta: RenderMeta;
  banners: { title: string; text: string }[];
  blocks: RenderBlock[];
}
