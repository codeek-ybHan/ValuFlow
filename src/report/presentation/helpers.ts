import type { ReportDocument } from '../templates/types.ts';
import { markersOf } from '../templates/footnotes.ts';
import type { Cell, DataKind, PeriodLabel } from '../types.ts';
import type { ChartPoint, PCell, TableColumn, TableModel, TableRowModel } from './types.ts';

export interface Ctx { index: Record<string, string> }

export const pcell = (ctx: Ctx, c: Cell, flag: PCell['flag'] = null): PCell => ({
  text: c.text, altText: c.largeText, value: c.value, unit: c.unit, kind: c.kind, state: c.state, reason: c.reason, sourceId: c.sourceId, markers: markersOf(ctx.index, c.sourceId), flag,
});

export const point = (c: Cell, flag: PCell['flag'] = null): ChartPoint => ({ value: c.value, text: c.text, state: c.state, flag });

export const periodColumns = (periods: PeriodLabel[]): TableColumn[] => periods.map((p) => ({ key: p.label, label: p.label, align: 'right' as const, kind: p.kind }));
export const labelColumn = (label = '항목'): TableColumn => ({ key: 'label', label, align: 'left', kind: null });

/** 행의 모든 ok Cell 이 같은 kind 면 그 kind, 아니면 null */
export const rowKind = (cells: Cell[]): DataKind | null => {
  const kinds = new Set(cells.map((c) => c.kind));
  return kinds.size === 1 ? [...kinds][0]! : null;
};

export function tableOf(ctx: Ctx, id: string, title: string, columns: TableColumn[], rows: TableRowModel[], notices: string[] = []): TableModel {
  const ids = new Set<string>();
  for (const r of rows) for (const c of r.cells) if (c.sourceId) ids.add(c.sourceId);
  return { id, title, columns, rows, notices, sourceIds: [...ids], markers: markersOf(ctx.index, [...ids]) };
}

export const valueRow = (ctx: Ctx, key: string, label: string, cells: Cell[], note: string | null = null, total = false): TableRowModel => ({
  key, label, cells: cells.map((c) => pcell(ctx, c, total ? 'total' : null)), note, kind: rowKind(cells),
});

export const sectionOf = <K extends string>(doc: ReportDocument, id: K) => doc.sections.find((s) => s.sectionId === id);

/** 접근성 설명: 값은 표시 문자열 그대로 이어 붙인다 (숫자를 계산하지 않는다). */
export function describeSeries(title: string, categories: string[], series: { label: string; points: ChartPoint[] }[]): string {
  const parts = series.map((s) => `${s.label}: ${categories.map((c, i) => `${c} ${s.points[i]?.text ?? '값 없음'}`).join(', ')}`);
  return `${title}. ${parts.join('. ')}.`;
}
